import Anthropic from '@anthropic-ai/sdk';
import type { ModelCall, ModelClient } from './agent';

/**
 * The real model client, built on the official SDK. Only the Electron main process imports this file:
 * the API key never reaches the renderer (the editor's window), and the renderer bundle stays free of the SDK.
 */
export function createModelClient(opts: { apiKey: string; baseURL?: string }): ModelClient {
  const client = new Anthropic({ apiKey: opts.apiKey, ...(opts.baseURL ? { baseURL: opts.baseURL } : {}) });
  return {
    async stream(call: ModelCall): Promise<Anthropic.Message> {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const params = call.request as any;
      const stream = call.fallback
        ? // beta: when the model declines, the API re-runs the request on another model (nothing for us to do)
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (client.beta.messages.stream({ ...params, betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' }, { signal: call.signal }) as any)
        : client.messages.stream(params, { signal: call.signal });
      stream.on('text', (delta: string) => call.onText(delta));
      stream.on('thinking', (delta: string) => call.onThinking(delta));
      return (await stream.finalMessage()) as Anthropic.Message;
    },
  };
}

export type FailureKind = 'cancelled' | 'key' | 'permission' | 'rate' | 'overloaded' | 'network' | 'credit' | 'model' | 'request' | 'unknown';

export interface Failure {
  kind: FailureKind;
  /** Plain English, for the person using the editor. */
  message: string;
  /** Whether trying again can help. */
  retryable: boolean;
}

/** Turn an error from the SDK into something to show. Most specific classes first. */
export function friendlyError(e: unknown): Failure {
  if (e instanceof Anthropic.APIUserAbortError) return { kind: 'cancelled', message: 'Stopped.', retryable: false };
  if (e instanceof Anthropic.AuthenticationError) return { kind: 'key', message: 'Anthropic did not accept the API key. Check it in the Assistant settings (it should start with "sk-ant-").', retryable: false };
  if (e instanceof Anthropic.PermissionDeniedError) return { kind: 'permission', message: 'This API key is not allowed to use that model or feature. Pick another model in the settings, or check the key\'s permissions in the Anthropic console.', retryable: false };
  if (e instanceof Anthropic.NotFoundError) return { kind: 'model', message: 'Anthropic does not know that model. Pick another one in the Assistant settings.', retryable: false };
  if (e instanceof Anthropic.RateLimitError) return { kind: 'rate', message: 'Claude is receiving too many requests right now (a rate limit). Wait a moment, then press Retry.', retryable: true };
  if (e instanceof Anthropic.BadRequestError) {
    if (/credit balance/i.test(e.message)) return { kind: 'credit', message: 'The Anthropic account behind this key has no credit left. Add credit in the Anthropic console, then press Retry.', retryable: true };
    return { kind: 'request', message: `Anthropic could not use that request: ${e.message}`, retryable: false };
  }
  if (e instanceof Anthropic.APIConnectionError) return { kind: 'network', message: 'Could not reach Anthropic. Check your internet connection, then press Retry. The rest of the editor works without it.', retryable: true };
  if (e instanceof Anthropic.APIError) {
    if (e.status === 529) return { kind: 'overloaded', message: 'Claude is overloaded at the moment. Wait a little, then press Retry.', retryable: true };
    if (e.status !== undefined && e.status >= 500) return { kind: 'overloaded', message: 'Anthropic had a problem on its side. Press Retry in a moment.', retryable: true };
    return { kind: 'unknown', message: `Anthropic reported an error (${e.status ?? 'no status'}): ${e.message}`, retryable: false };
  }
  return { kind: 'unknown', message: e instanceof Error ? e.message : 'Something went wrong talking to Claude.', retryable: false };
}
