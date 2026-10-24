import { contextBridge, ipcRenderer, webFrame } from 'electron';

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
  importFile: (title: string, extensions: string[]) => invoke<{ name: string; bytes: Uint8Array } | null>('dialog:importFile', title, extensions),
  saveFile: (title: string, suggested: string, text: string) => invoke<string | null>('dialog:saveFile', title, suggested, text),
  hubRequest: (req: { method: string; url: string; token?: string; body?: string }) => invoke<{ status: number; text: string; version: string }>('hub:request', req),
  fs: {
    read: (file: string) => invoke<string>('fs:read', file),
    readBinary: (file: string) => invoke<Uint8Array>('fs:readBinary', file),
    writeBinary: (file: string, bytes: Uint8Array) => invoke<void>('fs:writeBinary', file, bytes),
    write: (file: string, text: string) => invoke<void>('fs:write', file, text),
    exists: (file: string) => invoke<boolean>('fs:exists', file),
    remove: (file: string) => invoke<void>('fs:remove', file),
    list: (dir: string) => invoke<{ name: string; dir: boolean; size?: number }[]>('fs:list', dir),
  },
  plugins: {
    store: () => invoke<string>('plugins:store'),
    list: () => invoke('plugins:list'),
    installFolder: (dir: string) => invoke('plugins:install-folder', dir),
    installBundle: (text: string) => invoke('plugins:install-bundle', text),
    fetch: (address: string) => invoke<string>('plugins:fetch', address),
    remove: (id: string, version?: string) => invoke<void>('plugins:remove', id, version),
    watch: (dir: string) => invoke<void>('plugins:watch', dir),
    unwatch: (dir: string) => invoke<void>('plugins:unwatch', dir),
    runProgram: (pluginName: string, command: string, args: string[]) => invoke('plugins:run-program', pluginName, command, args),
    onChanged: (fn: (dir: string) => void) => {
      const l = (_e: unknown, dir: string): void => fn(dir);
      ipcRenderer.on('plugins:changed', l);
      return () => ipcRenderer.removeListener('plugins:changed', l);
    },
  },
  settings: {
    get: () => invoke<Record<string, unknown>>('settings:get'),
    set: (s: Record<string, unknown>) => invoke<void>('settings:set', s),
  },
  assistant: {
    status: () => invoke('assistant:status'),
    setKey: (key: string) => invoke('assistant:set-key', key),
    clearKey: () => invoke('assistant:clear-key'),
    providerKey: {
      has: (id: string) => invoke<boolean>('assistant:provider-key-has', id),
      get: (id: string) => invoke<string | null>('assistant:provider-key-get', id),
      set: (id: string, key: string) => invoke<void>('assistant:provider-key-set', id, key),
      clear: (id: string) => invoke<void>('assistant:provider-key-clear', id),
    },
    send: (args: unknown) => invoke('assistant:send', args),
    retry: (settings: unknown) => invoke('assistant:retry', settings),
    cancel: () => invoke<void>('assistant:cancel'),
    reset: () => invoke<void>('assistant:reset'),
    toolResult: (callId: string, out: unknown) => invoke<void>('assistant:tool-result', callId, out),
    onEvent: (fn: (ev: unknown) => void) => {
      const l = (_e: unknown, ev: unknown): void => fn(ev);
      ipcRenderer.on('assistant:event', l);
      return () => ipcRenderer.removeListener('assistant:event', l);
    },
    onToolCall: (fn: (call: unknown) => void) => {
      const l = (_e: unknown, call: unknown): void => fn(call);
      ipcRenderer.on('assistant:tool-call', l);
      return () => ipcRenderer.removeListener('assistant:tool-call', l);
    },
  },
  ui: {
    /** Make everything in the window this many times bigger (the accessibility text size). */
    setZoom: (factor: number) => webFrame.setZoomFactor(Math.min(3, Math.max(0.5, factor))),
  },
  exporter: {
    info: () => invoke('export:info'),
    build: (job: unknown) => invoke('export:build', job),
    onProgress: (fn: (text: string) => void) => {
      const l = (_e: unknown, text: string): void => fn(text);
      ipcRenderer.on('export:progress', l);
      return () => ipcRenderer.removeListener('export:progress', l);
    },
  },
  preview: {
    open: (job: unknown) => invoke<{ windows: number }>('preview:open', job),
  },
  samples: {
    list: () => invoke<{ id: string; name: string }[]>('sample:list'),
    copy: (id: string, parentDir: string) => invoke<string>('sample:copy', id, parentDir),
  },
  recent: {
    list: () => invoke<{ dir: string; name: string; opened: number }[]>('recent:list'),
    add: (dir: string, name: string) => invoke<void>('recent:add', dir, name),
    remove: (dir: string) => invoke<void>('recent:remove', dir),
    allow: (dir: string) => invoke<string>('recent:open-allowed', dir),
  },
});
