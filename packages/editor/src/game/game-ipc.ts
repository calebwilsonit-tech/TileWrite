import { ipcMain, type IpcMainInvokeEvent } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

/** What a game window is allowed to touch, and where it keeps things. One per running game. */
export interface GameContext {
  name: string;
  version: string;
  /** The game's own files: read-only. */
  dataDir: string;
  /** Saves and settings: the only place the game may write. */
  savesDir: string;
  logsDir: string;
  testMode: boolean;
  /** Write a report file and return where it is. */
  writeLog(kind: string, text: string): Promise<string>;
  /** The game asked to quit. */
  quit(e: IpcMainInvokeEvent): void;
  /** Switch full screen on, off, or (undefined) the other way. */
  fullscreen(e: IpcMainInvokeEvent, on?: boolean): void;
}

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The file bridge and window controls a game page uses (through `game-preload`): the game may read its own data and
 * saves, write only to its saves folder, and nothing else. An exported game registers these once with no prefix; the
 * editor's "Run in a window" registers them with a prefix and a context per window.
 */
export function registerGameIpc(prefix: string, contextFor: (e: IpcMainInvokeEvent) => GameContext | null): void {
  const on = <A extends unknown[], R>(channel: string, fn: (ctx: GameContext, e: IpcMainInvokeEvent, ...args: A) => R | Promise<R>): void => {
    ipcMain.handle(prefix + channel, (e, ...args) => {
      const ctx = contextFor(e);
      if (!ctx) throw new Error('This window is not a game.');
      return fn(ctx, e, ...(args as A));
    });
  };
  const readable = (ctx: GameContext, file: string): string => {
    const r = path.resolve(file);
    if (inside(ctx.dataDir, r) || inside(ctx.savesDir, r)) return r;
    throw new Error('The game tried to read a file outside its own folders.');
  };
  const writable = (ctx: GameContext, file: string): string => {
    const r = path.resolve(file);
    if (inside(ctx.savesDir, r)) return r;
    throw new Error('The game may only write to its save folder.');
  };

  on('game:info', (ctx) => ({ name: ctx.name, version: ctx.version, dataDir: ctx.dataDir, savesDir: ctx.savesDir, logsDir: ctx.logsDir, platform: process.platform, testMode: ctx.testMode }));
  on('game:crash', (ctx, _e, text: string) => ctx.writeLog('crash', String(text).slice(0, 200_000)));
  on('game:quit', (ctx, e) => ctx.quit(e));
  on('game:fullscreen', (ctx, e, flag?: unknown) => ctx.fullscreen(e, typeof flag === 'boolean' ? flag : undefined));
  on('fs:read', (ctx, _e, file: string) => fs.readFile(readable(ctx, file), 'utf8'));
  on('fs:readBinary', async (ctx, _e, file: string) => new Uint8Array(await fs.readFile(readable(ctx, file))));
  on('fs:exists', async (ctx, _e, file: string) => {
    try {
      await fs.access(readable(ctx, file));
      return true;
    } catch {
      return false;
    }
  });
  on('fs:list', async (ctx, _e, dir: string) => {
    const entries = await fs.readdir(readable(ctx, dir), { withFileTypes: true });
    return entries.map((x) => ({ name: x.name, dir: x.isDirectory() }));
  });
  on('fs:write', async (ctx, _e, file: string, text: string) => {
    const target = writable(ctx, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
  });
  on('fs:writeBinary', async (ctx, _e, file: string, bytes: Uint8Array) => {
    const target = writable(ctx, file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  });
  on('fs:remove', async (ctx, _e, file: string) => {
    await fs.rm(writable(ctx, file), { force: true });
  });
}
