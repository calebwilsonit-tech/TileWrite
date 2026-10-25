import { host, type EditorHost, type PluginApi } from '@tilewright/plugin-sdk';
import { WORKER_BOOTSTRAP } from './bootstrap';

/**
 * The editor part of a plugin somebody else wrote runs in a Web Worker (see bootstrap.ts): it cannot touch the page, the
 * project or the network. What it draws arrives here as a list of small changes and is drawn for real, only from a short list of
 * element kinds and properties; what it asks of the editor is answered through the plugin's permissions.
 */

export interface DomNodeLike {
  appendChild(child: DomNodeLike): unknown;
  remove(): void;
  setAttribute(name: string, value: string): void;
  removeAttribute(name: string): void;
  style: { setProperty(name: string, value: string): void };
  addEventListener(type: string, fn: (ev: unknown) => void): void;
  [key: string]: unknown;
}

export interface DomDocLike {
  createElement(tag: string): DomNodeLike;
  createTextNode(text: string): DomNodeLike;
}

export const ALLOWED_TAGS = new Set(['div', 'span', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'button', 'input', 'select', 'option', 'textarea', 'label', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'td', 'th', 'pre', 'code', 'strong', 'em', 'br', 'hr', 'small', 'fieldset', 'legend']);
const ALLOWED_PROPS = new Set(['textContent', 'className', 'id', 'title', 'value', 'checked', 'disabled', 'placeholder', 'min', 'max', 'step', 'selected', 'rows', 'cols', 'type']);
const ALLOWED_INPUT_TYPES = new Set(['text', 'number', 'checkbox', 'range', 'button', 'color']);
const ALLOWED_EVENTS = new Set(['click', 'input', 'change']);
const ALLOWED_ATTRS = new Set(['class', 'id', 'title', 'aria-label', 'role', 'placeholder', 'value', 'min', 'max', 'step', 'for', 'colspan', 'rowspan', 'data-testid']);
const ALLOWED_STYLES = /^(?:color|background(?:-color)?|font-(?:size|weight|style|family)|margin(?:-[a-z]+)?|padding(?:-[a-z]+)?|border(?:-[a-z]+)?|width|height|min-width|min-height|max-width|max-height|display|flex(?:-[a-z]+)?|gap|align-items|justify-content|text-align|white-space|overflow(?:-[a-z]+)?|opacity|cursor)$/;

export type DomOp = ['create', number, string] | ['append', number | string, number] | ['remove', number] | ['attr', number | string, string, string | null] | ['prop', number | string, string, unknown] | ['style', number | string, string, string] | ['listen', number | string, string];

/** Draws what the worker says, and nothing else. `root` is the element the panel lives in. */
export class RemoteDom {
  readonly nodes = new Map<number | string, DomNodeLike>();

  constructor(
    private readonly doc: DomDocLike,
    private readonly sendEvent: (node: number | string, type: string, value: unknown, checked: boolean) => void,
  ) {}

  addRoot(id: string, el: DomNodeLike): void {
    this.nodes.set(id, el);
  }

  /** Forget the nodes that live inside `root` (when the panel closes). */
  dropUnder(root: { contains(n: unknown): boolean }): void {
    for (const [id, n] of this.nodes) if (typeof id === 'number' && root.contains(n)) this.nodes.delete(id);
  }

  apply(op: DomOp): void {
    const get = (id: number | string): DomNodeLike | undefined => this.nodes.get(id);
    switch (op[0]) {
      case 'create': {
        const [, id, tag] = op;
        if (tag === '#text') this.nodes.set(id, this.doc.createTextNode(''));
        else if (ALLOWED_TAGS.has(tag.toLowerCase())) this.nodes.set(id, this.doc.createElement(tag.toLowerCase()));
        else this.nodes.set(id, this.doc.createElement('span')); // anything else becomes a plain span
        return;
      }
      case 'append': {
        const parent = get(op[1]);
        const child = get(op[2]);
        if (parent && child) parent.appendChild(child);
        return;
      }
      case 'remove':
        get(op[1])?.remove();
        return;
      case 'attr': {
        const n = get(op[1]);
        const name = String(op[2]).toLowerCase();
        if (!n || !ALLOWED_ATTRS.has(name)) return;
        if (op[3] === null) n.removeAttribute(name);
        else n.setAttribute(name, String(op[3]));
        return;
      }
      case 'prop': {
        const n = get(op[1]);
        const name = op[2];
        if (!n || !ALLOWED_PROPS.has(name)) return;
        if (name === 'type' && !ALLOWED_INPUT_TYPES.has(String(op[3]))) return;
        n[name] = op[3];
        return;
      }
      case 'style': {
        const n = get(op[1]);
        const prop = op[2].replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
        if (!n || !ALLOWED_STYLES.test(prop) || /url\(|expression\(|javascript:/i.test(op[3])) return;
        n.style.setProperty(prop, op[3]);
        return;
      }
      case 'listen': {
        const n = get(op[1]);
        const type = op[2];
        if (!n || !ALLOWED_EVENTS.has(type)) return;
        const id = op[1];
        n.addEventListener(type, () => this.sendEvent(id, type, n.value, n.checked === true));
        return;
      }
    }
  }
}

interface Declared {
  panels: { id: string; title: string }[];
  tools: { id: string; label: string; group?: string; help?: string }[];
  importers: { id: string; label: string; extensions: string[] }[];
  exporters: { id: string; label: string; extension: string; from: string }[];
}

type WorkerLike = { postMessage(m: unknown): void; terminate(): void; onmessage: ((ev: { data: any }) => void) | null; onerror: ((ev: { message?: string }) => void) | null }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** One worker running one plugin's editor code. */
export class RemotePart {
  private readonly dom: RemoteDom;
  private nextMount = 1;
  private nextRequest = 1;
  private readonly requests = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>();
  private worker: WorkerLike | null;

  constructor(
    private readonly pluginId: string,
    private readonly editorHost: () => EditorHost,
    makeWorker: () => WorkerLike,
    doc: DomDocLike,
    onDeclared: (d: Declared, part: RemotePart) => void,
    private readonly onCrash: (message: string) => void,
    private readonly limits: { declareMs: number; requestMs: number } = { declareMs: 5000, requestMs: 15_000 },
  ) {
    this.dom = new RemoteDom(doc, (node, type, value, checked) => this.worker?.postMessage({ t: 'event', node, type, value, checked }));
    this.worker = makeWorker();
    this.worker.onmessage = (ev) => this.handle(ev.data, onDeclared);
    this.worker.onerror = (ev) => this.onCrash(ev.message ?? 'it stopped');
    this.worker.postMessage({ t: 'declare' });
    // a worker that never says what it offers (a loop at the top of its file) is stopped; so is one that stops answering a call
    this.declareTimer = setTimeout(() => this.hung('say what it offers'), this.limits.declareMs);
  }

  private declareTimer: ReturnType<typeof setTimeout> | null = null;

  /** The worker did not answer in time: stop it, fail what waits on it, and tell the editor. */
  private hung(what: string): void {
    if (!this.worker) return;
    const waiting = [...this.requests.values()];
    this.requests.clear();
    this.stop();
    for (const r of waiting) r.reject(new Error(`The plugin did not answer in time (it was asked to ${what}), so it was stopped.`));
    this.onCrash(`it did not answer in time (it was asked to ${what}), so it was stopped`);
  }

  stop(): void {
    if (this.declareTimer) clearTimeout(this.declareTimer);
    this.declareTimer = null;
    this.worker?.terminate();
    this.worker = null;
    for (const r of this.requests.values()) r.reject(new Error('The plugin was turned off.'));
    this.requests.clear();
  }

  private async answer(id: number, run: () => unknown): Promise<void> {
    try {
      const value = await run();
      this.worker?.postMessage({ t: 'rpc-result', id, ok: true, value });
    } catch (e) {
      this.worker?.postMessage({ t: 'rpc-result', id, ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  private handle(m: any, onDeclared: (d: Declared, part: RemotePart) => void): void { // eslint-disable-line @typescript-eslint/no-explicit-any
    switch (m.t) {
      case 'dom':
        this.dom.apply(m.op as DomOp);
        return;
      case 'declared':
        if (this.declareTimer) clearTimeout(this.declareTimer);
        this.declareTimer = null;
        onDeclared(m as Declared, this);
        return;
      case 'error':
        this.onCrash(String(m.message));
        return;
      case 'result': {
        const r = this.requests.get(m.id);
        this.requests.delete(m.id);
        if (r) {
          if (m.ok) r.resolve(m.value);
          else r.reject(new Error(String(m.error)));
        }
        return;
      }
      case 'call': {
        const h = this.editorHost();
        const args = (m.args ?? []) as any[]; // eslint-disable-line @typescript-eslint/no-explicit-any
        if (m.method === 'notify') {
          h.notify(args[0], String(args[1]));
          return;
        }
        const table: Record<string, () => unknown> = {
          project: () => h.project(),
          entities: () => h.entities(),
          readFile: () => h.readFile(String(args[0])),
          writeFile: () => h.writeFile(String(args[0]), String(args[1])),
          'clipboard.read': () => h.clipboard.read(),
          'clipboard.write': () => h.clipboard.write(String(args[0])),
          runProgram: () => h.runProgram(String(args[0]), (args[1] as string[]).map(String)),
        };
        const run = table[m.method as string];
        void this.answer(m.id as number, run ?? (() => Promise.reject(new Error(`There is no editor call "${m.method as string}".`))));
        return;
      }
    }
  }

  private request(message: Record<string, unknown>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const id = this.nextRequest++;
      const timer = setTimeout(() => this.hung(`answer a ${String(message.t)} call`), this.limits.requestMs);
      this.requests.set(id, { resolve: (v) => (clearTimeout(timer), resolve(v)), reject: (e) => (clearTimeout(timer), reject(e)) });
      this.worker?.postMessage({ ...message, id });
    });
  }

  mountPanel(panel: string, container: DomNodeLike & { contains(n: unknown): boolean }): () => void {
    const mount = this.nextMount++;
    const root = `root${mount}`;
    this.dom.addRoot(root, container);
    this.worker?.postMessage({ t: 'mount', mount, panel, root });
    return () => {
      this.worker?.postMessage({ t: 'unmount', mount });
      this.dom.dropUnder(container);
      this.dom.nodes.delete(root);
    };
  }

  tool(tool: string, cell: { x: number; y: number }, event: unknown): Promise<unknown> {
    return this.request({ t: 'tool', tool, cell, event });
  }

  importFile(importer: string, name: string, bytes: Uint8Array): Promise<string> {
    return this.request({ t: 'import', importer, name, bytes: Array.from(bytes) }) as Promise<string>;
  }

  exportFile(exporter: string, name: string, text: string): Promise<Uint8Array | string> {
    return this.request({ t: 'export', exporter, name, text }) as Promise<Uint8Array | string>;
  }
}

/** Starts the plugin's editor code in a worker and registers what it declares. Returns what the plugin host installs as the editor part. */
export function installIsolatedEditorPart(id: string, code: string): (api: PluginApi) => void {
  return (api) => {
    const makeWorker = (): WorkerLike => {
      const url = URL.createObjectURL(new Blob([`${WORKER_BOOTSTRAP}\n;${code}`], { type: 'text/javascript' }));
      const w = new Worker(url, { name: `plugin ${id}` });
      URL.revokeObjectURL(url);
      return w as unknown as WorkerLike;
    };
    const crashed = (message: string): void => {
      host.fail(id, 'its editor part', new Error(message));
      host.editorHost?.notify('error', `${host.known.get(id)?.manifest.name ?? id}: ${message}. The plugin has been turned off.`);
      host.uninstall(id);
    };
    const part = new RemotePart(
      id,
      () => host.editorHostFor(id),
      makeWorker,
      document as unknown as DomDocLike,
      (d, p) => {
        if (!host.isInstalled(id)) return p.stop();
        for (const panel of d.panels) api.panel({ id: `${id}:${panel.id}`, title: panel.title, mount: (el) => p.mountPanel(panel.id, el as unknown as DomNodeLike & { contains(n: unknown): boolean }) });
        for (const t of d.tools) api.tool({ id: `${id}:${t.id}`, label: t.label, ...(t.group ? { group: t.group } : {}), ...(t.help ? { help: t.help } : {}), onCell: (cell, _h, ev) => void p.tool(t.id, cell, ev).catch((e: Error) => host.editorHost?.notify('error', e.message)) });
        for (const i of d.importers) api.importer({ id: `${id}:${i.id}`, label: i.label, extensions: i.extensions, import: (name, bytes) => p.importFile(i.id, name, bytes) });
        for (const e of d.exporters) api.exporter({ id: `${id}:${e.id}`, label: e.label, extension: e.extension, from: e.from, export: (name, text) => p.exportFile(e.id, name, text) });
        host.touch(id);
      },
      crashed,
    );
    const stop = host.onChange((c) => {
      if (c.kind === 'removed' && c.plugin === id) {
        part.stop();
        stop();
      }
    });
  };
}
