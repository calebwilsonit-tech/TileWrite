import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProject } from '../../packages/editor/src/renderer/project/io';
import { TEMPLATES } from '../../packages/editor/src/renderer/project/templates';
import { nodeFs } from './nodefs';

export const ROOT = path.resolve(__dirname, '..', '..');
export const COMPAT = path.join(ROOT, 'compat');

export type CorpusKind = 'sample' | 'template' | 'code-template' | 'owner';

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
 * Every project the engine must keep working: each folder of `samples/`, each project under `templates/`, every code
 * template (built fresh into a temporary folder) and every project of the owner's in `compat/projects/`.
 */
export async function corpus(): Promise<CorpusEntry[]> {
  const out: CorpusEntry[] = [];
  for (const n of folders(path.join(ROOT, 'samples'))) out.push({ id: n, kind: 'sample', dir: path.join(ROOT, 'samples', n) });
  for (const n of folders(path.join(ROOT, 'templates'))) out.push({ id: n, kind: 'template', dir: path.join(ROOT, 'templates', n) });
  fs.rmSync(TEMPLATE_BUILD_DIR, { recursive: true, force: true });
  for (const t of TEMPLATES) {
    const made = await createProject(nodeFs, TEMPLATE_BUILD_DIR, t.id, t.id);
    out.push({ id: t.id, kind: 'code-template', dir: made.dir });
  }
  for (const n of folders(path.join(COMPAT, 'projects'))) out.push({ id: n, kind: 'owner', dir: path.join(COMPAT, 'projects', n) });
  return out;
}
