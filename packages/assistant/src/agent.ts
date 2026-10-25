import type Anthropic from '@anthropic-ai/sdk';
import { NO_USAGE, addUsage, estimateCost, formatCost, usageOf, type AssistantSettings, type Usage } from './models';
import { systemPromptWith } from './prompt';
import { checkToolInput, getTool, toolDefinitions, type ToolKind } from './tools';

/** What we send for one model call (the shape of a Messages API request, without the SDK's types). */
/** A tool a plugin adds for the assistant. Its input is not checked here (the plugin does that); the name is made so it cannot be mistaken for one of the editor's. */
export interface ExtraTool {
  name: string;
  description: string;
  input_schema: { type: 'object'; [k: string]: unknown };
  kind: ToolKind;
}

export interface ModelRequest {
  model: string;
  max_tokens: number;
  thinking: { type: 'adaptive'; display: 'summarized' };
  output_config: { effort: string };
  system: string;
  tools: ReturnType<typeof toolDefinitions>;
  cache_control: { type: 'ephemeral' };
  messages: Anthropic.MessageParam[];
}

export interface ModelCall {
  request: ModelRequest;
  signal: AbortSignal;
  /** Try the server-side fallback when the first model declines (see the settings). */
  fallback: boolean;
  onText(delta: string): void;
  onThinking(delta: string): void;
}

/** The thing that talks to the API. The real one wraps the SDK (main process); tests script their own. */
export interface ModelClient {
  stream(call: ModelCall): Promise<Anthropic.Message>;
}

export type ToolContentBlock =
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp'; data: string } }
  | { type: 'document'; title?: string; source: { type: 'base64'; media_type: 'application/pdf'; data: string } };

/**
 * What the window hands back for a tool call, checked before it goes to the API: only text, pictures and PDFs, with their sizes
 * kept in bounds, so a plugin's tool (or a bug) cannot put something else in a conversation.
 */
export function cleanToolOutput(raw: unknown): ToolOutput {
  const o = (raw ?? {}) as { content?: unknown; isError?: unknown };
  const isError = o.isError === true;
  if (typeof o.content === 'string') return { content: o.content, ...(isError ? { isError } : {}) };
  if (!Array.isArray(o.content)) return { isError: true, content: 'The tool returned nothing Claude can read.' };
  const out: ToolContentBlock[] = [];
  let weight = 0;
  for (const b of o.content.slice(0, 20)) {
    const r = b as Partial<ToolContentBlock> & { source?: { type?: unknown; media_type?: unknown; data?: unknown } };
    if (r.type === 'text' && typeof r.text === 'string') out.push({ type: 'text', text: r.text });
    else if ((r.type === 'image' || r.type === 'document') && r.source?.type === 'base64' && typeof r.source.data === 'string' && /^[A-Za-z0-9+/]+=*$/.test(r.source.data)) {
      weight += r.source.data.length;
      if (weight > MAX_TOOL_FILE_BASE64) {
        out.push({ type: 'text', text: '(A file was left out: together they were too big to send.)' });
        continue;
      }
      if (r.type === 'image' && ['image/png', 'image/jpeg', 'image/gif', 'image/webp'].includes(String(r.source.media_type))) out.push({ type: 'image', source: { type: 'base64', media_type: r.source.media_type as 'image/png', data: r.source.data } });
      else if (r.type === 'document' && r.source.media_type === 'application/pdf') out.push({ type: 'document', ...(typeof r.title === 'string' ? { title: r.title.slice(0, 200) } : {}), source: { type: 'base64', media_type: 'application/pdf', data: r.source.data } });
    }
  }
  return { content: out.length > 0 ? out : 'The tool returned nothing Claude can read.', ...(isError ? { isError } : {}) };
}

export interface ToolOutput {
  content: string | ToolContentBlock[];
  isError?: boolean;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  kind: ToolKind;
  /** Already checked against the tool's schema. */
  input: Record<string, unknown>;
}

export type RunTool = (call: ToolCallInfo, signal: AbortSignal) => Promise<ToolOutput>;

export interface TurnHooks {
  onText?(delta: string): void;
  onThinking?(delta: string): void;
  /** After each model call: this conversation's token totals and estimated cost so far, and what this run (since the question) has cost. */
  onUsage?(total: Usage, cost: number, run: { cost: number; tokens: number }): void;
}

export type StopReason = 'end_turn' | 'refusal' | 'max_tokens' | 'cancelled' | 'step_limit' | 'cost_limit';

/** A picture the person attached to a question. */
export interface Attachment {
  name: string;
  mediaType: 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp' | 'application/pdf';
  /** Base64, no prefix. */
  data: string;
}

/** Most pictures one question may carry, and the most one may weigh (the API takes 5 MB each). */
export const MAX_ATTACHMENTS = 6;
/** The most tools of plugins (and the lists of their kinds of data) one conversation is given. */
export const MAX_EXTRA_TOOLS = 100;
export const MAX_ATTACHMENT_BYTES = 3_500_000;
/** A PDF the person attaches may be bigger (the API takes 32 MB a request, and pages count too). */
export const MAX_PDF_ATTACHMENT_BYTES = 12 * 1024 * 1024;
/** The most pictures and PDFs one tool result may carry together (base64 characters). */
export const MAX_TOOL_FILE_BASE64 = 20 * 1024 * 1024;

export interface TurnResult {
  stopReason: StopReason;
  /** The final reply's text. */
  text: string;
  /** Something the person should be told (a refusal, a cut-off reply). */
  notice?: string;
}

/** Most model calls one question may use (each tool round is one), so a confused loop cannot run up a bill. */
export const MAX_STEPS = 30;
const MAX_TOKENS = 64_000;
const MAX_TOOL_TEXT = 60_000;

export function limitText(text: string, max = MAX_TOOL_TEXT): string {
  return text.length <= max ? text : `${text.slice(0, max)}\n... (cut: ${text.length - max} more characters. Ask for a smaller part.)`;
}

function resultBlock(id: string, out: ToolOutput): Anthropic.ToolResultBlockParam {
  const content = typeof out.content === 'string' ? limitText(out.content) : out.content.map((b) => (b.type === 'text' ? { ...b, text: limitText(b.text) } : b));
  return { type: 'tool_result', tool_use_id: id, content, ...(out.isError ? { is_error: true } : {}) };
}

const textOf = (content: Anthropic.ContentBlock[]): string =>
  content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');

/**
 * One conversation with Claude about a project. The message list only ever grows (thinking blocks and tool
 * calls are passed back exactly as received), the system prompt and tool list never change, and the opening
 * message carries the project facts, so each request is the previous one plus a little: that is what keeps
 * the prompt cache hitting.
 */
export class Conversation {
  readonly messages: Anthropic.MessageParam[] = [];
  usage: Usage = NO_USAGE;
  cost = 0;
  private fallbackBroken = false;
  /** What this run (the last question and everything it led to) has used so far. */
  private runStart = { cost: 0, tokens: 0 };

  constructor(
    private readonly deps: {
      client: ModelClient;
      runTool: RunTool;
      settings(): AssistantSettings;
      /** What the plugins that are on tell the assistant (their behaviours, blocks and rules). */
      notes?(): readonly string[];
      /** The tools those plugins add. */
      extraTools?(): readonly ExtraTool[];
    },
  ) {}

  get started(): boolean {
    return this.messages.length > 0;
  }

  reset(): void {
    this.messages.length = 0;
    this.usage = NO_USAGE;
    this.cost = 0;
  }

  /** Whether the last model call failed before answering (the list ends with the person's message), so Retry makes sense. */
  get canResume(): boolean {
    return this.messages.at(-1)?.role === 'user';
  }

  /** Ask a question. `context` (project facts) is added to the first message of a conversation only. */
  async send(text: string, opts: { context?: string; attachments?: readonly Attachment[]; signal: AbortSignal; hooks?: TurnHooks }): Promise<TurnResult> {
    const content: (Anthropic.TextBlockParam | Anthropic.ImageBlockParam | Anthropic.DocumentBlockParam)[] = [];
    if (!this.started && opts.context) content.push({ type: 'text', text: opts.context });
    // pictures come before the words that talk about them
    for (const a of (opts.attachments ?? []).slice(0, MAX_ATTACHMENTS)) {
      if (a.mediaType === 'application/pdf') {
        content.push({ type: 'text', text: `(Attached document: ${a.name})` });
        content.push({ type: 'document', title: a.name, source: { type: 'base64', media_type: 'application/pdf', data: a.data } });
      } else {
        content.push({ type: 'text', text: `(Attached picture: ${a.name})` });
        content.push({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } });
      }
    }
    content.push({ type: 'text', text });
    this.messages.push({ role: 'user', content });
    return this.run(opts.signal, opts.hooks ?? {});
  }

  /** Run the last message again (after a network error or rate limit). */
  resume(opts: { signal: AbortSignal; hooks?: TurnHooks }): Promise<TurnResult> {
    this.resumed = true;
    return this.run(opts.signal, opts.hooks ?? {});
  }

  private resumed = false;

  private get tokens(): number {
    return this.usage.inputTokens + this.usage.outputTokens + this.usage.cacheWriteTokens + this.usage.cacheReadTokens;
  }

  /** What the current run has cost so far. */
  get runUsage(): { cost: number; tokens: number } {
    return { cost: this.cost - this.runStart.cost, tokens: this.tokens - this.runStart.tokens };
  }

  private async run(signal: AbortSignal, hooks: TurnHooks): Promise<TurnResult> {
    // a question starts a run; Retry carries on with the one that failed
    if (this.messages.at(-1)?.role === 'user' && !this.resumed) this.runStart = { cost: this.cost, tokens: this.tokens };
    this.resumed = false;
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return { stopReason: 'cancelled', text: '' };
      const settings = this.deps.settings();
      const request: ModelRequest = {
        model: settings.model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: settings.effort },
        system: systemPromptWith(this.deps.notes?.() ?? []),
        tools: [...toolDefinitions(), ...(this.deps.extraTools?.() ?? []).map((t) => ({ name: t.name, description: t.description, input_schema: t.input_schema, eager_input_streaming: true }))],
        cache_control: { type: 'ephemeral' },
        messages: [...this.messages],
      };
      let message: Anthropic.Message;
      try {
        message = await this.deps.client.stream({
          request,
          signal,
          fallback: settings.fallback && !this.fallbackBroken,
          onText: (d) => hooks.onText?.(d),
          onThinking: (d) => hooks.onThinking?.(d),
        });
      } catch (e) {
        if (signal.aborted) return { stopReason: 'cancelled', text: '' };
        // the server-side fallback is a beta: if the API rejects it, carry on without it from now on
        if (settings.fallback && !this.fallbackBroken && isFallbackRejection(e)) {
          this.fallbackBroken = true;
          step--;
          continue;
        }
        throw e;
      }
      this.usage = addUsage(this.usage, usageOf(message.usage));
      this.cost = estimateCost(settings.model, this.usage);
      hooks.onUsage?.(this.usage, this.cost, this.runUsage);

      if (message.stop_reason === 'refusal') {
        if (message.content.length > 0) this.messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] });
        const category = (message as { stop_details?: { category?: string | null } }).stop_details?.category;
        return { stopReason: 'refusal', text: textOf(message.content), notice: `Claude declined this request${category ? ` (${category})` : ''}. Try rephrasing it, or ask for something different.` };
      }

      this.messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] });
      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

      const limit = settings.runLimit;
      const overLimit = limit > 0 && this.runUsage.cost >= limit;
      if (overLimit && message.stop_reason !== 'pause_turn') {
        // a reply that asked for tools must be answered before the conversation can go on, so say they were not run
        if (calls.length > 0) this.messages.push({ role: 'user', content: calls.map((c) => resultBlock(c.id, { isError: true, content: 'The run reached its cost limit, so this was not run.' })) });
        return { stopReason: 'cost_limit', text: textOf(message.content), notice: `Claude stopped because this question has cost about ${formatCost(this.runUsage.cost)}, which is the limit you set (${formatCost(limit)}). Ask it to carry on, or raise the limit in the settings.` };
      }
      if (message.stop_reason === 'pause_turn') continue;
      if (calls.length === 0) {
        if (message.stop_reason === 'max_tokens') return { stopReason: 'max_tokens', text: textOf(message.content), notice: 'The reply was cut off because it got too long. Ask Claude to continue, or to do it in smaller steps.' };
        return { stopReason: 'end_turn', text: textOf(message.content) };
      }

      // never run tools from a reply that was cut off: their inputs may be incomplete
      const truncated = message.stop_reason === 'max_tokens';
      const results = await Promise.all(
        calls.map(async (c): Promise<Anthropic.ToolResultBlockParam> => {
          if (truncated) return resultBlock(c.id, { isError: true, content: 'Your reply was cut off before this tool call was complete, so it was not run. Try again with a smaller step.' });
          if (signal.aborted) return resultBlock(c.id, { isError: true, content: 'The user stopped the conversation before this ran.' });
          const extra = (this.deps.extraTools?.() ?? []).find((t) => t.name === c.name);
          const check = extra ? { ok: true as const, value: (c.input && typeof c.input === 'object' ? c.input : {}) as Record<string, unknown> } : checkToolInput(c.name, c.input);
          if (!check.ok) return resultBlock(c.id, { isError: true, content: check.message });
          try {
            return resultBlock(c.id, await this.deps.runTool({ id: c.id, name: c.name, kind: extra?.kind ?? getTool(c.name)!.kind, input: check.value }, signal));
          } catch (e) {
            return resultBlock(c.id, { isError: true, content: `The tool failed: ${e instanceof Error ? e.message : String(e)}` });
          }
        }),
      );
      // all results of one reply go back together, in one message
      this.messages.push({ role: 'user', content: results });
      if (signal.aborted) return { stopReason: 'cancelled', text: '' };
    }
    return { stopReason: 'step_limit', text: '', notice: `Claude used ${MAX_STEPS} steps on this and has not finished. Ask it to carry on if you want it to keep going.` };
  }
}

function isFallbackRejection(e: unknown): boolean {
  const err = e as { status?: number; message?: string };
  return err?.status === 400 && /fallback|beta/i.test(err.message ?? '');
}
