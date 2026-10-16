import { app, ipcMain, safeStorage, type WebContents } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { Conversation, cleanSettings, type AssistantSettings, type Mode, type ModelClient, type RunTool, type ToolOutput, type TurnResult, type Usage, userTurnText } from '@tilewright/assistant';
import { createModelClient, friendlyError } from '@tilewright/assistant/src/sdk-client';

/**
 * The Claude assistant's side of the editor that must not live in the window: the API key and every call to
 * Anthropic. The window (renderer) only ever sees chat text, tool requests and usage numbers.
 *
 * The key is stored with the operating system's keychain (Electron safeStorage: Windows DPAPI, macOS Keychain,
 * libsecret) in the app's own data folder, never in a project, a log, an export or the settings file.
 */

const KEY_FILE = (): string => path.join(app.getPath('userData'), 'assistant-key.bin');

/** Tests and proxies can point the SDK somewhere else; the editor says so when this is in use. */
const BASE_URL = process.env.TILEWRIGHT_ASSISTANT_BASE_URL || undefined;

let keyCache: string | null | undefined;

async function readKey(): Promise<string | null> {
  if (keyCache !== undefined) return keyCache;
  try {
    const bytes = await fs.readFile(KEY_FILE());
    keyCache = safeStorage.isEncryptionAvailable() ? safeStorage.decryptString(bytes) : null;
  } catch {
    keyCache = null;
  }
  return keyCache;
}

async function saveKey(key: string): Promise<void> {
  if (!safeStorage.isEncryptionAvailable()) throw new Error('This computer has no secure place to keep the key (no system keychain is available), so Tilewright will not store it. Nothing was saved.');
  await fs.mkdir(app.getPath('userData'), { recursive: true });
  await fs.writeFile(KEY_FILE(), safeStorage.encryptString(key));
  keyCache = key;
}

async function clearKey(): Promise<void> {
  await fs.rm(KEY_FILE(), { force: true });
  keyCache = null;
}

type Event =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'usage'; usage: Usage; cost: number }
  | { type: 'done'; result: TurnResult }
  | { type: 'error'; message: string; kind: string; retryable: boolean };

interface Pending {
  resolve(out: ToolOutput): void;
}

export function registerAssistant(): void {
  let busy = false;
  let controller: AbortController | null = null;
  let settings: AssistantSettings = cleanSettings(undefined);
  const pending = new Map<string, Pending>();
  let sender: WebContents | null = null;

  const emit = (ev: Event): void => {
    if (sender && !sender.isDestroyed()) sender.send('assistant:event', ev);
  };

  const client: ModelClient = {
    async stream(call) {
      const apiKey = await readKey();
      if (!apiKey) throw Object.assign(new Error('NO_KEY'), { noKey: true });
      return createModelClient({ apiKey, ...(BASE_URL ? { baseURL: BASE_URL } : {}) }).stream(call);
    },
  };

  const runTool: RunTool = (call, signal) =>
    new Promise<ToolOutput>((resolve) => {
      if (!sender || sender.isDestroyed()) return resolve({ isError: true, content: 'The editor window is closed.' });
      pending.set(call.id, { resolve });
      signal.addEventListener('abort', () => {
        if (pending.delete(call.id)) resolve({ isError: true, content: 'The user stopped the conversation before this finished.' });
      });
      sender.send('assistant:tool-call', { callId: call.id, name: call.name, kind: call.kind, input: call.input });
    });

  const conversation = new Conversation({ client, runTool, settings: () => settings });

  async function status(): Promise<{ hasKey: boolean; canStoreKey: boolean; customEndpoint: boolean; busy: boolean; started: boolean }> {
    return { hasKey: (await readKey()) !== null, canStoreKey: safeStorage.isEncryptionAvailable(), customEndpoint: BASE_URL !== undefined, busy, started: conversation.started };
  }

  async function turn(run: (signal: AbortSignal) => Promise<TurnResult>): Promise<{ started: boolean; reason?: string }> {
    if (busy) return { started: false, reason: 'Claude is still working on the last message.' };
    if ((await readKey()) === null) {
      emit({ type: 'error', kind: 'key', retryable: false, message: 'Add your Anthropic API key in the Assistant settings first.' });
      return { started: false, reason: 'no key' };
    }
    busy = true;
    controller = new AbortController();
    const signal = controller.signal;
    void (async () => {
      try {
        const result = await run(signal);
        emit({ type: 'done', result });
      } catch (e) {
        const f = friendlyError(e);
        if (f.kind !== 'cancelled') emit({ type: 'error', kind: f.kind, message: f.message, retryable: f.retryable && conversation.canResume });
        else emit({ type: 'done', result: { stopReason: 'cancelled', text: '' } });
      } finally {
        busy = false;
        controller = null;
        for (const p of pending.values()) p.resolve({ isError: true, content: 'The turn ended before this finished.' });
        pending.clear();
      }
    })();
    return { started: true };
  }

  const hooks = {
    onText: (delta: string) => emit({ type: 'text', delta }),
    onThinking: (delta: string) => emit({ type: 'thinking', delta }),
    onUsage: (usage: Usage, cost: number) => emit({ type: 'usage', usage, cost }),
  };

  ipcMain.handle('assistant:status', () => status());

  ipcMain.handle('assistant:set-key', async (_e, key: unknown) => {
    const k = typeof key === 'string' ? key.trim() : '';
    if (!k || /\s/.test(k) || k.length > 400) throw new Error('That does not look like an API key. Copy the whole key from the Anthropic console (it starts with "sk-ant-").');
    await saveKey(k);
    return status();
  });

  ipcMain.handle('assistant:clear-key', async () => {
    controller?.abort();
    await clearKey();
    return status();
  });

  ipcMain.handle('assistant:send', (e, args: { text: string; mode: Mode; context: string; settings: unknown }) => {
    sender = e.sender;
    settings = cleanSettings(args.settings);
    const text = userTurnText(args.mode, String(args.text ?? ''));
    return turn((signal) => conversation.send(text, { context: String(args.context ?? ''), signal, hooks }));
  });

  ipcMain.handle('assistant:retry', (e, rawSettings: unknown) => {
    sender = e.sender;
    settings = cleanSettings(rawSettings);
    if (!conversation.canResume) return { started: false, reason: 'There is nothing to retry.' };
    return turn((signal) => conversation.resume({ signal, hooks }));
  });

  ipcMain.handle('assistant:cancel', () => {
    controller?.abort();
  });

  ipcMain.handle('assistant:reset', () => {
    controller?.abort();
    conversation.reset();
  });

  ipcMain.handle('assistant:tool-result', (_e, callId: string, out: ToolOutput) => {
    const p = pending.get(callId);
    if (!p) return;
    pending.delete(callId);
    p.resolve(out);
  });
}
