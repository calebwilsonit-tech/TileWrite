import { contextBridge, ipcRenderer } from 'electron';

// An exported game uses plain channel names. The editor's "Run in a window" starts the same page with
// `--tw-prefix=preview:` so its channels cannot be confused with the editor's own.
const prefix = process.argv.find((a) => a.startsWith('--tw-prefix='))?.slice('--tw-prefix='.length) ?? '';
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(prefix + channel, ...args) as Promise<T>;

/**
 * The only door between a game and the computer: its own data (read), its saves (read and write), a crash log, quit. Plugins from
 * outside run in the game's page, so the door is handed over once to the first code that asks (the player, at startup) and the
 * global holds nothing after that. Tests of exported games keep it where they can see it.
 */
const testHooks = process.env.TILEWRIGHT_GAME_TEST === '1' || process.env.TILEWRIGHT_TEST_DIR !== undefined;
const door = {
  platform: process.platform,
  fs: {
    read: (file: string) => invoke<string>('fs:read', file),
    readBinary: (file: string) => invoke<Uint8Array>('fs:readBinary', file),
    writeBinary: (file: string, bytes: Uint8Array) => invoke<void>('fs:writeBinary', file, bytes),
    write: (file: string, text: string) => invoke<void>('fs:write', file, text),
    exists: (file: string) => invoke<boolean>('fs:exists', file),
    remove: (file: string) => invoke<void>('fs:remove', file),
    list: (dir: string) => invoke<{ name: string; dir: boolean }[]>('fs:list', dir),
  },
  game: {
    info: () => invoke<{ name: string; version: string; dataDir: string; savesDir: string; logsDir: string; platform: string; testMode: boolean }>('game:info'),
    crash: (text: string) => invoke<string>('game:crash', text),
    quit: () => invoke<void>('game:quit'),
    toggleFullscreen: () => invoke<void>('game:fullscreen'),
    setFullscreen: (on: boolean) => invoke<void>('game:fullscreen', on),
  },
};
let handedOver = false;
contextBridge.exposeInMainWorld(
  'tilewright',
  testHooks
    ? { ...door, testHooks: true }
    : {
        testHooks: false,
        platform: process.platform,
        unlock: () => {
          if (handedOver) return null;
          handedOver = true;
          return door;
        },
      },
);
