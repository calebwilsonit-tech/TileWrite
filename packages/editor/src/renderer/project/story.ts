import {
  CutsceneSchema,
  DialogueSchema,
  ItemsFileSchema,
  CURRENT_SCHEMA_VERSION,
  type CutsceneData,
  type DialogueData,
  type ItemData,
} from '@tilewright/runtime';
import type { z } from 'zod';
import type { AssetFs } from '../studio/assets';
import { joinPath } from './api';
import { UserError } from './io';

export const ITEMS_FILE = 'assets/items.json';
export const DIALOGUE_DIR = 'assets/dialogues';
export const CUTSCENE_DIR = 'assets/cutscenes';
const DIALOGUE_EXT = '.dialogue.json';
const CUTSCENE_EXT = '.cutscene.json';

/** Names become file names, so keep them simple and portable (same rule as prefabs and sprites). */
export function storyNameProblem(name: string, existing: readonly string[] = [], what = 'item'): string | null {
  const n = name.trim();
  if (n.length === 0) return `Give the ${what} a name.`;
  if (n.length > 40) return `${what[0]!.toUpperCase()}${what.slice(1)} names can be at most 40 characters.`;
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(n)) return `Use letters, numbers, spaces, - and _ in a ${what} name, starting with a letter or number.`;
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return `A ${what} called "${n}" already exists.`;
  return null;
}

async function loadFolder<T>(fs: AssetFs, dir: string, sub: string, ext: string, schema: z.ZodType<T>, what: string): Promise<{ items: Map<string, T>; problems: string[] }> {
  const items = new Map<string, T>();
  const problems: string[] = [];
  let names: string[];
  try {
    names = (await fs.list(joinPath(dir, sub))).filter((e) => !e.dir && e.name.endsWith(ext)).map((e) => e.name.slice(0, -ext.length)).sort((a, b) => a.localeCompare(b));
  } catch {
    return { items, problems };
  }
  for (const name of names) {
    try {
      const raw = JSON.parse(await fs.read(joinPath(dir, sub, `${name}${ext}`)));
      const r = schema.safeParse(raw);
      if (!r.success) problems.push(`The ${what} "${name}" is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`);
      else items.set(name, r.data);
    } catch (e) {
      problems.push(`The ${what} "${name}" could not be read (${(e as Error).message}).`);
    }
  }
  return { items, problems };
}

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

// ---------- items ----------

export async function loadItems(fs: AssetFs, dir: string): Promise<{ items: ItemData[]; problems: string[] }> {
  const file = joinPath(dir, ITEMS_FILE);
  try {
    if (!(await fs.exists(file))) return { items: [], problems: [] };
    const r = ItemsFileSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { items: [], problems: [`The items file is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { items: r.data.items, problems: [] };
  } catch (e) {
    return { items: [], problems: [`The items file could not be read (${(e as Error).message}).`] };
  }
}

export async function saveItems(fs: AssetFs, dir: string, items: readonly ItemData[]): Promise<void> {
  const ids = new Set<string>();
  for (const i of items) {
    if (ids.has(i.id)) throw new UserError(`Two items share the id "${i.id}". Item ids must be different.`);
    ids.add(i.id);
  }
  await fs.write(joinPath(dir, ITEMS_FILE), json({ schemaVersion: CURRENT_SCHEMA_VERSION, items }));
}

// ---------- dialogues and cutscenes ----------

export const loadDialogues = (fs: AssetFs, dir: string) => loadFolder(fs, dir, DIALOGUE_DIR, DIALOGUE_EXT, DialogueSchema, 'dialogue');
export const loadCutscenes = (fs: AssetFs, dir: string) => loadFolder(fs, dir, CUTSCENE_DIR, CUTSCENE_EXT, CutsceneSchema, 'cutscene');

export async function saveDialogue(fs: AssetFs, dir: string, d: DialogueData): Promise<void> {
  const problem = storyNameProblem(d.name, [], 'dialogue');
  if (problem) throw new UserError(problem);
  await fs.write(joinPath(dir, DIALOGUE_DIR, `${d.name}${DIALOGUE_EXT}`), json(d));
}

export async function deleteDialogue(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(joinPath(dir, DIALOGUE_DIR, `${name}${DIALOGUE_EXT}`));
}

export async function saveCutscene(fs: AssetFs, dir: string, c: CutsceneData): Promise<void> {
  const problem = storyNameProblem(c.name, [], 'cutscene');
  if (problem) throw new UserError(problem);
  await fs.write(joinPath(dir, CUTSCENE_DIR, `${c.name}${CUTSCENE_EXT}`), json(c));
}

export async function deleteCutscene(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(joinPath(dir, CUTSCENE_DIR, `${name}${CUTSCENE_EXT}`));
}
