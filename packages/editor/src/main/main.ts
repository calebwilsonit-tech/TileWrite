import { app, BrowserWindow, dialog, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAssistant } from './assistant';
import { registerExport } from './export';
import { registerSamples } from './samples';
import { registerPreview } from './preview';

const here = path.dirname(fileURLToPath(import.meta.url));

/** End-to-end tests set this so native file dialogs are skipped. */
const TEST_DIR = process.env.TILEWRIGHT_TEST_DIR;

/**
 * Folders the renderer may read and write. A folder becomes allowed only when the user picks it in a
 * dialog (or it is a project they opened or created), so a page can never touch arbitrary files.
 */
const allowedRoots = new Set<string>();

function allow(dir: string): string {
  const resolved = path.resolve(dir);
  allowedRoots.add(resolved);
  return resolved;
}

function resolveInside(file: string): string {
  const resolved = path.resolve(file);
  for (const root of allowedRoots) {
    const rel = path.relative(root, resolved);
    if (rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))) return resolved;
  }
  throw new Error(`Tilewright can only use files inside a project folder you chose. "${file}" is outside.`);
}

function userFile(name: string): string {
  return path.join(app.getPath('userData'), name);
}

async function readJsonFile<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

function registerIpc(): void {
  registerAssistant();
  registerExport({ resolveInside, distDir: path.join(here, '..') });
  registerSamples({ resolveInside, distDir: path.join(here, '..') });
  registerPreview({ resolveInside, distDir: path.join(here, '..'), testMode: TEST_DIR !== undefined });
  ipcMain.handle('app:info', () => ({
    version: app.getVersion(),
    userData: app.getPath('userData'),
    testMode: TEST_DIR !== undefined,
    platform: process.platform,
  }));

  ipcMain.handle('dialog:chooseFolder', async (_e, title: string) => {
    if (TEST_DIR) return allow(TEST_DIR);
    const r = await dialog.showOpenDialog({ title, properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || r.filePaths.length === 0) return null;
    return allow(r.filePaths[0]!);
  });

  ipcMain.handle('fs:read', async (_e, file: string) => fs.readFile(resolveInside(file), 'utf8'));
  ipcMain.handle('fs:write', async (_e, file: string, text: string) => {
    const target = resolveInside(file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    // write to a temp file first so a crash can never leave a half-written project file
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
  });
  ipcMain.handle('fs:readBinary', async (_e, file: string) => new Uint8Array(await fs.readFile(resolveInside(file))));
  ipcMain.handle('fs:writeBinary', async (_e, file: string, bytes: Uint8Array) => {
    const target = resolveInside(file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, bytes);
    await fs.rename(tmp, target);
  });

  /**
   * "Import a file": the user picks any file in a native dialog and only its bytes and name come back.
   * (Tests set TILEWRIGHT_TEST_IMPORT to skip the dialog.)
   */
  ipcMain.handle('dialog:importFile', async (_e, title: string, extensions: string[]) => {
    let file: string | undefined = process.env.TILEWRIGHT_TEST_IMPORT;
    if (!file) {
      const r = await dialog.showOpenDialog({ title, properties: ['openFile'], filters: [{ name: 'Files', extensions }] });
      if (r.canceled || r.filePaths.length === 0) return null;
      file = r.filePaths[0]!;
    }
    const stat = await fs.stat(file);
    if (stat.size > 32 * 1024 * 1024) throw new Error('That file is larger than 32 MB, which is too big to import.');
    return { name: path.basename(file), bytes: new Uint8Array(await fs.readFile(file)) };
  });

  ipcMain.handle('fs:exists', async (_e, file: string) => {
    try {
      await fs.access(resolveInside(file));
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('fs:remove', async (_e, file: string) => {
    await fs.rm(resolveInside(file), { force: true });
  });
  ipcMain.handle('fs:list', async (_e, dir: string) => {
    const entries = await fs.readdir(resolveInside(dir), { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, dir: e.isDirectory() }));
  });

  ipcMain.handle('settings:get', async () => readJsonFile<Record<string, unknown>>(userFile('settings.json'), {}));
  ipcMain.handle('settings:set', async (_e, settings: Record<string, unknown>) => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(userFile('settings.json'), JSON.stringify(settings, null, 2), 'utf8');
  });

  ipcMain.handle('recent:list', async () => {
    const list = await readJsonFile<{ dir: string; name: string; opened: number }[]>(userFile('recent.json'), []);
    const out: typeof list = [];
    for (const r of list) {
      try {
        await fs.access(path.join(r.dir, 'project.json'));
        out.push(r);
      } catch {
        /* folder was moved or deleted: drop it from the list */
      }
    }
    return out;
  });
  ipcMain.handle('recent:add', async (_e, dir: string, name: string) => {
    const list = await readJsonFile<{ dir: string; name: string; opened: number }[]>(userFile('recent.json'), []);
    const next = [{ dir: path.resolve(dir), name, opened: Date.now() }, ...list.filter((r) => path.resolve(r.dir) !== path.resolve(dir))].slice(0, 12);
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    await fs.writeFile(userFile('recent.json'), JSON.stringify(next, null, 2), 'utf8');
  });
  ipcMain.handle('recent:remove', async (_e, dir: string) => {
    const list = await readJsonFile<{ dir: string; name: string; opened: number }[]>(userFile('recent.json'), []);
    await fs.writeFile(userFile('recent.json'), JSON.stringify(list.filter((r) => path.resolve(r.dir) !== path.resolve(dir)), null, 2), 'utf8');
  });
  // Reopening a recent project: allowed only if the folder really is in the saved recent list
  // (it got there because the user chose or created it in an earlier session).
  ipcMain.handle('recent:open-allowed', async (_e, dir: string) => {
    const list = await readJsonFile<{ dir: string }[]>(userFile('recent.json'), []);
    if (!list.some((r) => path.resolve(r.dir) === path.resolve(dir))) {
      throw new Error('That folder is not in your recent projects. Use Open Project to choose it.');
    }
    return allow(dir);
  });
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    title: 'Tilewright',
    backgroundColor: '#1b1d23',
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      autoplayPolicy: 'no-user-gesture-required',
    },
  });

  // closing the editor closes any game windows it started
  win.on('close', () => {
    for (const w of BrowserWindow.getAllWindows()) if (w !== win) w.close();
  });

  const devUrl = process.env.VITE_DEV_SERVER_URL;
  if (devUrl) {
    void win.loadURL(devUrl);
  } else {
    void win.loadFile(path.join(here, '..', 'renderer', 'index.html'));
  }
  return win;
}

app.whenReady().then(() => {
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
