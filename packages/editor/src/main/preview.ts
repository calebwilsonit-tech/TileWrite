import { BrowserWindow, ipcMain } from 'electron';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import type { PreviewJob } from '@tilewright/exporter';
import { registerGameIpc, type GameContext } from '../game/game-ipc';

interface Deps {
  /** Throws unless the path is inside a folder the user chose. */
  resolveInside(file: string): string;
  /** Folder of the built editor files (`dist`): the game page is in `dist/player`, its preload in `dist/game`. */
  distDir: string;
  /** End-to-end tests: let the game page expose itself for inspection. */
  testMode: boolean;
}

const isSafeRelative = (rel: string): boolean => rel !== '' && !path.isAbsolute(rel) && !rel.split(/[\\/]/).some((p) => p === '..' || p === '');

interface Running {
  ctx: GameContext;
  win: BrowserWindow;
  tmp: string;
  projectDir: string;
}

/**
 * "Run in a window": the game in a window of its own while the editor stays open beside it. The game's files are
 * copied to a throw-away folder (as an export would), and the same game page an exported game uses runs in a new
 * window. Its file access is the same: its own data to read, the project's saves folder to write.
 */
export function registerPreview(deps: Deps): void {
  const running = new Map<number, Running>();
  registerGameIpc('preview:', (e) => running.get(e.sender.id)?.ctx ?? null);

  ipcMain.handle('preview:open', async (_e, job: PreviewJob): Promise<{ windows: number }> => {
    const projectDir = deps.resolveInside(job.projectDir);
    for (const f of job.files) if (!isSafeRelative(f)) throw new Error(`The project file "${f}" has a path that cannot be run.`);
    for (const g of job.generated) if (!isSafeRelative(g.path)) throw new Error('A generated file has an unsafe path.');

    // one window per project: running again replaces the old one
    for (const r of [...running.values()]) if (r.projectDir === projectDir && !r.win.isDestroyed()) r.win.close();

    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'tilewright-run-'));
    const dataDir = path.join(tmp, 'data');
    for (const rel of job.files) {
      const from = deps.resolveInside(path.join(projectDir, ...rel.split(/[\\/]/)));
      const to = path.join(dataDir, ...rel.split(/[\\/]/));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    }
    for (const g of job.generated) {
      const to = path.join(dataDir, ...g.path.split(/[\\/]/));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, g.text, 'utf8');
    }
    const logsDir = path.join(tmp, 'logs');
    const savesDir = path.join(projectDir, 'saves');

    const win = new BrowserWindow({
      useContentSize: true,
      width: Math.max(320, Math.min(job.width, 3840)),
      height: Math.max(240, Math.min(job.height, 2160)),
      title: `${job.gameName} (running from the editor)`,
      backgroundColor: '#0b0c10',
      show: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(deps.distDir, 'game', 'game-preload.cjs'),
        additionalArguments: ['--tw-prefix=preview:'],
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        autoplayPolicy: 'no-user-gesture-required',
        devTools: deps.testMode,
      },
    });
    const ctx: GameContext = {
      name: job.gameName,
      version: job.version,
      dataDir,
      savesDir,
      logsDir,
      testMode: deps.testMode,
      async writeLog(kind, text) {
        await fs.mkdir(logsDir, { recursive: true });
        const file = path.join(logsDir, `${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}.log`);
        await fs.writeFile(file, `${job.gameName} (run from the editor)\n${new Date().toISOString()}\n\n${text}`, 'utf8');
        return file;
      },
      quit: () => win.close(),
      fullscreen: (_e, on) => win.setFullScreen(on ?? !win.isFullScreen()),
    };
    const id = win.webContents.id;
    running.set(id, { ctx, win, tmp, projectDir });
    win.once('ready-to-show', () => win.show());
    win.on('closed', () => {
      running.delete(id);
      void fs.rm(tmp, { recursive: true, force: true }).catch(() => undefined);
    });
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && (input.key === 'F11' || (input.alt && input.key === 'Enter'))) {
        e.preventDefault();
        win.setFullScreen(!win.isFullScreen());
      }
    });
    await win.loadFile(path.join(deps.distDir, 'player', 'index.html'), deps.testMode ? { query: { test: '1' } } : undefined);
    return { windows: running.size };
  });
}
