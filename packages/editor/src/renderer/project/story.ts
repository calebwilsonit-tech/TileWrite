import {
  CutsceneSchema,
  DialogueSchema,
  ItemsFileSchema,
  SkinsFileSchema,
  MinigamesFileSchema,
  WorldMapSchema,
  type WorldMapData,
  type MinigameData,
  CURRENT_SCHEMA_VERSION,
  ProjectInputSchema,
  UiLayoutSchema,
  completeLayout,
  defaultUiLayout,
  emptyProjectInput,
  type ProjectInput,
  type UiLayout,
  type SkinData,
  type CutsceneData,
  type DialogueData,
  type ItemData,
} from '@tilewright/runtime';
import type { z } from 'zod';
import type { AssetFs } from '../studio/assets';
import { joinPath } from './api';
import { UserError } from './io';

export const ITEMS_FILE = 'assets/items.json';
export const SKINS_FILE = 'assets/skins.json';
export const MINIGAMES_FILE = 'assets/minigames.json';
export const WORLDMAP_FILE = 'assets/worldmap.json';
export const INPUT_FILE = 'assets/input.json';
export const UI_FILE = 'assets/ui.json';
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

// ---------- the world map ----------

export async function loadWorldMap(fs: AssetFs, dir: string): Promise<{ map: WorldMapData | null; problems: string[] }> {
  const file = joinPath(dir, WORLDMAP_FILE);
  try {
    if (!(await fs.exists(file))) return { map: null, problems: [] };
    const r = WorldMapSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { map: null, problems: [`The world map file is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { map: r.data, problems: [] };
  } catch (e) {
    return { map: null, problems: [`The world map file could not be read (${(e as Error).message}).`] };
  }
}

export async function saveWorldMap(fs: AssetFs, dir: string, map: WorldMapData): Promise<void> {
  const ids = new Set<string>();
  for (const n of map.nodes) {
    if (ids.has(n.id)) throw new UserError(`Two places on the map share the id "${n.id}". Place ids must be different.`);
    ids.add(n.id);
  }
  await fs.write(joinPath(dir, WORLDMAP_FILE), json({ ...map, schemaVersion: CURRENT_SCHEMA_VERSION }));
}

// ---------- controls and interface ----------

export async function loadProjectInput(fs: AssetFs, dir: string): Promise<{ input: ProjectInput; problems: string[] }> {
  const file = joinPath(dir, INPUT_FILE);
  try {
    if (!(await fs.exists(file))) return { input: emptyProjectInput(), problems: [] };
    const r = ProjectInputSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { input: emptyProjectInput(), problems: [`The controls file is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { input: r.data, problems: [] };
  } catch (e) {
    return { input: emptyProjectInput(), problems: [`The controls file could not be read (${(e as Error).message}).`] };
  }
}

export async function saveProjectInput(fs: AssetFs, dir: string, input: ProjectInput): Promise<void> {
  await fs.write(joinPath(dir, INPUT_FILE), json({ ...input, schemaVersion: CURRENT_SCHEMA_VERSION }));
}

export async function loadUiLayout(fs: AssetFs, dir: string): Promise<{ layout: UiLayout; problems: string[] }> {
  const file = joinPath(dir, UI_FILE);
  try {
    if (!(await fs.exists(file))) return { layout: defaultUiLayout(), problems: [] };
    const r = UiLayoutSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { layout: defaultUiLayout(), problems: [`The interface file is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { layout: completeLayout(r.data), problems: [] };
  } catch (e) {
    return { layout: defaultUiLayout(), problems: [`The interface file could not be read (${(e as Error).message}).`] };
  }
}

export async function saveUiLayout(fs: AssetFs, dir: string, layout: UiLayout): Promise<void> {
  const ids = new Set<string>();
  for (const w of layout.widgets) {
    if (ids.has(w.id)) throw new UserError(`Two pieces of the screen share the name "${w.id}". Names must be different.`);
    ids.add(w.id);
  }
  await fs.write(joinPath(dir, UI_FILE), json({ ...layout, schemaVersion: CURRENT_SCHEMA_VERSION }));
}

// ---------- minigames ----------

export async function loadMinigames(fs: AssetFs, dir: string): Promise<{ minigames: MinigameData[]; problems: string[] }> {
  const file = joinPath(dir, MINIGAMES_FILE);
  try {
    if (!(await fs.exists(file))) return { minigames: [], problems: [] };
    const r = MinigamesFileSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { minigames: [], problems: [`The minigames file is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { minigames: r.data.minigames, problems: [] };
  } catch (e) {
    return { minigames: [], problems: [`The minigames file could not be read (${(e as Error).message}).`] };
  }
}

export async function saveMinigames(fs: AssetFs, dir: string, minigames: readonly MinigameData[]): Promise<void> {
  const names = new Set<string>();
  for (const m of minigames) {
    if (names.has(m.name)) throw new UserError(`Two minigames share the name "${m.name}". Minigame names must be different.`);
    names.add(m.name);
  }
  await fs.write(joinPath(dir, MINIGAMES_FILE), json({ schemaVersion: CURRENT_SCHEMA_VERSION, minigames }));
}

// ---------- skins ----------

export async function loadSkins(fs: AssetFs, dir: string): Promise<{ skins: SkinData[]; problems: string[] }> {
  const file = joinPath(dir, SKINS_FILE);
  try {
    if (!(await fs.exists(file))) return { skins: [], problems: [] };
    const r = SkinsFileSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { skins: [], problems: [`The skins file is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { skins: r.data.skins, problems: [] };
  } catch (e) {
    return { skins: [], problems: [`The skins file could not be read (${(e as Error).message}).`] };
  }
}

export async function saveSkins(fs: AssetFs, dir: string, skins: readonly SkinData[]): Promise<void> {
  const ids = new Set<string>();
  for (const s of skins) {
    if (ids.has(s.id)) throw new UserError(`Two skins share the id "${s.id}". Skin ids must be different.`);
    ids.add(s.id);
  }
  await fs.write(joinPath(dir, SKINS_FILE), json({ schemaVersion: CURRENT_SCHEMA_VERSION, skins }));
}

/** Problems with the skins, in plain English. `sprites` and `variables` are the names that exist; `items` the item ids. */
export function skinProblems(skins: readonly SkinData[], known: { sprites: ReadonlySet<string>; items: ReadonlySet<string> }): string[] {
  const out: string[] = [];
  for (const s of skins) {
    if (s.color < 0 && s.sprite === '') out.push(`The skin "${s.name}" looks exactly like the original: give it a colour or a sprite.`);
    if (s.sprite !== '' && !known.sprites.has(s.sprite)) out.push(`The skin "${s.name}" uses the sprite "${s.sprite}", which is not in this project.`);
    if (s.unlock.kind === 'item' && !known.items.has(s.unlock.item)) out.push(`The skin "${s.name}" unlocks with the item "${s.unlock.item}", which is not in the item list.`);
    if (s.unlock.kind === 'variable' && s.unlock.name === '') out.push(`The skin "${s.name}" unlocks with a variable but none is named.`);
  }
  return out;
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
