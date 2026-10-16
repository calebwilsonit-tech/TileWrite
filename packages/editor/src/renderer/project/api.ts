import type { ExportJob, ExportResult } from '@tilewright/exporter';

export interface AssistantStatus {
  hasKey: boolean;
  canStoreKey: boolean;
  customEndpoint: boolean;
  busy: boolean;
  started: boolean;
}

export type AssistantEvent =
  | { type: 'text'; delta: string }
  | { type: 'thinking'; delta: string }
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }; cost: number }
  | { type: 'done'; result: { stopReason: string; text: string; notice?: string } }
  | { type: 'error'; message: string; kind: string; retryable: boolean };

export interface AssistantToolCall {
  callId: string;
  name: string;
  kind: 'read' | 'act';
  input: Record<string, unknown>;
}

/** Typed view of what the preload script exposes as `window.tilewright`. */
export interface TilewrightApi {
  platform: string;
  versions: { electron: string; chrome: string };
  info(): Promise<{ version: string; userData: string; testMode: boolean; platform: string }>;
  chooseFolder(title: string): Promise<string | null>;
  importFile(title: string, extensions: string[]): Promise<{ name: string; bytes: Uint8Array } | null>;
  fs: {
    read(file: string): Promise<string>;
    readBinary(file: string): Promise<Uint8Array>;
    writeBinary(file: string, bytes: Uint8Array): Promise<void>;
    write(file: string, text: string): Promise<void>;
    exists(file: string): Promise<boolean>;
    remove(file: string): Promise<void>;
    list(dir: string): Promise<{ name: string; dir: boolean }[]>;
  };
  settings: {
    get(): Promise<Record<string, unknown>>;
    set(s: Record<string, unknown>): Promise<void>;
  };
  assistant: {
    status(): Promise<AssistantStatus>;
    setKey(key: string): Promise<AssistantStatus>;
    clearKey(): Promise<AssistantStatus>;
    send(args: { text: string; mode: string; context: string; settings: unknown }): Promise<{ started: boolean; reason?: string }>;
    retry(settings: unknown): Promise<{ started: boolean; reason?: string }>;
    cancel(): Promise<void>;
    reset(): Promise<void>;
    toolResult(callId: string, out: unknown): Promise<void>;
    onEvent(fn: (ev: AssistantEvent) => void): () => void;
    onToolCall(fn: (call: AssistantToolCall) => void): () => void;
  };
  exporter: {
    info(): Promise<{ platform: string; canExport: boolean; version: string }>;
    build(job: ExportJob): Promise<ExportResult>;
    onProgress(fn: (text: string) => void): () => void;
  };
  recent: {
    list(): Promise<{ dir: string; name: string; opened: number }[]>;
    add(dir: string, name: string): Promise<void>;
    remove(dir: string): Promise<void>;
    allow(dir: string): Promise<string>;
  };
}

declare global {
  interface Window {
    tilewright: TilewrightApi;
  }
}

export const api = (): TilewrightApi => window.tilewright;

/** Join path parts with the separator the file already uses (Windows or POSIX). */
export function joinPath(base: string, ...parts: string[]): string {
  const sep = base.includes('\\') ? '\\' : '/';
  return [base.replace(/[\\/]+$/, ''), ...parts.map((p) => p.replace(/^[\\/]+|[\\/]+$/g, '').replace(/[\\/]/g, sep))].join(sep);
}
