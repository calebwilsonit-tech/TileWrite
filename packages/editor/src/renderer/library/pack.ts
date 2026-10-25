import { z } from 'zod';
import { AutotileRuleSchema, TileDefSchema, UiPrefabSchema, UiScreenSchema, type AutotileRuleData, type TileDefData, type UiPrefab, type UiScreen } from '@tilewright/runtime';

/**
 * Asset packs: one JSON file holding art, tile definitions, structures, interface pieces, behaviours and sounds with what they
 * need, so they can move between projects and computers. The personal library stores every item as a pack, and the community hub
 * exchanges the same files. Pure functions: planning an import, applying it to plain data, and building packs.
 */

export const PACK_FORMAT = 'tilewright-pack';
/** 2: a pack can hold whole interface screens (`uiScreens`). A pack without them is still written as 1, so older versions read it. */
export const PACK_VERSION = 2;

export const PACK_KINDS = ['tile', 'tileset', 'prop', 'attachment', 'character', 'animation', 'ui', 'structure', 'behaviour', 'sound', 'template', 'plugin'] as const;
export type PackKind = (typeof PACK_KINDS)[number];

export const PACK_KIND_LABELS: Record<PackKind, string> = {
  tile: 'Tile',
  tileset: 'Tileset',
  prop: 'Tall prop',
  attachment: 'Attachment',
  character: 'Character',
  animation: 'Animation',
  ui: 'UI widgets',
  structure: 'Structure',
  behaviour: 'Behaviour',
  sound: 'Sound',
  template: 'Template',
  plugin: 'Plugin',
};

export const PackFileSchema = z.object({
  /** Project-relative path with forward slashes, inside assets/. */
  path: z.string().min(1),
  encoding: z.enum(['utf8', 'base64']),
  data: z.string(),
});
export type PackFile = z.infer<typeof PackFileSchema>;

export const PackSchema = z.object({
  format: z.literal(PACK_FORMAT),
  formatVersion: z.number().int().min(1),
  name: z.string().min(1),
  kind: z.enum(PACK_KINDS),
  description: z.string().default(''),
  author: z.string().default(''),
  /** SPDX-like id or free text: CC0-1.0, CC-BY-4.0, CC-BY-NC-4.0, free-for-any-game, or a custom text. */
  licence: z.string().default(''),
  tags: z.array(z.string()).default([]),
  createdAt: z.string().default(''),
  /** The size of one floor tile it was made for (so a mismatch can be reported). */
  tileSize: z.object({ w: z.number(), h: z.number() }).optional(),
  files: z.array(PackFileSchema).default([]),
  /** Tile definitions with ids local to the pack; the files that refer to tile ids (structures) use the same ids. */
  tiles: z.array(TileDefSchema).default([]),
  autotile: z.array(AutotileRuleSchema).default([]),
  uiPrefabs: z.array(UiPrefabSchema).default([]),
  /** Whole screens (a pause menu, an inventory) with the role each plays. */
  uiScreens: z.array(UiScreenSchema).default([]),
  /** The pack holds code (scripts or plugins): it is marked, needs approval, and is never installed silently. */
  code: z.boolean().default(false),
});
export type Pack = z.infer<typeof PackSchema>;

export function parsePack(json: unknown): { ok: true; pack: Pack } | { ok: false; error: string } {
  if (typeof json !== 'object' || json === null || (json as { format?: unknown }).format !== PACK_FORMAT) return { ok: false, error: 'This file is not a Tilewright asset pack.' };
  const v = (json as { formatVersion?: unknown }).formatVersion;
  if (typeof v === 'number' && v > PACK_VERSION) return { ok: false, error: 'This pack was made by a newer Tilewright. Update Tilewright to open it.' };
  const r = PackSchema.safeParse(json);
  if (!r.success) return { ok: false, error: `The pack is damaged: ${r.error.issues[0]?.path.join('.') ?? ''} ${r.error.issues[0]?.message ?? ''}`.trim() };
  return { ok: true, pack: r.data };
}

// ---------- what is inside ----------

export interface PackEntry {
  kind: 'sprite' | 'tile' | 'structure' | 'table' | 'component' | 'behaviour' | 'sound' | 'ui prefab' | 'ui screen' | 'rule' | 'file';
  name: string;
}

const nameOf = (path: string): string => path.split('/').pop()!.replace(/\.(sprite|structure|table|component|behavior)\.json$/, '').replace(/\.[^.]+$/, '');

/** What a pack contains, for the import preview. */
export function describePack(pack: Pack): PackEntry[] {
  const out: PackEntry[] = [];
  for (const f of pack.files) {
    const kind: PackEntry['kind'] = f.path.endsWith('.sprite.json') ? 'sprite' : f.path.endsWith('.structure.json') ? 'structure' : f.path.endsWith('.table.json') ? 'table' : f.path.endsWith('.component.json') ? 'component' : f.path.endsWith('.behavior.json') ? 'behaviour' : f.path.startsWith('assets/audio/') ? 'sound' : 'file';
    out.push({ kind, name: nameOf(f.path) });
  }
  for (const t of pack.tiles) out.push({ kind: 'tile', name: t.name });
  for (const p of pack.uiPrefabs) out.push({ kind: 'ui prefab', name: p.name });
  for (const s of pack.uiScreens) out.push({ kind: 'ui screen', name: s.name });
  if (pack.autotile.length > 0) out.push({ kind: 'rule', name: `${pack.autotile.length} autotile rules` });
  return out;
}

/** Problems that would stop a pack from working (broken references, escaping paths), in plain English. */
export function checkPack(pack: Pack, project?: { tileW: number; tileH: number }): string[] {
  const out: string[] = [];
  const paths = new Set<string>();
  for (const f of pack.files) {
    if (f.path.startsWith('/') || f.path.includes('..') || !f.path.startsWith('assets/')) out.push(`The file "${f.path}" is outside the assets folder, so it cannot be installed.`);
    if (/\.(ts|js|mjs|cjs)$/.test(f.path) && !pack.code) out.push(`The file "${f.path}" is code but the pack does not say it contains code.`);
    if (paths.has(f.path)) out.push(`The file "${f.path}" is in the pack twice.`);
    paths.add(f.path);
  }
  const sprites = new Set(pack.files.filter((f) => f.path.endsWith('.sprite.json')).map((f) => nameOf(f.path)));
  const tileIds = new Set(pack.tiles.map((t) => t.id));
  for (const t of pack.tiles) {
    for (const s of [t.art, t.leftArt, t.rightArt, ...(t.anim?.frames ?? [])]) {
      if (s && !sprites.has(s.split('#')[0]!)) out.push(`The tile "${t.name}" uses the picture "${s}", which is not in the pack.`);
    }
    if (t.group !== undefined && !tileIds.has(t.group)) out.push(`The tile "${t.name}" is a variant of a tile that is not in the pack.`);
    for (const v of t.variants ?? []) if (!tileIds.has(v.tile)) out.push(`The tile "${t.name}" has a variant that is not in the pack.`);
  }
  for (const r of pack.autotile) if (!tileIds.has(r.base) || !tileIds.has(r.result)) out.push(`An autotile rule ("${r.name}") uses a tile that is not in the pack.`);
  if (pack.tileSize && project && (pack.tileSize.w !== project.tileW || pack.tileSize.h !== project.tileH)) {
    out.push(`This pack was drawn for ${pack.tileSize.w} x ${pack.tileSize.h} tiles but this project uses ${project.tileW} x ${project.tileH}. It will import, but will not line up until the tile size matches.`);
  }
  return out;
}

// ---------- planning an import ----------

/** What the project already has, for finding name clashes. */
export interface ProjectContents {
  files: ReadonlySet<string>;
  tiles: readonly TileDefData[];
  uiPrefabs: readonly UiPrefab[];
  uiScreens?: readonly UiScreen[];
}

export interface Clash {
  kind: 'file' | 'tile' | 'ui prefab' | 'ui screen';
  name: string;
}

export function findClashes(pack: Pack, have: ProjectContents): Clash[] {
  const out: Clash[] = [];
  for (const f of pack.files) if (have.files.has(f.path)) out.push({ kind: 'file', name: f.path });
  for (const t of pack.tiles) if (have.tiles.some((x) => x.name.toLowerCase() === t.name.toLowerCase())) out.push({ kind: 'tile', name: t.name });
  for (const p of pack.uiPrefabs) if (have.uiPrefabs.some((x) => x.name === p.name)) out.push({ kind: 'ui prefab', name: p.name });
  for (const s of pack.uiScreens) if (have.uiScreens?.some((x) => x.name === s.name)) out.push({ kind: 'ui screen', name: s.name });
  return out;
}

export type Resolution = 'rename' | 'replace' | 'skip';

export interface ImportResult {
  /** Files to write (rewritten for renames). */
  files: PackFile[];
  /** The project's tiles after the import. */
  tiles: TileDefData[];
  autotile: AutotileRuleData[];
  uiPrefabs: UiPrefab[];
  uiScreens: UiScreen[];
  /** The pack's tile ids and where they went in this project. */
  tileMap: Map<number, number>;
  /** Files and tiles that were skipped because they clash. */
  skipped: string[];
  /** Names the import chose (renamed sprites, tiles, prefabs, files). */
  renamed: string[];
}

function freeName(base: string, taken: (n: string) => boolean): string {
  let n = 2;
  while (taken(`${base} ${n}`)) n++;
  return `${base} ${n}`;
}

function freeFileName(path: string, taken: (p: string) => boolean): string {
  const dot = path.indexOf('.', path.lastIndexOf('/') + 1);
  const stem = dot < 0 ? path : path.slice(0, dot);
  const ext = dot < 0 ? '' : path.slice(dot);
  let n = 2;
  while (taken(`${stem}_${n}${ext}`)) n++;
  return `${stem}_${n}${ext}`;
}

/**
 * Put a pack into a project's data: new tile ids that do not collide, sprite files renamed (and the tiles that use them
 * following) when names clash, and the files that refer to tile ids (structures) rewritten to the new ids.
 */
export function applyImport(pack: Pack, have: ProjectContents, how: Resolution): ImportResult {
  const taken = new Set(have.files);
  const renamed: string[] = [];
  const skipped: string[] = [];
  // sprite and other files
  const rename = new Map<string, string>();
  const files: PackFile[] = [];
  for (const f of pack.files) {
    let path = f.path;
    if (have.files.has(path)) {
      if (how === 'skip') {
        skipped.push(path);
        continue;
      }
      if (how === 'rename') {
        path = freeFileName(path, (p) => taken.has(p));
        renamed.push(`${nameOf(f.path)} -> ${nameOf(path)}`);
        rename.set(f.path, path);
      }
    }
    taken.add(path);
    files.push({ ...f, path });
  }
  // sprite name changes flow into the tiles that use them
  const spriteRename = new Map<string, string>();
  for (const [from, to] of rename) if (from.endsWith('.sprite.json')) spriteRename.set(nameOf(from), nameOf(to));
  const fixSprite = (s: string | undefined): string | undefined => {
    if (!s) return s;
    const [base, frame] = s.split('#');
    const to = spriteRename.get(base!);
    return to ? (frame !== undefined ? `${to}#${frame}` : to) : s;
  };

  // tiles
  const tiles = structuredClone(have.tiles as TileDefData[]);
  let nextId = tiles.reduce((m, t) => Math.max(m, t.id), 0) + 1;
  const tileMap = new Map<number, number>();
  const toAdd: TileDefData[] = [];
  for (const t of pack.tiles) {
    const existing = tiles.find((x) => x.name.toLowerCase() === t.name.toLowerCase());
    if (existing && how === 'skip') {
      tileMap.set(t.id, existing.id);
      skipped.push(`tile ${t.name}`);
      continue;
    }
    if (existing && how === 'replace') {
      tileMap.set(t.id, existing.id);
      toAdd.push({ ...structuredClone(t), id: existing.id, name: existing.name });
      continue;
    }
    let name = t.name;
    if (existing) {
      name = freeName(t.name, (n) => tiles.some((x) => x.name.toLowerCase() === n.toLowerCase()) || toAdd.some((x) => x.name.toLowerCase() === n.toLowerCase()));
      renamed.push(`tile ${t.name} -> ${name}`);
    }
    const id = nextId++;
    tileMap.set(t.id, id);
    toAdd.push({ ...structuredClone(t), id, name });
  }
  const remap = (id: number): number => tileMap.get(id) ?? id;
  const merged: TileDefData[] = [];
  for (const t of toAdd) {
    const next: TileDefData = { ...t };
    if (next.art) next.art = fixSprite(next.art)!;
    if (next.leftArt) next.leftArt = fixSprite(next.leftArt)!;
    if (next.rightArt) next.rightArt = fixSprite(next.rightArt)!;
    if (next.anim) next.anim = { ...next.anim, frames: next.anim.frames.map((f) => fixSprite(f)!) };
    if (next.group !== undefined) next.group = remap(next.group);
    if (next.variants) next.variants = next.variants.map((v) => ({ ...v, tile: remap(v.tile) }));
    merged.push(next);
  }
  const replaceIds = new Set(merged.map((t) => t.id));
  const outTiles = [...tiles.filter((t) => !replaceIds.has(t.id)), ...merged];
  const rules: AutotileRuleData[] = pack.autotile.map((r) => ({ ...r, id: `${r.id}-${remap(r.result)}`, base: remap(r.base), result: remap(r.result) }));
  // structures hold tile ids: they follow the tiles
  const outFiles = files.map((f) => {
    if (!f.path.endsWith('.structure.json') || f.encoding !== 'utf8') return f;
    try {
      const s = JSON.parse(f.data) as { blocks?: { tile: number; faces?: Record<string, number> }[] };
      for (const b of s.blocks ?? []) {
        b.tile = remap(b.tile);
        if (b.faces) for (const k of Object.keys(b.faces)) b.faces[k] = remap(b.faces[k]!);
      }
      return { ...f, data: JSON.stringify(s, null, 2) + '\n' };
    } catch {
      return f;
    }
  });
  // interface prefabs
  const prefabs = structuredClone(have.uiPrefabs as UiPrefab[]);
  for (const p of pack.uiPrefabs) {
    const existing = prefabs.findIndex((x) => x.name === p.name);
    if (existing >= 0) {
      if (how === 'skip') {
        skipped.push(`UI prefab ${p.name}`);
        continue;
      }
      if (how === 'replace') {
        prefabs[existing] = structuredClone(p);
        continue;
      }
      const name = freeName(p.name, (n) => prefabs.some((x) => x.name === n));
      renamed.push(`UI prefab ${p.name} -> ${name}`);
      prefabs.push({ ...structuredClone(p), name });
    } else prefabs.push(structuredClone(p));
  }
  // interface screens: a clash is settled by the name; the id is made new when it is taken
  const screens = structuredClone((have.uiScreens ?? []) as UiScreen[]);
  for (const s of pack.uiScreens) {
    const existing = screens.findIndex((x) => x.name === s.name);
    if (existing >= 0 && how === 'skip') {
      skipped.push(`UI screen ${s.name}`);
      continue;
    }
    if (existing >= 0 && how === 'replace') {
      screens[existing] = { ...structuredClone(s), id: screens[existing]!.id };
      continue;
    }
    const name = existing >= 0 ? freeName(s.name, (n) => screens.some((x) => x.name === n)) : s.name;
    if (name !== s.name) renamed.push(`UI screen ${s.name} -> ${name}`);
    const id = freeName(s.id, (n) => screens.some((x) => x.id === n));
    screens.push({ ...structuredClone(s), name, id });
  }
  const rulesNow = rules.filter((r) => outTiles.some((t) => t.id === r.base) && outTiles.some((t) => t.id === r.result));
  return { files: outFiles, tiles: outTiles, autotile: rulesNow, uiPrefabs: prefabs, uiScreens: screens, tileMap, skipped, renamed };
}

// ---------- bytes <-> text ----------

export function encodeFile(path: string, bytes: Uint8Array | string): PackFile {
  if (typeof bytes === 'string') return { path, encoding: 'utf8', data: bytes };
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return { path, encoding: 'base64', data: btoa(bin) };
}

export function decodeFile(f: PackFile): string | Uint8Array {
  if (f.encoding === 'utf8') return f.data;
  const bin = atob(f.data);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// ---------- building ----------

/** Tile ids the blocks of a structure file use. */
export function tilesUsedByStructure(structure: { blocks: { tile: number; faces?: Record<string, number> }[] }): number[] {
  const ids = new Set<number>();
  for (const b of structure.blocks) {
    ids.add(b.tile);
    for (const v of Object.values(b.faces ?? {})) ids.add(v);
  }
  return [...ids];
}

/** The tiles a set of tiles needs: themselves, their variants, the base tile of a variant, and their autotile variants. */
export function tileClosure(all: readonly TileDefData[], start: Iterable<number>): TileDefData[] {
  const byId = new Map(all.map((t) => [t.id, t]));
  const want = new Set<number>();
  const stack = [...start];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (want.has(id)) continue;
    const t = byId.get(id);
    if (!t) continue;
    want.add(id);
    if (t.group !== undefined) stack.push(t.group);
    for (const v of t.variants ?? []) stack.push(v.tile);
    for (const child of all) if (child.group === id) stack.push(child.id); // edge pieces made for this tile
  }
  return all.filter((t) => want.has(t.id));
}

/** Sprite names a tile list refers to (art, side art and animation frames). */
export function spritesOfTiles(tiles: readonly TileDefData[]): string[] {
  const out = new Set<string>();
  for (const t of tiles) for (const s of [t.art, t.leftArt, t.rightArt, ...(t.anim?.frames ?? [])]) if (s) out.add(s.split('#')[0]!);
  return [...out];
}
