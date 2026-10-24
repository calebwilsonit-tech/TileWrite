import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../../packages/editor/src/renderer/project/io';
import { listTemplates } from '../../packages/editor/src/renderer/project/templates';
import { nodeFs } from './nodefs';

export const ROOT = path.resolve(__dirname, '..', '..');
export const COMPAT = path.join(ROOT, 'compat');

export type CorpusKind = 'sample' | 'plugin-sample' | 'code-template' | 'owner';

export interface CorpusEntry {
  /** Stable name; the baseline is `compat/baselines/<kind>/<id>.json`. */
  id: string;
  kind: CorpusKind;
  dir: string;
}

const hasProject = (dir: string): boolean => fs.existsSync(path.join(dir, 'project.json'));

function folders(parent: string): string[] {
  if (!fs.existsSync(parent)) return [];
  return fs
    .readdirSync(parent, { withFileTypes: true })
    .filter((e) => e.isDirectory() && hasProject(path.join(parent, e.name)))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b));
}

/** Where the code templates are built for each run (outside the repository). */
export const TEMPLATE_BUILD_DIR = path.join(os.tmpdir(), 'tilewright-compat-templates');

/**
 * Every project the engine must keep working: each folder of `samples/`, each project a plugin ships under `packages/plugins/<id>/samples/`, every code
 * template (built fresh into a temporary folder) and every project of the owner's in `compat/projects/`.
 */
export async function corpus(): Promise<CorpusEntry[]> {
  const out: CorpusEntry[] = [];
  for (const n of folders(path.join(ROOT, 'samples'))) out.push({ id: n, kind: 'sample', dir: path.join(ROOT, 'samples', n) });
  for (const plugin of fs.existsSync(path.join(ROOT, 'packages', 'plugins')) ? fs.readdirSync(path.join(ROOT, 'packages', 'plugins')) : []) for (const n of folders(path.join(ROOT, 'packages', 'plugins', plugin, 'samples'))) out.push({ id: n, kind: 'plugin-sample', dir: path.join(ROOT, 'packages', 'plugins', plugin, 'samples', n) });
  fs.rmSync(TEMPLATE_BUILD_DIR, { recursive: true, force: true });
  for (const t of listTemplates()) {
    const made = await createProject(nodeFs, TEMPLATE_BUILD_DIR, t.id, t.id);
    out.push({ id: t.id, kind: 'code-template', dir: made.dir });
  }
  for (const n of folders(path.join(COMPAT, 'projects'))) out.push({ id: n, kind: 'owner', dir: path.join(COMPAT, 'projects', n) });
  return out;
}
