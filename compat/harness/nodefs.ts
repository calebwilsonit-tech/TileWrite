import fs from 'node:fs';
import path from 'node:path';
import type { AssetFs } from '../../packages/editor/src/renderer/studio/assets';

/** The project's files, read straight from disk (what an export would ship). */
export const nodeFs: AssetFs = {
  read: (f) => fs.promises.readFile(f, 'utf8'),
  write: async (f, t) => {
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, t, 'utf8');
  },
  writeBinary: async (f, b) => {
    await fs.promises.mkdir(path.dirname(f), { recursive: true });
    await fs.promises.writeFile(f, b);
  },
  readBinary: async (f) => new Uint8Array(await fs.promises.readFile(f)),
  exists: async (f) => fs.existsSync(f),
  remove: async (f) => fs.promises.rm(f, { force: true }),
  list: async (d) => (await fs.promises.readdir(d, { withFileTypes: true })).map((e) => ({ name: e.name, dir: e.isDirectory() })),
};
