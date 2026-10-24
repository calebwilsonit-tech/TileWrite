import { useSyncExternalStore } from 'react';
import { DEFAULT_SETTINGS, buildContext, cleanSettings, type AssistantSettings, type Mode, type Usage, NO_USAGE } from '@tilewright/assistant';
import { host } from '@tilewright/behaviors';
import { store } from '../app/store';
import { api, type AssistantEvent, type AssistantStatus, type AssistantToolCall } from '../project/api';
import { ToolProblem, prepareAction, readNotes, runReadTool, sceneProblems, type Proposal } from './editor-tools';

export type ProposalStatus = 'pending' | 'applied' | 'rejected' | 'failed' | 'undone';

export type ChatItem =
  | { kind: 'user'; id: string; text: string; mode: Mode }
  | { kind: 'assistant'; id: string; text: string; thinking: string }
  | { kind: 'tool'; id: string; name: string; status: 'running' | 'done' | 'error'; detail: string }
  | { kind: 'proposal'; id: string; tool: string; title: string; lines: string[]; diff?: Proposal['diff']; status: ProposalStatus; message: string; undoable: boolean }
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
}

const INITIAL: AssistantState = { ready: false, status: null, settings: DEFAULT_SETTINGS, items: [], busy: false, usage: NO_USAGE, cost: 0, error: null, draft: '', mode: 'chat', notes: '', tick: 0 };

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
    this.push({ kind: 'user', id: nextId('u'), text: trimmed, mode });
    this.set({ busy: true, error: null, draft: '', mode: 'chat' });
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
    });
    const r = await api().assistant.send({ text: trimmed, mode, context, settings: this.state.settings, notes: host.assistantNotes() });
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
        this.set({ usage: ev.usage, cost: ev.cost });
        break;
      case 'done':
        this.rejectAll();
        this.set({ busy: false });
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
        const out = await runReadTool(call.name, call.input);
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

  private async handleAct(call: AssistantToolCall, reply: (out: { content: unknown; isError?: boolean }) => void): Promise<void> {
    let proposal: Proposal;
    try {
      proposal = await prepareAction(call.name, call.input);
    } catch (e) {
      if (!(e instanceof ToolProblem)) throw e;
      this.push({ kind: 'tool', id: call.callId, name: call.name, status: 'error', detail: e.message });
      reply({ isError: true, content: e.message });
      return;
    }
    this.push({ kind: 'proposal', id: call.callId, tool: call.name, title: proposal.title, lines: proposal.lines, diff: proposal.diff, status: 'pending', message: '', undoable: false });
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
      if (proposal.undo) this.undoers.set(call.callId, proposal.undo);
      this.patchItem(call.callId, { status: 'applied', message, undoable: proposal.undo !== undefined } as Partial<ChatItem>);
      reply({ content: `Applied. ${message}` });
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
}

export const assistant = new AssistantStore();

export function useAssistant<T>(selector: (s: AssistantState) => T): T {
  return useSyncExternalStore(assistant.subscribe, () => selector(assistant.getState()));
}
