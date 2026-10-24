import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, MAX_ATTACHMENTS, MAX_ATTACHMENT_BYTES, buildContext, cleanSettings, formatProjectIndex, type AssistantSettings, type Attachment, type Mode, type ToolOutput, type Usage, NO_USAGE } from '@tilewright/assistant';
import { host } from '@tilewright/behaviors';
import { store } from '../app/store';
import { api, type AssistantEvent, type AssistantStatus, type AssistantToolCall } from '../project/api';
import { ToolProblem, prepareAction, readNotes, runReadTool, sceneProblems, type Proposal } from './editor-tools';
import { listProjectFiles } from './file-tools';
import { rollBack, takeSnapshot, type Snapshot } from './snapshot';

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed' | 'undone';

export type ChatItem =
  | { kind: 'user'; id: string; text: string; mode: Mode; images?: { name: string; url: string }[] }
  | { kind: 'assistant'; id: string; text: string; thinking: string }
  | { kind: 'tool'; id: string; name: string; status: 'running' | 'done' | 'error'; detail: string }
  | { kind: 'proposal'; id: string; tool: string; title: string; lines: string[]; diff?: Proposal['diff']; status: ProposalStatus; message: string; undoable: boolean; images?: { name: string; url: string }[]; plan?: { steps: string[]; risks: string[] }; auto?: boolean }
  | { kind: 'run'; id: string; changes: number; rolledBack: boolean; message: string }
  | { kind: 'notice'; id: string; level: 'info' | 'warn'; text: string };

export interface AssistantState {
  ready: boolean;
  status: AssistantStatus | null;
  settings: AssistantSettings;
  items: ChatItem[];
  busy: boolean;
  usage: Usage;
  cost: number;
  error: { message: string; retryable: boolean; kind: string } | null;
  /** What to put in the message box (for example after pressing Explain with no key yet). */
  draft: string;
  mode: Mode;
  notes: string;
  /** Bumped when a proposal waits or is decided, so the panel can scroll. */
  tick: number;
  /** Pictures waiting to go with the next message. */
  attachments: (Attachment & { url: string })[];
  /** What the run in progress (or the last one) has cost. */
  run: { cost: number; tokens: number };
  /** The plan of this run has been approved (the levels that ask for one let Claude carry on without asking about each change). */
  planApproved: boolean;
  /** A copy of the project taken before this run started changing things, so the run can be rolled back. */
  rollbackAvailable: boolean;
}

const INITIAL: AssistantState = { ready: false, status: null, settings: DEFAULT_SETTINGS, items: [], busy: false, usage: NO_USAGE, cost: 0, error: null, draft: '', mode: 'chat', notes: '', tick: 0, attachments: [], run: { cost: 0, tokens: 0 }, planApproved: false, rollbackAvailable: false };

let counter = 0;
const nextId = (p: string): string => `${p}${++counter}`;

/** Wording for tool activity lines, so the transcript reads like what happened. */
export const TOOL_LABELS: Record<string, string> = {
  project_overview: 'Looked at the project',
  scene_summary: 'Looked at the scene',
  get_objects: 'Looked at some objects',
  get_tiles: 'Looked at the map',
  get_selection: 'Looked at your selection',
  get_event_sheet: 'Read the event sheet',
  list_event_blocks: 'Checked which event blocks exist',
  list_behaviors: 'Checked which behaviours exist',
  list_prefabs: 'Checked which parts exist',
  read_script: 'Read a script',
  scripting_reference: 'Read the scripting reference',
  get_problems: 'Read the problem list',
  run_puzzle_check: 'Ran the puzzle check',
  run_playbot: 'Ran the playbot',
  screenshot: 'Took a screenshot',
  read_project_notes: 'Read the project notes',
  project_index: 'Looked at the project\'s files',
  list_project_files: 'Looked inside a folder',
  read_project_file: 'Read a file',
  list_image_providers: 'Checked which picture makers exist',
};

class AssistantStore {
  private state: AssistantState = INITIAL;
  private listeners = new Set<() => void>();
  private hooked = false;
  /** Proposals that need a decision, in the order Claude asked, with what to do once they are decided. */
  private proposals = new Map<string, { proposal: Proposal; decide(approve: boolean): void }>();
  private order: string[] = [];

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  };
  getState = (): AssistantState => this.state;

  private set(patch: Partial<AssistantState>): void {
    this.state = { ...this.state, ...patch };
    for (const l of [...this.listeners]) l();
  }

  private patchItem(id: string, patch: Partial<ChatItem>): void {
    this.set({ items: this.state.items.map((i) => (i.id === id ? ({ ...i, ...patch } as ChatItem) : i)), tick: this.state.tick + 1 });
  }

  private push(item: ChatItem): void {
    this.set({ items: [...this.state.items, item], tick: this.state.tick + 1 });
  }

  /** Start listening to the main process and load saved settings (once). */
  async init(): Promise<void> {
    if (!this.hooked) {
      this.hooked = true;
      api().assistant.onEvent((ev) => this.onEvent(ev));
      api().assistant.onToolCall((call) => void this.onToolCall(call));
    }
    const saved = (await api().settings.get()).assistant;
    this.set({ settings: cleanSettings(saved), status: await api().assistant.status(), ready: true, notes: await readNotes() });
  }

  async refreshNotes(): Promise<void> {
    this.set({ notes: await readNotes() });
  }

  async refreshStatus(): Promise<void> {
    this.set({ status: await api().assistant.status() });
  }

  setSettings(patch: Partial<AssistantSettings>): void {
    const settings = cleanSettings({ ...this.state.settings, ...patch });
    this.set({ settings });
    void store.saveSetting('assistant', settings);
  }

  setMode(mode: Mode): void {
    this.set({ mode });
  }

  setDraft(draft: string): void {
    this.set({ draft });
  }

  /** Pictures to send with the next message (from the attach button, a paste or a drop). Wrong kinds and big ones are refused with a word. */
  async attach(files: readonly File[]): Promise<void> {
    for (const file of files) {
      if (this.state.attachments.length >= MAX_ATTACHMENTS) {
        this.push({ kind: 'notice', id: nextId('n'), level: 'warn', text: `A message can carry at most ${MAX_ATTACHMENTS} pictures.` });
        break;
      }
      if (!['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(file.type)) {
        this.push({ kind: 'notice', id: nextId('n'), level: 'warn', text: `"${file.name}" is not a picture Claude can look at (PNG, JPEG, GIF or WebP).` });
        continue;
      }
      if (file.size > MAX_ATTACHMENT_BYTES) {
        this.push({ kind: 'notice', id: nextId('n'), level: 'warn', text: `"${file.name}" is ${(file.size / 1024 / 1024).toFixed(1)} MB, which is too big (the limit is ${(MAX_ATTACHMENT_BYTES / 1024 / 1024).toFixed(1)} MB). Use a smaller copy.` });
        continue;
      }
      const url = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
      });
      const data = url.slice(url.indexOf(',') + 1);
      this.set({ attachments: [...this.state.attachments, { name: file.name || 'picture', mediaType: file.type as Attachment['mediaType'], data, url }] });
    }
  }

  removeAttachment(index: number): void {
    this.set({ attachments: this.state.attachments.filter((_a, i) => i !== index) });
  }

  async setKey(key: string): Promise<boolean> {
    try {
      this.set({ status: await api().assistant.setKey(key), error: null });
      return true;
    } catch (e) {
      this.set({ error: { message: e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : 'The key could not be saved.', retryable: false, kind: 'key' } });
      return false;
    }
  }

  async clearKey(): Promise<void> {
    this.set({ status: await api().assistant.clearKey() });
  }

  async newChat(): Promise<void> {
    await api().assistant.reset();
    this.rejectAll();
    this.set({ items: [], usage: NO_USAGE, cost: 0, error: null, busy: false, status: await api().assistant.status() });
  }

  // ---- talking ----

  async send(text: string, mode: Mode = this.state.mode): Promise<void> {
    const trimmed = text.trim();
    if (!trimmed || this.state.busy) return;
    if (!this.state.status?.hasKey) {
      this.set({ draft: trimmed, mode, error: { message: 'Add your Anthropic API key above, then press Send.', retryable: false, kind: 'key' } });
      return;
    }
    const attachments = this.state.attachments;
    this.push({ kind: 'user', id: nextId('u'), text: trimmed, mode, ...(attachments.length > 0 ? { images: attachments.map((a) => ({ name: a.name, url: a.url })) } : {}) });
    this.set({ busy: true, error: null, draft: '', mode: 'chat', attachments: [], run: { cost: 0, tokens: 0 }, planApproved: false });
    this.snapshot = null;
    this.changesThisRun = 0;
    this.set({ rollbackAvailable: false });
    const doc = store.doc;
    const context = buildContext({
      projectName: store.state.project?.project.name ?? '',
      scenePath: store.state.scenePath,
      sceneName: doc?.name ?? null,
      mapSize: doc ? `${doc.map.width} x ${doc.map.height}` : null,
      objectCount: doc?.entities.length ?? 0,
      selection: doc ? store.state.selection.map((id) => doc.getEntity(id)).filter((e) => e !== undefined).map((e) => `${e!.name} (${e!.id})`) : [],
      problems: doc ? sceneProblems(doc).length : 0,
      notes: await readNotes(),
      files: store.state.project !== null ? await this.filesIndex() : '',
    });
    const r = await api().assistant.send({ text: trimmed, mode, context, settings: this.state.settings, notes: host.assistantNotes(), attachments: attachments.map((a) => ({ name: a.name, mediaType: a.mediaType, data: a.data })), pluginTools: pluginToolDefs() });
    if (!r.started) this.set({ busy: false });
  }

  async retry(): Promise<void> {
    if (this.state.busy) return;
    this.set({ busy: true, error: null });
    const r = await api().assistant.retry(this.state.settings);
    if (!r.started) this.set({ busy: false });
  }

  async cancel(): Promise<void> {
    await api().assistant.cancel();
  }

  /** Explain / Fix with Claude buttons elsewhere in the editor. */
  ask(mode: Mode, text: string): void {
    document.dispatchEvent(new CustomEvent('tw:show-panel', { detail: 'assistant' }));
    void this.send(text, mode);
  }

  // ---- events from the main process ----

  private lastAssistant(): (ChatItem & { kind: 'assistant' }) | null {
    const last = this.state.items.at(-1);
    return last?.kind === 'assistant' ? last : null;
  }

  private onEvent(ev: AssistantEvent): void {
    switch (ev.type) {
      case 'text': {
        const last = this.lastAssistant();
        if (last) this.patchItem(last.id, { text: last.text + ev.delta } as Partial<ChatItem>);
        else this.push({ kind: 'assistant', id: nextId('a'), text: ev.delta, thinking: '' });
        break;
      }
      case 'thinking': {
        const last = this.lastAssistant();
        if (last) this.patchItem(last.id, { thinking: last.thinking + ev.delta } as Partial<ChatItem>);
        else this.push({ kind: 'assistant', id: nextId('a'), text: '', thinking: ev.delta });
        break;
      }
      case 'usage':
        this.set({ usage: ev.usage, cost: ev.cost, run: ev.run });
        break;
      case 'done':
        this.rejectAll();
        this.set({ busy: false });
        if (this.changesThisRun > 0 && this.snapshot) this.push({ kind: 'run', id: nextId('r'), changes: this.changesThisRun, rolledBack: false, message: '' });
        if (ev.result.notice) this.push({ kind: 'notice', id: nextId('n'), level: ev.result.stopReason === 'refusal' ? 'warn' : 'info', text: ev.result.notice });
        void this.refreshStatus();
        break;
      case 'error':
        this.rejectAll();
        this.set({ busy: false, error: { message: ev.message, retryable: ev.retryable, kind: ev.kind } });
        void this.refreshStatus();
        break;
    }
  }

  private rejectAll(): void {
    this.epoch++;
    for (const id of [...this.order]) this.proposals.get(id)?.decide(false);
    this.order = [];
    this.proposals.clear();
  }

  /** Changes are prepared and shown one at a time, in the order Claude asked: a later one may refer to what an earlier one makes. */
  private actChain: Promise<void> = Promise.resolve();
  /** Bumped when the conversation ends or is cleared, so changes still waiting in line are dropped. */
  private epoch = 0;

  private async onToolCall(call: AssistantToolCall): Promise<void> {
    const reply = (out: { content: unknown; isError?: boolean }): void => void api().assistant.toolResult(call.callId, out);
    try {
      if (call.kind === 'read') {
        this.push({ kind: 'tool', id: call.callId, name: call.name, status: 'running', detail: '' });
        const out = (await runPluginRead(call.name, call.input)) ?? (await runReadTool(call.name, call.input));
        this.patchItem(call.callId, { status: out.isError ? 'error' : 'done', detail: out.isError ? String(typeof out.content === 'string' ? out.content : 'failed') : '' } as Partial<ChatItem>);
        reply(out);
        return;
      }
      const epoch = this.epoch;
      const run = this.actChain.then(() => (epoch === this.epoch ? this.handleAct(call, reply) : undefined));
      this.actChain = run.catch(() => undefined);
      await run;
    } catch (e) {
      reply({ isError: true, content: `The editor could not run this tool: ${e instanceof Error ? e.message : String(e)}` });
    }
  }

  /** The copy of the project taken when this run first changed something without asking (null: not taken). */
  private snapshot: Snapshot | null = null;
  private changesThisRun = 0;

  /** Could Claude make this change right now, under the person's permission setting? A reason when it may not. */
  private refusal(name: string): string | null {
    const level = this.state.settings.permission;
    if (level === 'look') return 'The person has set Claude to "Look only", so nothing can be changed. Say what you would change and ask them to allow changes (the permission setting in the assistant) if they want it done.';
    if (level === 'plan' && name !== 'submit_plan' && !this.state.planApproved) return 'The person has set Claude to "Plan first, then do it": nothing can be changed until they approve a plan. Call submit_plan with the steps you will take, and wait for the answer.';
    return null;
  }

  /** Does this change go ahead without asking? (the plan is approved, or the person said to just do it) */
  private automatic(name: string): boolean {
    if (name === 'submit_plan') return false;
    const level = this.state.settings.permission;
    return level === 'auto' || (level === 'plan' && this.state.planApproved);
  }

  private async handleAct(call: AssistantToolCall, reply: (out: { content: unknown; isError?: boolean }) => void): Promise<void> {
    const refused = this.refusal(call.name);
    if (refused) {
      this.push({ kind: 'tool', id: call.callId, name: call.name, status: 'error', detail: 'Not allowed by the permission setting' });
      reply({ isError: true, content: refused });
      return;
    }
    let proposal: Proposal;
    try {
      proposal = (await preparePluginAction(call.name, call.input)) ?? (await prepareAction(call.name, call.input));
    } catch (e) {
      if (!(e instanceof ToolProblem)) throw e;
      this.push({ kind: 'tool', id: call.callId, name: call.name, status: 'error', detail: e.message });
      reply({ isError: true, content: e.message });
      return;
    }
    const looks = (p: Proposal) => (p.images ?? []).map((i) => ({ name: i.name, url: pngUrl(i.png) }));
    if (this.automatic(call.name)) {
      // the first change of a run without asking takes a copy of the project, so the run can be rolled back
      if (!this.snapshot) {
        const taken = await takeSnapshot();
        if (!taken.ok) {
          this.push({ kind: 'tool', id: call.callId, name: call.name, status: 'error', detail: taken.reason });
          reply({ isError: true, content: `${taken.reason} Claude may not change things without asking at this size: tell the user they can pick "Ask me for every change" in the assistant.` });
          return;
        }
        this.snapshot = taken.snapshot;
        this.set({ rollbackAvailable: true });
      }
      this.push({ kind: 'proposal', id: call.callId, tool: call.name, title: proposal.title, lines: proposal.lines, diff: proposal.diff, status: 'pending', message: '', undoable: false, auto: true, ...(proposal.images ? { images: looks(proposal) } : {}) });
      try {
        const message = await proposal.apply();
        this.changesThisRun++;
        if (proposal.undo) this.undoers.set(call.callId, proposal.undo);
        this.patchItem(call.callId, { status: 'applied', message, undoable: proposal.undo !== undefined, ...(proposal.images ? { images: looks(proposal) } : {}) } as Partial<ChatItem>);
        reply(await resultOf(proposal, `Applied. ${message}`));
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.patchItem(call.callId, { status: 'failed', message: msg } as Partial<ChatItem>);
        reply({ isError: true, content: `The change could not be applied: ${msg}` });
      }
      return;
    }
    this.push({ kind: 'proposal', id: call.callId, tool: call.name, title: proposal.title, lines: proposal.lines, diff: proposal.diff, status: 'pending', message: '', undoable: false, ...(proposal.images ? { images: looks(proposal) } : {}), ...(proposal.plan ? { plan: proposal.plan } : {}) });
    const approved = await new Promise<boolean>((resolve) => {
      this.proposals.set(call.callId, { proposal, decide: resolve });
      this.order.push(call.callId);
    });
    this.order = this.order.filter((i) => i !== call.callId);
    this.proposals.delete(call.callId);
    if (!approved) {
      this.patchItem(call.callId, { status: 'rejected' } as Partial<ChatItem>);
      reply({ content: 'The user rejected this change, so nothing was changed. Do not try the same change again: ask what they would like instead.' });
      return;
    }
    try {
      const message = await proposal.apply();
      if (proposal.plan) this.set({ planApproved: true });
      else if (proposal.tool !== 'submit_plan') this.changesThisRun++;
      if (proposal.undo) this.undoers.set(call.callId, proposal.undo);
      this.patchItem(call.callId, { status: 'applied', message, undoable: proposal.undo !== undefined, ...(proposal.images ? { images: looks(proposal) } : {}) } as Partial<ChatItem>);
      reply(await resultOf(proposal, proposal.plan ? message : `Applied. ${message}`));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.patchItem(call.callId, { status: 'failed', message: msg } as Partial<ChatItem>);
      reply({ isError: true, content: `The change could not be applied: ${msg}` });
    }
  }
  // ---- deciding on proposals ----

  /** Only the oldest waiting proposal can be decided: later ones may depend on it. */
  canDecide(id: string): boolean {
    return this.order[0] === id;
  }

  decide(id: string, approve: boolean): void {
    if (!this.canDecide(id)) return;
    this.proposals.get(id)?.decide(approve);
    this.set({ tick: this.state.tick + 1 });
  }

  async undo(id: string): Promise<void> {
    const item = this.state.items.find((i) => i.id === id);
    if (!item || item.kind !== 'proposal' || !item.undoable) return;
    const p = this.undoers.get(id);
    if (!p) return;
    const ok = await p();
    if (ok) this.patchItem(id, { status: 'undone', undoable: false } as Partial<ChatItem>);
    else store.notify('warn', 'That change cannot be undone from here any more because you have changed the project since. Use Undo in the editor (Ctrl+Z) or the History panel.');
  }

  private undoers = new Map<string, () => Promise<boolean>>();

  /** The list of the project's files for the start of a conversation (short: read_project_file gets the rest). */
  private async filesIndex(): Promise<string> {
    const p = store.state.project;
    if (!p) return '';
    try {
      return formatProjectIndex(p.project.name, await listProjectFiles(), { perGroup: 12 });
    } catch {
      return '';
    }
  }

  /** Take the whole run back: the project is put as it was before Claude's first change of the run. */
  async rollBackRun(id: string): Promise<void> {
    const snap = this.snapshot;
    if (!snap || this.state.busy) return;
    try {
      const r = await rollBack(snap);
      this.snapshot = null;
      this.changesThisRun = 0;
      this.set({ rollbackAvailable: false });
      this.patchItem(id, { rolledBack: true, message: `Back as it was: ${r.restored} file${r.restored === 1 ? '' : 's'} put back, ${r.removed} removed.` } as Partial<ChatItem>);
      // everything the cards said they could undo has been undone with it
      for (const item of this.state.items) if (item.kind === 'proposal' && item.status === 'applied') this.patchItem(item.id, { status: 'undone', undoable: false } as Partial<ChatItem>);
    } catch (e) {
      this.patchItem(id, { message: `The run could not be rolled back: ${e instanceof Error ? e.message : String(e)}` } as Partial<ChatItem>);
    }
  }
}

const pngUrl = (png: Uint8Array): string => {
  let bin = '';
  for (let i = 0; i < png.length; i += 0x8000) bin += String.fromCharCode(...png.subarray(i, i + 0x8000));
  return `data:image/png;base64,${btoa(bin)}`;
};

/** What Claude is told after a change that made pictures: the words, and the pictures themselves so it can judge them. */
async function resultOf(proposal: Proposal, words: string): Promise<{ content: unknown }> {
  if (!proposal.images || proposal.images.length === 0 || proposal.tool === 'draw_sprite') return { content: words };
  const blocks: ToolOutput['content'] = [{ type: 'text', text: words }];
  for (const i of proposal.images.slice(0, 2)) (blocks as { type: string }[]).push({ type: 'image', source: { type: 'base64', media_type: 'image/png', data: pngUrl(i.png).slice(22) } } as never);
  return { content: blocks };
}

/** The assistant tools plugins add, as the model sees them: a name that cannot clash with the editor's, and the plugin's own wording. */
export function pluginToolName(plugin: string, id: string): string {
  return `${plugin}__${id}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 64);
}

function pluginToolDefs(): { name: string; description: string; input_schema: Record<string, unknown>; kind: 'read' | 'act' }[] {
  return [...host.ext.assistantTools.values()].slice(0, 20).map((t) => ({
    name: pluginToolName(t.plugin, t.id),
    description: `${t.description} (A tool added by the plugin "${t.plugin}".)`,
    input_schema: { type: 'object', ...(typeof t.input === 'object' && t.input ? t.input : { properties: {} }) },
    kind: t.kind === 'change' ? 'act' : 'read',
  }));
}

/** A plugin's own tool as a change to approve (or null when the name is not a plugin's tool). */
async function preparePluginAction(name: string, input: Record<string, unknown>): Promise<Proposal | null> {
  const def = [...host.ext.assistantTools.values()].find((t) => pluginToolName(t.plugin, t.id) === name);
  if (!def) return null;
  return {
    tool: name,
    title: `${def.plugin}: ${def.id.replace(/_/g, ' ')}`,
    lines: [def.preview ? def.preview(input) : `Runs the plugin's tool "${def.id}" (from "${def.plugin}").`],
    async apply() {
      return String(await def.run(input));
    },
  };
}

/** A plugin's own tool that only reads. */
export async function runPluginRead(name: string, input: Record<string, unknown>): Promise<ToolOutput | null> {
  const def = [...host.ext.assistantTools.values()].find((t) => pluginToolName(t.plugin, t.id) === name);
  if (!def) return null;
  try {
    return { content: String(await def.run(input)) };
  } catch (e) {
    return { isError: true, content: `The plugin's tool failed: ${e instanceof Error ? e.message : String(e)}` };
  }
}

export const assistant = new AssistantStore();

export function useAssistant<T>(selector: (s: AssistantState) => T): T {
  return useSyncExternalStore(assistant.subscribe, () => selector(assistant.getState()));
}
