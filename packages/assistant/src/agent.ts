import type Anthropic from '@anthropic-ai/sdk';
import { NO_USAGE, addUsage, estimateCost, usageOf, type AssistantSettings, type Usage } from './models';
import { SYSTEM_PROMPT } from './prompt';
import { checkToolInput, getTool, toolDefinitions, type ToolKind } from './tools';

/** What we send for one model call (the shape of a Messages API request, without the SDK's types). */
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

export type ToolContentBlock = { type: 'text'; text: string } | { type: 'image'; source: { type: 'base64'; media_type: 'image/png'; data: string } };

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
  /** After each model call: this conversation's token totals and estimated cost so far. */
  onUsage?(total: Usage, cost: number): void;
}

export type StopReason = 'end_turn' | 'refusal' | 'max_tokens' | 'cancelled' | 'step_limit';

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

  constructor(
    private readonly deps: {
      client: ModelClient;
      runTool: RunTool;
      settings(): AssistantSettings;
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
  async send(text: string, opts: { context?: string; signal: AbortSignal; hooks?: TurnHooks }): Promise<TurnResult> {
    const content: Anthropic.TextBlockParam[] = [];
    if (!this.started && opts.context) content.push({ type: 'text', text: opts.context });
    content.push({ type: 'text', text });
    this.messages.push({ role: 'user', content });
    return this.run(opts.signal, opts.hooks ?? {});
  }

  /** Run the last message again (after a network error or rate limit). */
  resume(opts: { signal: AbortSignal; hooks?: TurnHooks }): Promise<TurnResult> {
    return this.run(opts.signal, opts.hooks ?? {});
  }

  private async run(signal: AbortSignal, hooks: TurnHooks): Promise<TurnResult> {
    for (let step = 0; step < MAX_STEPS; step++) {
      if (signal.aborted) return { stopReason: 'cancelled', text: '' };
      const settings = this.deps.settings();
      const request: ModelRequest = {
        model: settings.model,
        max_tokens: MAX_TOKENS,
        thinking: { type: 'adaptive', display: 'summarized' },
        output_config: { effort: settings.effort },
        system: SYSTEM_PROMPT,
        tools: toolDefinitions(),
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
      hooks.onUsage?.(this.usage, this.cost);

      if (message.stop_reason === 'refusal') {
        if (message.content.length > 0) this.messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] });
        const category = (message as { stop_details?: { category?: string | null } }).stop_details?.category;
        return { stopReason: 'refusal', text: textOf(message.content), notice: `Claude declined this request${category ? ` (${category})` : ''}. Try rephrasing it, or ask for something different.` };
      }

      this.messages.push({ role: 'assistant', content: message.content as Anthropic.ContentBlockParam[] });
      const calls = message.content.filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');

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
          const check = checkToolInput(c.name, c.input);
          if (!check.ok) return resultBlock(c.id, { isError: true, content: check.message });
          try {
            return resultBlock(c.id, await this.deps.runTool({ id: c.id, name: c.name, kind: getTool(c.name)!.kind, input: check.value }, signal));
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
