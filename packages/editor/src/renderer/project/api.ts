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
