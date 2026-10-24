import type { ExportJob, ExportResult, PreviewJob } from '@tilewright/exporter';

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
  | { type: 'usage'; usage: { inputTokens: number; outputTokens: number; cacheWriteTokens: number; cacheReadTokens: number }; cost: number; run: { cost: number; tokens: number } }
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
  info(): Promise<{ version: string; userData: string; library: string; testMode: boolean; platform: string }>;
  chooseFolder(title: string): Promise<string | null>;
  importFile(title: string, extensions: string[]): Promise<{ name: string; bytes: Uint8Array } | null>;
  /** Pick where to save a text file (an asset pack); returns where it went, or null when cancelled. */
  saveFile(title: string, suggested: string, text: string): Promise<string | null>;
  /** A request to an asset hub, made by the main process. */
  hubRequest(req: { method: string; url: string; token?: string; body?: string }): Promise<{ status: number; text: string; version: string }>;
  fs: {
    read(file: string): Promise<string>;
    readBinary(file: string): Promise<Uint8Array>;
    writeBinary(file: string, bytes: Uint8Array): Promise<void>;
    write(file: string, text: string): Promise<void>;
    exists(file: string): Promise<boolean>;
    remove(file: string): Promise<void>;
    list(dir: string): Promise<{ name: string; dir: boolean; size?: number }[]>;
  };
  plugins: {
    /** The folder installed plugins live in: <store>/<id>/<version>/. */
    store(): Promise<string>;
    list(): Promise<{ id: string; version: string; dir: string }[]>;
    installFolder(dir: string): Promise<{ id: string; version: string; dir: string }>;
    installBundle(text: string): Promise<{ id: string; version: string; dir: string }>;
    fetch(address: string): Promise<string>;
    remove(id: string, version?: string): Promise<void>;
    watch(dir: string): Promise<void>;
    unwatch(dir: string): Promise<void>;
    runProgram(pluginName: string, command: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }>;
    onChanged(fn: (dir: string) => void): () => void;
  };
  settings: {
    get(): Promise<Record<string, unknown>>;
    set(s: Record<string, unknown>): Promise<void>;
  };
  assistant: {
    status(): Promise<AssistantStatus>;
    setKey(key: string): Promise<AssistantStatus>;
    clearKey(): Promise<AssistantStatus>;
    /** Keys for the picture services plugins use, one per provider (kept by the system keychain). */
    providerKey: { has(id: string): Promise<boolean>; get(id: string): Promise<string | null>; set(id: string, key: string): Promise<void>; clear(id: string): Promise<void> };
    send(args: { text: string; mode: string; context: string; settings: unknown; notes?: readonly string[]; attachments?: readonly { name: string; mediaType: string; data: string }[]; pluginTools?: readonly unknown[] }): Promise<{ started: boolean; reason?: string }>;
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
  preview: {
    open(job: PreviewJob): Promise<{ windows: number }>;
  };
  samples: {
    list(): Promise<{ id: string; name: string }[]>;
    copy(id: string, parentDir: string): Promise<string>;
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
