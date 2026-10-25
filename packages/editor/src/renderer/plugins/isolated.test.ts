import vm from 'node:vm';
import { describe, expect, it } from 'vitest';
import type { EditorHost } from '@tilewright/plugin-sdk';
import { RemotePart, type DomDocLike, type DomNodeLike } from './isolated';
import { WORKER_BOOTSTRAP } from './bootstrap';

/** A page that is just enough to see what was drawn. */
class FakeNode implements DomNodeLike {
  tag: string;
  kids: FakeNode[] = [];
  attrs: Record<string, string> = {};
  props: Record<string, unknown> = {};
  styles: Record<string, string> = {};
  handlers: Record<string, ((ev: unknown) => void)[]> = {};
  parent: FakeNode | null = null;
  [key: string]: unknown;
  constructor(tag: string) {
    this.tag = tag;
  }
  style = { setProperty: (k: string, v: string): void => void (this.styles[k] = v) };
  appendChild(c: DomNodeLike): void {
    const k = c as FakeNode;
    k.remove();
    k.parent = this;
    this.kids.push(k);
  }
  remove(): void {
    if (this.parent) this.parent.kids = this.parent.kids.filter((x) => x !== this);
    this.parent = null;
  }
  setAttribute(k: string, v: string): void {
    this.attrs[k] = v;
  }
  removeAttribute(k: string): void {
    delete this.attrs[k];
  }
  addEventListener(type: string, fn: (ev: unknown) => void): void {
    (this.handlers[type] ??= []).push(fn);
  }
  contains(n: unknown): boolean {
    return n === this || this.kids.some((k) => k.contains(n));
  }
  click(): void {
    for (const h of this.handlers.click ?? []) h({});
  }
  text(): string {
    return String(this.props.textContent ?? '') + this.kids.map((k) => k.text()).join('');
  }
}
// property writes the applier makes (`n.textContent = ...`) land in props
const proxied = (n: FakeNode): FakeNode =>
  new Proxy(n, {
    set(t, k, v) {
      if (typeof k === 'string' && !(k in t)) t.props[k] = v;
      else (t as unknown as Record<string | symbol, unknown>)[k] = v;
      return true;
    },
    get(t, k) {
      if (typeof k === 'string' && k in t.props) return t.props[k];
      const v = (t as unknown as Record<string | symbol, unknown>)[k];
      return typeof v === 'function' ? (v as (...a: unknown[]) => unknown).bind(t) : v;
    },
  });
const fakeDoc: DomDocLike = { createElement: (tag) => proxied(new FakeNode(tag)), createTextNode: () => proxied(new FakeNode('#text')) };

/** The plugin's editor code in the same program text the worker runs, in a context that has nothing but the language. */
function startWorker(code: string): { postMessage(m: unknown): void; onmessage: ((ev: { data: unknown }) => void) | null; terminate(): void; onerror: null } {
  let toParent: ((ev: { data: unknown }) => void) | null = null;
  const clone = (m: unknown): unknown => JSON.parse(JSON.stringify(m));
  const sandbox: Record<string, unknown> = {
    postMessage: (m: unknown) => queueMicrotask(() => toParent?.({ data: clone(m) })), // the worker speaks to the editor
    console,
    Promise,
    Proxy,
    Uint8Array,
    Object,
    Array,
    String,
    Error,
    Function,
  };
  sandbox.self = sandbox; // in a worker the global is its own self
  vm.runInContext(`${WORKER_BOOTSTRAP}\n;${code}`, vm.createContext(sandbox));
  return {
    postMessage: (m) => queueMicrotask(() => (sandbox.onmessage as (ev: { data: unknown }) => void)({ data: clone(m) })), // the editor speaks to the worker
    get onmessage() {
      return toParent;
    },
    set onmessage(fn) {
      toParent = fn;
    },
    terminate() {},
    onerror: null,
  };
}

const editorHost = (log: string[]): EditorHost => ({
  notify: (k, t) => void log.push(`${k}: ${t}`),
  project: () => ({ name: 'P', dir: '/p' }),
  entities: () => [{ id: 'e1', name: 'Crate', tags: [], components: {} }],
  readFile: async (p) => `contents of ${p}`,
  writeFile: async () => undefined,
  clipboard: { read: async () => '', write: async () => undefined },
  runProgram: async () => ({ code: 0, stdout: '', stderr: '' }),
});

const PLUGIN = `
Tilewright.editor.panel({
  id: 'counter',
  title: 'Counter',
  mount(el, host) {
    var n = 0;
    var label = document.createElement('p');
    var button = document.createElement('button');
    var script = document.createElement('script');
    label.textContent = 'clicks: 0';
    button.textContent = 'Click me';
    button.style.color = 'red';
    button.style.backgroundImage = 'url(http://evil.example/x.png)';
    button.addEventListener('click', function () { n++; label.textContent = 'clicks: ' + n; host.notify('info', 'clicked ' + n); });
    el.appendChild(label);
    el.appendChild(button);
    el.appendChild(script);
    host.readFile('a.txt').then(function (t) { var d = document.createElement('div'); d.textContent = t; el.appendChild(d); });
    return function () { label.textContent = 'gone'; };
  }
});
Tilewright.editor.tool({ id: 'probe', label: 'Probe', onCell: function (cell, host) { host.notify('info', 'cell ' + cell.x + ',' + cell.y); } });
Tilewright.editor.importer({ id: 'words', label: 'Words', extensions: ['.words'], import: function (name, bytes) { return name + ' has ' + bytes.length + ' bytes'; } });
Tilewright.editor.exporter({ id: 'up', label: 'Upper', extension: '.up', from: '.txt', export: function (name, text) { return text.toUpperCase(); } });
globalThis.stuff = { fetch: typeof fetch, xhr: typeof XMLHttpRequest, ws: typeof WebSocket };
`;

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 5));

async function boot(code = PLUGIN): Promise<{ part: RemotePart; log: string[]; declared: { panels: { id: string }[]; tools: unknown[]; importers: unknown[]; exporters: unknown[] } }> {
  const log: string[] = [];
  let declared: never = null as never;
  const part = new RemotePart('p', () => editorHost(log), () => startWorker(code) as never, fakeDoc, (d) => (declared = d as never), (m) => log.push(`crash: ${m}`));
  await flush();
  return { part, log, declared };
}

describe('the sandbox of a plugin editor part', () => {
  it('says what the plugin offers', async () => {
    const { declared } = await boot();
    expect(declared.panels).toEqual([{ id: 'counter', title: 'Counter' }]);
    expect(declared.tools).toHaveLength(1);
    expect(declared.importers).toEqual([{ id: 'words', label: 'Words', extensions: ['.words'] }]);
    expect(declared.exporters).toHaveLength(1);
  });

  it('draws a panel, hears clicks and answers calls back to the editor', async () => {
    const { part, log } = await boot();
    const container = proxied(new FakeNode('div'));
    const stop = part.mountPanel('counter', container as never);
    await flush();
    const base = container as unknown as FakeNode;
    expect(base.kids.map((k) => k.tag)).toEqual(['p', 'button', 'span', 'div']); // the script element became a plain span
    expect(base.text()).toContain('clicks: 0');
    expect(base.text()).toContain('contents of a.txt'); // a call back to the editor came back with an answer
    const button = base.kids[1]!;
    expect(button.styles.color).toBe('red');
    expect(button.styles['background-image']).toBeUndefined(); // a style that could fetch something is refused
    button.click();
    button.click();
    await flush();
    expect(base.text()).toContain('clicks: 2');
    expect(log).toEqual(['info: clicked 1', 'info: clicked 2']);
    stop();
  });

  it('takes tools, imports and exports', async () => {
    const { part, log } = await boot();
    await part.tool('probe', { x: 3, y: 4 }, { kind: 'down', shift: false, alt: false });
    await flush();
    expect(log).toContain('info: cell 3,4');
    expect(await part.importFile('words', 'a.words', new Uint8Array([1, 2, 3]))).toBe('a.words has 3 bytes');
    expect(await part.exportFile('up', 'a', 'shout')).toBe('SHOUT');
  });

  it('has no way to the network', async () => {
    const outbox: unknown[] = [];
    const self: Record<string, unknown> = { postMessage: (m: unknown) => outbox.push(m), Promise, Proxy, Uint8Array, Object };
    self.self = self;
    const ctx = vm.createContext(self);
    vm.runInContext(`${WORKER_BOOTSTRAP}\n;self.seen = [typeof self.fetch, typeof self.XMLHttpRequest, typeof self.WebSocket, typeof self.importScripts, typeof self.Worker]`, ctx);
    expect(self.seen).toEqual(['undefined', 'undefined', 'undefined', 'undefined', 'undefined']);
  });

  it('is told off when it asks the editor for what it was not given', async () => {
    const log: string[] = [];
    const denied: EditorHost = { ...editorHost(log), readFile: async () => Promise.reject(new Error('The plugin "P" tried to read a file of the project, but it was not allowed to (it needs the "project.read" permission).')) };
    const code = `Tilewright.editor.panel({ id: 'a', title: 'A', mount(el, host) { host.readFile('x').catch(function (e) { el.textContent = e.message; }); } });`;
    const part = new RemotePart('p', () => denied, () => startWorker(code) as never, fakeDoc, () => undefined, () => undefined);
    await flush();
    const container = proxied(new FakeNode('div'));
    part.mountPanel('a', container as never);
    await flush();
    expect((container as unknown as FakeNode).text()).toMatch(/not allowed to .*project\.read/);
  });
});

describe('a plugin editor part that stops answering', () => {
  const silent = (): { postMessage(m: unknown): void; terminate(): void; onmessage: null; onerror: null; stopped: boolean } => {
    const w = { postMessage: () => undefined, terminate: () => void (w.stopped = true), onmessage: null, onerror: null, stopped: false };
    return w;
  };

  it('is stopped and reported when it never says what it offers', async () => {
    const log: string[] = [];
    const w = silent();
    new RemotePart('p', () => editorHost(log), () => w as never, fakeDoc, () => undefined, (m) => log.push(`crash: ${m}`), { declareMs: 20, requestMs: 20 });
    await new Promise((r) => setTimeout(r, 60));
    expect(w.stopped).toBe(true);
    expect(log.join(' ')).toMatch(/crash: .*did not answer/);
  });

  it('is stopped when a tool call takes too long, and the person is told in words', async () => {
    const log: string[] = [];
    const w = silent();
    const part = new RemotePart('p', () => editorHost(log), () => w as never, fakeDoc, () => undefined, (m) => log.push(`crash: ${m}`), { declareMs: 10_000, requestMs: 20 });
    await expect(part.tool('probe', { x: 1, y: 1 }, {})).rejects.toThrow(/did not answer/);
    expect(w.stopped).toBe(true);
    expect(log.join(' ')).toMatch(/crash: .*did not answer/);
  });
});
