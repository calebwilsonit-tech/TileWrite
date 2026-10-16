import { app, ipcMain } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import type { ExportJob, ExportResult } from '@tilewright/exporter';

const run = promisify(execFile);

/** Dropped into every folder an export makes, so a later export may replace it (and never replaces anything else). */
const MARKER = '.tilewright-export';

interface Deps {
  /** Throws unless the path is inside a folder the user chose. */
  resolveInside(file: string): string;
  /** Folder of the built editor files (`dist`), where the game shell and player were built. */
  distDir: string;
}

/** Copy a folder with readdir and copyFile: unlike fs.cp these also work inside the editor's own app.asar. */
async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (e.isDirectory()) await copyTree(path.join(from, e.name), path.join(to, e.name));
    else await fs.copyFile(path.join(from, e.name), path.join(to, e.name));
  }
}

/** A single file or folder name: no separators, no characters Windows forbids, no control characters. */
const isSafeFileName = (name: string): boolean => name !== '' && ![...name].some((c) => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c));

const isSafeRelative = (rel: string): boolean => rel !== '' && !path.isAbsolute(rel) && !rel.split(/[\\/]/).some((p) => p === '..' || p === '');

/**
 * Making a game: copy the Electron runtime this editor itself runs on (so nothing needs downloading and no editor
 * code comes along), put the game shell, the player page and the project's files beside it, rename the program, zip it.
 */
export function registerExport(deps: Deps): void {
  ipcMain.handle('export:info', async () => {
    const runtimeDir = path.dirname(process.execPath);
    const hasResources = await fs
      .access(path.join(runtimeDir, 'resources'))
      .then(() => true)
      .catch(() => false);
    const hasPlayer = await fs
      .access(path.join(deps.distDir, 'player', 'index.html'))
      .then(() => true)
      .catch(() => false);
    return { platform: process.platform, canExport: (process.platform === 'win32' || process.platform === 'linux') && hasResources && hasPlayer, version: app.getVersion() };
  });

  ipcMain.handle('export:build', async (e, job: ExportJob): Promise<ExportResult> => {
    const say = (text: string): void => {
      if (!e.sender.isDestroyed()) e.sender.send('export:progress', text);
    };
    if (job.platform !== process.platform) throw new Error('A game can only be exported for the kind of computer this editor is running on (Windows games are made on Windows, Linux games on Linux).');
    if (process.platform !== 'win32' && process.platform !== 'linux') throw new Error('Exporting from macOS is not supported yet.');

    const projectDir = deps.resolveInside(job.projectDir);
    const outRoot = deps.resolveInside(job.outRoot);
    if (!isSafeFileName(job.folderName) || !isSafeFileName(job.exeName)) throw new Error('The game name has letters that cannot be used in a file name.');
    for (const f of [...job.files, ...(job.icon ? [job.icon] : [])]) if (!isSafeRelative(f)) throw new Error(`The project file "${f}" has a path that cannot be exported.`);
    for (const g of job.generated) if (!isSafeRelative(g.path)) throw new Error('A generated file has an unsafe path.');

    const target = path.join(outRoot, job.folderName);
    const intoProject = path.relative(projectDir, target);
    if (intoProject === '' || (!intoProject.startsWith('..') && !path.isAbsolute(intoProject))) throw new Error('Choose a folder outside the project to put the game in.');
    const exists = await fs.stat(target).then(() => true).catch(() => false);
    if (exists) {
      const ours = await fs.stat(path.join(target, MARKER)).then(() => true).catch(() => false);
      if (!ours) throw new Error(`There is already a folder called "${job.folderName}" in that place that was not made by an export, so it was left alone. Choose another place, or rename the game.`);
      say('Replacing the previous export...');
      await fs.rm(target, { recursive: true, force: true });
    }

    // ---- the runtime ----
    const runtimeDir = path.dirname(process.execPath);
    const runtimeExe = path.basename(process.execPath);
    say('Copying the game runtime...');
    const skipAtTop = new Set([runtimeExe.toLowerCase()]);
    await fs.cp(runtimeDir, target, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(runtimeDir, src).replace(/\\/g, '/');
        if (rel === '') return true;
        if (skipAtTop.has(rel.toLowerCase())) return false; // copied below under the game's name
        if (/^uninstall/i.test(rel) || /\.(pdb|log)$/i.test(rel)) return false;
        if (rel === 'resources/app' || rel === 'resources/app.asar' || rel === 'resources/app.asar.unpacked' || rel === 'resources/default_app.asar') return false; // the editor's own code
        return true;
      },
    });
    await fs.copyFile(process.execPath, path.join(target, job.exeName));
    if (process.platform === 'linux') await fs.chmod(path.join(target, job.exeName), 0o755);
    await fs.writeFile(path.join(target, MARKER), `${job.gameName} ${job.version}\n`, 'utf8');

    // ---- the game shell and player page ----
    say('Adding the game shell...');
    const appDir = path.join(target, 'resources', 'app');
    await fs.mkdir(appDir, { recursive: true });
    await fs.writeFile(
      path.join(appDir, 'package.json'),
      JSON.stringify({ name: job.folderName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'game', productName: job.gameName, version: job.version, main: 'game-main.mjs', type: 'module' }, null, 2),
      'utf8',
    );
    await fs.copyFile(path.join(deps.distDir, 'game', 'game-main.mjs'), path.join(appDir, 'game-main.mjs'));
    await fs.copyFile(path.join(deps.distDir, 'game', 'game-preload.cjs'), path.join(appDir, 'game-preload.cjs'));
    await copyTree(path.join(deps.distDir, 'player'), path.join(appDir, 'player'));

    // ---- the project's own files ----
    say(`Copying ${job.files.length} game files...`);
    const dataDir = path.join(appDir, 'data');
    const copyOne = async (rel: string): Promise<void> => {
      const from = deps.resolveInside(path.join(projectDir, ...rel.split(/[\\/]/)));
      const to = path.join(dataDir, ...rel.split(/[\\/]/));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.copyFile(from, to);
    };
    for (const rel of job.files) await copyOne(rel);
    if (job.icon && !job.files.includes(job.icon)) await copyOne(job.icon);
    for (const g of job.generated) {
      const to = path.join(dataDir, ...g.path.split(/[\\/]/));
      await fs.mkdir(path.dirname(to), { recursive: true });
      await fs.writeFile(to, g.text, 'utf8');
    }

    // ---- a zip beside it ----
    say('Making the zip file...');
    const zipPath = `${target}.zip`;
    let zip: string | null = zipPath;
    let zipProblem: string | undefined;
    try {
      await fs.rm(zipPath, { force: true });
      // the Windows tar (bsdtar) writes zip files; a GNU tar earlier in PATH (from Git, say) cannot, so name it in full
      if (process.platform === 'win32') await run(path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe'), ['-a', '-c', '-f', zipPath, '-C', outRoot, job.folderName], { timeout: 10 * 60_000, windowsHide: true });
      else await run('zip', ['-r', '-q', zipPath, job.folderName], { cwd: outRoot, timeout: 10 * 60_000 });
    } catch (err) {
      zip = null;
      zipProblem = `The game was made, but the zip file could not be: ${err instanceof Error ? err.message : String(err)}`;
    }
    say('Done.');
    return { folder: target, exe: path.join(target, job.exeName), zip, ...(zipProblem ? { zipProblem } : {}), files: job.files.length };
  });
}
