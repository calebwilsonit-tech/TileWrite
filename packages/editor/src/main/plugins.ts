import { BrowserWindow, dialog, ipcMain, type WebContents } from 'electron';
import { execFile } from 'node:child_process';
import { watch, type FSWatcher } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

interface Deps {
  /** The person's saved settings (the plugin manager keeps what the person allowed there). */
  settings(): Promise<Record<string, unknown>>;
  /** Lets the editor read and write inside a folder (the plugin store). */
  allow(dir: string): string;
  /** Where installed plugins live: <store>/<id>/<version>/. */
  storeDir: string;
  testMode: boolean;
}

const ID = /^[a-z][a-z0-9]*(?:[-_.][a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const safeName = (n: string): boolean => n !== '' && !n.includes('..') && !path.isAbsolute(n) && ![...n].some((c) => c.charCodeAt(0) < 32 || '<>:"|?*'.includes(c));

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (e.name === 'node_modules' || e.name.startsWith('.git')) continue;
    if (e.isDirectory()) await copyTree(path.join(from, e.name), path.join(to, e.name));
    else if (e.isFile()) await fs.copyFile(path.join(from, e.name), path.join(to, e.name));
  }
}

export interface InstalledPlugin {
  id: string;
  version: string;
  dir: string;
}

/** What the plugin manager needs from the computer: a store of installed plugins, a way to watch a folder while a plugin is being written, and the one door to other programs. */
export function registerPlugins(deps: Deps): { /** What the person allowed a plugin: the permissions it was granted, or null when it is not installed. */ permissionsOf(id: string): Promise<string[] | null> } {
  deps.allow(deps.storeDir);
  const watchers = new Map<string, FSWatcher>();

  async function manifestOf(dir: string): Promise<{ id: string; version: string }> {
    let json: { id?: unknown; version?: unknown };
    try {
      json = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8')) as { id?: unknown; version?: unknown };
    } catch {
      throw new Error('That folder has no readable plugin.json, so it is not a plugin.');
    }
    if (typeof json.id !== 'string' || !ID.test(json.id)) throw new Error('plugin.json needs an "id" of lower-case letters, numbers and - _ . (starting with a letter).');
    if (typeof json.version !== 'string' || !VERSION.test(json.version)) throw new Error('plugin.json needs a "version" like 1.2.3.');
    return { id: json.id, version: json.version };
  }

  ipcMain.handle('plugins:store', () => deps.storeDir);

  ipcMain.handle('plugins:list', async (): Promise<InstalledPlugin[]> => {
    const out: InstalledPlugin[] = [];
    let ids: string[];
    try {
      ids = (await fs.readdir(deps.storeDir, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name);
    } catch {
      return out;
    }
    for (const id of ids) {
      for (const v of await fs.readdir(path.join(deps.storeDir, id), { withFileTypes: true })) {
        if (!v.isDirectory() || !VERSION.test(v.name)) continue;
        const dir = path.join(deps.storeDir, id, v.name);
        try {
          const m = await manifestOf(dir);
          if (m.id === id && m.version === v.name) out.push({ id, version: v.name, dir });
        } catch {
          /* not a plugin: left out */
        }
      }
    }
    return out;
  });

  /** Copy a plugin folder the person picked into the store. */
  ipcMain.handle('plugins:install-folder', async (_e, src: string): Promise<InstalledPlugin> => {
    const from = path.resolve(src);
    const m = await manifestOf(from);
    const dir = path.join(deps.storeDir, m.id, m.version);
    await fs.rm(dir, { recursive: true, force: true });
    await copyTree(from, dir);
    return { id: m.id, version: m.version, dir };
  });

  /** A plugin packed into one JSON file: { files: { "plugin.json": "...", "plugin.cjs": "..." } }. */
  ipcMain.handle('plugins:install-bundle', async (_e, text: string): Promise<InstalledPlugin> => {
    let bundle: { files?: Record<string, unknown> };
    try {
      bundle = JSON.parse(text) as { files?: Record<string, unknown> };
    } catch {
      throw new Error('That is not a plugin bundle (the file is not valid JSON).');
    }
    const files = bundle.files;
    if (!files || typeof files !== 'object' || typeof files['plugin.json'] !== 'string') throw new Error('That bundle has no plugin.json inside.');
    const staging = path.join(deps.storeDir, '.incoming', String(Date.now()));
    await fs.mkdir(staging, { recursive: true });
    try {
      for (const [name, content] of Object.entries(files)) {
        if (!safeName(name) || typeof content !== 'string') throw new Error(`The bundle has a file with a name that is not allowed: "${name}".`);
        const target = path.join(staging, name);
        await fs.mkdir(path.dirname(target), { recursive: true });
        await fs.writeFile(target, content, 'utf8');
      }
      const m = await manifestOf(staging);
      const dir = path.join(deps.storeDir, m.id, m.version);
      await fs.rm(dir, { recursive: true, force: true });
      await fs.mkdir(path.dirname(dir), { recursive: true });
      await fs.rename(staging, dir);
      return { id: m.id, version: m.version, dir };
    } finally {
      await fs.rm(staging, { recursive: true, force: true });
    }
  });

  /** Fetch the text at an address (a plugin bundle): https only (http for this computer), small, and quick. */
  ipcMain.handle('plugins:fetch', async (_e, address: string): Promise<string> => {
    const url = new URL(address);
    const local = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) throw new Error('A plugin address must start with https:// (http:// is only allowed for this computer).');
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 20_000);
    try {
      const res = await fetch(url, { signal: ctl.signal, redirect: 'error' });
      if (!res.ok) throw new Error(`The address answered ${res.status}.`);
      const buf = new Uint8Array(await res.arrayBuffer());
      if (buf.length > 8 * 1024 * 1024) throw new Error('That is more than 8 MB, which is too big for a plugin.');
      return new TextDecoder().decode(buf);
    } catch (e) {
      throw new Error(ctl.signal.aborted ? 'The address did not answer in time.' : `Could not get the plugin: ${(e as Error).message}`, { cause: e });
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle('plugins:remove', async (_e, id: string, version?: string) => {
    if (!ID.test(id) || (version !== undefined && !VERSION.test(version))) throw new Error('That is not a plugin.');
    await fs.rm(version ? path.join(deps.storeDir, id, version) : path.join(deps.storeDir, id), { recursive: true, force: true });
  });

  /** Tell the window when files in a folder change (a plugin being written). */
  ipcMain.handle('plugins:watch', (e, dir: string) => {
    const folder = deps.allow(dir);
    watchers.get(folder)?.close();
    let timer: NodeJS.Timeout | null = null;
    const sender: WebContents = e.sender;
    const w = watch(folder, { recursive: true }, () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        if (!sender.isDestroyed()) sender.send('plugins:changed', folder);
      }, 250);
    });
    watchers.set(folder, w);
  });
  ipcMain.handle('plugins:unwatch', (_e, dir: string) => {
    const folder = path.resolve(dir);
    watchers.get(folder)?.close();
    watchers.delete(folder);
  });

  /**
   * The one way a plugin can run another program: it must have asked for the "programs" permission and been granted it, and the
   * person is asked here, every time, with the command in front of them. No shell is involved.
   */
  ipcMain.handle('plugins:run-program', async (e, pluginId: string, command: string, args: string[]) => {
    if (typeof command !== 'string' || command === '' || !Array.isArray(args) || args.some((a) => typeof a !== 'string')) throw new Error('That is not a program to run.');
    // who is asking is worked out here, from what is on this computer: the dialog names the plugin by its own manifest, and a plugin
    // that was not allowed to run programs cannot get as far as the question
    const who = await describePlugin(pluginId);
    if (!who) throw new Error('A program can only be run by a plugin that is installed.');
    if (!who.granted.includes('programs')) throw new Error(`The plugin "${who.name}" was not allowed to run programs.`);
    const allowed = deps.testMode ? process.env.TILEWRIGHT_TEST_PROGRAMS === 'allow' : await ask(e.sender, who.name, command, args);
    if (!allowed) throw new Error('You said no, so the program was not run.');
    return new Promise<{ code: number; stdout: string; stderr: string }>((resolve) => {
      execFile(command, args, { timeout: 30_000, maxBuffer: 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
        const code = err ? (typeof (err as { code?: unknown }).code === 'number' ? ((err as { code: number }).code as number) : 1) : 0;
        resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && code !== 0 ? err.message : '') });
      });
    });
  });

  /** What this computer says about a plugin: its name from its manifest, and what the person allowed it to do (read from the saved settings). */
  async function describePlugin(id: unknown): Promise<{ name: string; granted: string[] } | null> {
    if (typeof id !== 'string' || !ID.test(id)) return null;
    const settings = ((await deps.settings()).plugins ?? {}) as { grants?: Record<string, unknown>; dev?: unknown };
    const folders = [...(Array.isArray(settings.dev) ? (settings.dev as unknown[]).filter((d): d is string => typeof d === 'string') : [])];
    try {
      for (const v of await fs.readdir(path.join(deps.storeDir, id), { withFileTypes: true })) if (v.isDirectory()) folders.push(path.join(deps.storeDir, id, v.name));
    } catch {
      /* not in the store */
    }
    for (const dir of folders) {
      try {
        const m = JSON.parse(await fs.readFile(path.join(dir, 'plugin.json'), 'utf8')) as { id?: unknown; name?: unknown };
        if (m.id !== id) continue;
        const granted = settings.grants?.[id];
        return { name: typeof m.name === 'string' && m.name !== '' ? m.name : id, granted: Array.isArray(granted) ? granted.filter((g): g is string => typeof g === 'string') : [] };
      } catch {
        /* not a readable plugin folder */
      }
    }
    return null;
  }

  async function ask(sender: WebContents, pluginName: string, command: string, args: string[]): Promise<boolean> {
    const win = BrowserWindow.fromWebContents(sender);
    const options = { type: 'warning' as const, buttons: ['Do not run it', 'Run it'], defaultId: 0, cancelId: 0, title: 'A plugin wants to run a program', message: `The plugin "${pluginName}" wants to run this program on your computer:`, detail: [command, ...args].join(' ') };
    const r = win ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options);
    return r.response === 1;
  }

  return { permissionsOf: async (id) => (await describePlugin(id))?.granted ?? null };
}
