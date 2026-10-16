import { app, BrowserWindow, dialog, ipcMain, Menu } from 'electron';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The shell of an exported game: one window that plays the game in `data/`, with its own save folder and a
 * crash log. It knows nothing about the editor. The renderer part is `src/player`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(here, 'data');
const testMode = process.env.TILEWRIGHT_GAME_TEST === '1';

interface Manifest {
  name: string;
  version: string;
  window: { width: number; height: number; fullscreen: boolean };
  icon: string;
}

function readManifest(): Manifest | null {
  try {
    return JSON.parse(fsSync.readFileSync(path.join(dataDir, 'game.json'), 'utf8')) as Manifest;
  } catch {
    return null;
  }
}

const manifest = readManifest();
const gameName = manifest?.name ?? 'This game';
const safeName =
  [...gameName]
    .filter((c) => c.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(c))
    .join('')
    .trim() || 'Game';

// every game keeps its saves, settings and logs in its own folder
app.setPath('userData', process.env.TILEWRIGHT_GAME_USERDATA || path.join(app.getPath('appData'), safeName));
const savesDir = path.join(app.getPath('userData'), 'saves');
const logsDir = path.join(app.getPath('userData'), 'logs');

function inside(root: string, file: string): boolean {
  const rel = path.relative(root, path.resolve(file));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/** The game may read its own data and saves, and write only to its saves folder. */
function readable(file: string): string {
  const r = path.resolve(file);
  if (inside(dataDir, r) || inside(savesDir, r)) return r;
  throw new Error('The game tried to read a file outside its own folders.');
}
function writable(file: string): string {
  const r = path.resolve(file);
  if (inside(savesDir, r)) return r;
  throw new Error('The game may only write to its save folder.');
}

async function writeLog(kind: string, text: string): Promise<string> {
  await fs.mkdir(logsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const file = path.join(logsDir, `${kind}-${stamp}.log`);
  const header = `${gameName} ${manifest?.version ?? ''}\n${new Date().toISOString()}\nTilewright game shell, Electron ${process.versions.electron}, ${process.platform} ${process.arch}\n\n`;
  await fs.writeFile(file, header + text, 'utf8');
  return file;
}

function fatal(what: string, error: unknown): void {
  const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ''}` : String(error);
  void writeLog('crash', `${what}\n\n${detail}`)
    .catch(() => '(the log could not be written)')
    .then((file) => {
      dialog.showErrorBox(`${gameName} has stopped`, `Sorry, something went wrong and the game has to close.\n\nA report was saved here, in case you want to send it to the people who made the game:\n${file}`);
      app.exit(1);
    });
}

process.on('uncaughtException', (e) => fatal('Uncaught error in the game shell.', e));
process.on('unhandledRejection', (e) => fatal('Unhandled promise rejection in the game shell.', e));

function registerIpc(): void {
  ipcMain.handle('game:info', () => ({ name: gameName, version: manifest?.version ?? '', dataDir, savesDir, logsDir, platform: process.platform, testMode }));
  ipcMain.handle('game:crash', async (_e, text: string) => writeLog('crash', String(text).slice(0, 200_000)));
  ipcMain.handle('game:quit', () => app.quit());
  ipcMain.handle('game:fullscreen', (e) => {
    const win = BrowserWindow.fromWebContents(e.sender);
    win?.setFullScreen(!win.isFullScreen());
  });
  ipcMain.handle('fs:read', async (_e, file: string) => fs.readFile(readable(file), 'utf8'));
  ipcMain.handle('fs:readBinary', async (_e, file: string) => new Uint8Array(await fs.readFile(readable(file))));
  ipcMain.handle('fs:exists', async (_e, file: string) => {
    try {
      await fs.access(readable(file));
      return true;
    } catch {
      return false;
    }
  });
  ipcMain.handle('fs:list', async (_e, dir: string) => {
    const entries = await fs.readdir(readable(dir), { withFileTypes: true });
    return entries.map((e) => ({ name: e.name, dir: e.isDirectory() }));
  });
  ipcMain.handle('fs:write', async (_e, file: string, text: string) => {
    const target = writable(file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    const tmp = `${target}.tmp`;
    await fs.writeFile(tmp, text, 'utf8');
    await fs.rename(tmp, target);
  });
  ipcMain.handle('fs:writeBinary', async (_e, file: string, bytes: Uint8Array) => {
    const target = writable(file);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, bytes);
  });
  ipcMain.handle('fs:remove', async (_e, file: string) => {
    await fs.rm(writable(file), { force: true });
  });
}

function createWindow(): BrowserWindow {
  const m = manifest ?? { name: gameName, version: '', window: { width: 1280, height: 720, fullscreen: false }, icon: '' };
  const iconFile = m.icon ? path.join(dataDir, ...m.icon.split('/')) : '';
  const win = new BrowserWindow({
    useContentSize: true, // the window size chosen at export is the size of the game picture, not the frame around it
    width: m.window.width,
    height: m.window.height,
    fullscreen: m.window.fullscreen,
    title: m.name,
    backgroundColor: '#0b0c10',
    show: false,
    autoHideMenuBar: true,
    ...(iconFile && fsSync.existsSync(iconFile) ? { icon: iconFile } : {}),
    webPreferences: {
      preload: path.join(here, 'game-preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: testMode,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.webContents.on('before-input-event', (e, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F11' || (input.alt && input.key === 'Enter')) {
      e.preventDefault();
      win.setFullScreen(!win.isFullScreen());
    }
  });
  win.webContents.on('render-process-gone', (_e, details) => fatal(`The game window stopped (${details.reason}).`, new Error(`exit code ${details.exitCode}`)));
  win.webContents.on('did-fail-load', (_e, code, desc) => fatal('The game window could not load.', new Error(`${desc} (${code})`)));
  void win.loadFile(path.join(here, 'player', 'index.html'), testMode ? { query: { test: '1' } } : undefined);
  return win;
}

void app.whenReady().then(() => {
  if (!manifest) {
    dialog.showErrorBox('This game cannot start', 'Its files are missing or damaged (game.json could not be read). Please download or export the game again.');
    app.exit(1);
    return;
  }
  Menu.setApplicationMenu(null);
  registerIpc();
  createWindow();
});

app.on('window-all-closed', () => app.quit());
