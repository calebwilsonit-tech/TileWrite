import { contextBridge, ipcRenderer } from 'electron';

const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args) as Promise<T>;

/**
 * The only door between the editor UI and the computer. File access is limited to folders the user chose
 * (enforced in the main process), and there is no way to run commands from here.
 */
contextBridge.exposeInMainWorld('tilewright', {
  platform: process.platform,
  versions: { electron: process.versions.electron, chrome: process.versions.chrome },
  info: () => invoke('app:info'),
  chooseFolder: (title: string) => invoke<string | null>('dialog:chooseFolder', title),
  fs: {
    read: (file: string) => invoke<string>('fs:read', file),
    write: (file: string, text: string) => invoke<void>('fs:write', file, text),
    exists: (file: string) => invoke<boolean>('fs:exists', file),
    remove: (file: string) => invoke<void>('fs:remove', file),
    list: (dir: string) => invoke<{ name: string; dir: boolean }[]>('fs:list', dir),
  },
  settings: {
    get: () => invoke<Record<string, unknown>>('settings:get'),
    set: (s: Record<string, unknown>) => invoke<void>('settings:set', s),
  },
  recent: {
    list: () => invoke<{ dir: string; name: string; opened: number }[]>('recent:list'),
    add: (dir: string, name: string) => invoke<void>('recent:add', dir, name),
    remove: (dir: string) => invoke<void>('recent:remove', dir),
    allow: (dir: string) => invoke<string>('recent:open-allowed', dir),
  },
});
