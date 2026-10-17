import { ipcMain } from 'electron';
import fs from 'node:fs/promises';
import path from 'node:path';

interface Deps {
  /** Throws unless the path is inside a folder the user chose. */
  resolveInside(file: string): string;
  /** Folder of the built editor files (`dist`); the sample games are in `dist/samples/<id>/`. */
  distDir: string;
}

async function copyTree(from: string, to: string): Promise<void> {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (e.isDirectory()) await copyTree(path.join(from, e.name), path.join(to, e.name));
    else await fs.copyFile(path.join(from, e.name), path.join(to, e.name));
  }
}

const isSafeFileName = (name: string): boolean => name !== '' && ![...name].some((c) => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c));

/** Finished example games that ship with the editor. Opening one copies it into a folder the user chose, so edits never touch the original. */
export function registerSamples(deps: Deps): void {
  const root = path.join(deps.distDir, 'samples');

  const nameOf = async (id: string): Promise<string | null> => {
    try {
      const p = JSON.parse(await fs.readFile(path.join(root, id, 'project.json'), 'utf8')) as { name?: unknown };
      return typeof p.name === 'string' && isSafeFileName(p.name) ? p.name : id;
    } catch {
      return null;
    }
  };

  ipcMain.handle('sample:list', async () => {
    const out: { id: string; name: string }[] = [];
    const entries = await fs.readdir(root, { withFileTypes: true }).catch(() => null);
    if (!entries) return out; // a build without samples
    for (const e of entries) {
      if (!e.isDirectory() || !/^[a-z0-9-]+$/.test(e.name)) continue;
      const name = await nameOf(e.name);
      if (name) out.push({ id: e.name, name });
    }
    return out.sort((a, b) => a.name.localeCompare(b.name));
  });

  ipcMain.handle('sample:copy', async (_e, id: unknown, parentDir: unknown): Promise<string> => {
    if (typeof id !== 'string' || !/^[a-z0-9-]+$/.test(id)) throw new Error('That is not a sample game.');
    if (typeof parentDir !== 'string') throw new Error('Choose a folder first.');
    const parent = deps.resolveInside(parentDir);
    const name = await nameOf(id);
    if (!name) throw new Error('That sample game is missing from this copy of Tilewright.');
    let target = path.join(parent, name);
    for (let i = 2; await fs.access(target).then(() => true, () => false); i++) target = path.join(parent, `${name} ${i}`);
    await copyTree(path.join(root, id), target);
    return target;
  });
}
