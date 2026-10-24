import type { AutotileRuleData, TileDefData, UiPrefab, UiScreen } from '@tilewright/runtime';
import { joinPath } from '../project/api';
import type { AssetFs } from '../studio/assets';
import { PACK_FORMAT, encodeFile, spritesOfTiles, tileClosure, tilesUsedByStructure, type Pack, type PackFile, type PackKind } from './pack';

/** Reading a project's files into a pack. Everything the item needs comes along, so it works in a project that has none of it. */

export interface PackSource {
  fs: AssetFs;
  dir: string;
  tiles: readonly TileDefData[];
  autotile: readonly AutotileRuleData[];
  uiPrefabs: readonly UiPrefab[];
  uiScreens?: readonly UiScreen[];
  tileSize: { w: number; h: number };
}

export interface PackInfo {
  name: string;
  description?: string;
  author?: string;
  licence?: string;
  tags?: string[];
}

const spritePath = (name: string): string => `assets/sprites/${name}.sprite.json`;
const BINARY = /\.(png|wav|ogg|mp3|jpg|jpeg|gif|webp)$/i;

async function readFile(src: PackSource, rel: string): Promise<PackFile | null> {
  const full = joinPath(src.dir, rel);
  try {
    if (BINARY.test(rel)) return encodeFile(rel, await src.fs.readBinary(full));
    return encodeFile(rel, await src.fs.read(full));
  } catch {
    return null;
  }
}

/** Sprites a sprite refers to (the other side of an attachment, its variants). */
function spriteLinks(text: string): string[] {
  try {
    const meta = (JSON.parse(text) as { meta?: { otherSide?: string; variants?: { sprite: string }[] } }).meta;
    return [...(meta?.otherSide ? [meta.otherSide] : []), ...(meta?.variants ?? []).map((v) => v.sprite)];
  } catch {
    return [];
  }
}

/** Add sprites and the sprites they link to, once each. Missing pictures are reported. */
async function addSprites(src: PackSource, names: Iterable<string>, files: Map<string, PackFile>, missing: string[]): Promise<void> {
  const queue = [...names];
  while (queue.length > 0) {
    const name = queue.pop()!;
    const rel = spritePath(name);
    if (files.has(rel)) continue;
    const f = await readFile(src, rel);
    if (!f) {
      missing.push(name);
      continue;
    }
    files.set(rel, f);
    queue.push(...spriteLinks(f.data));
  }
}

const base = (kind: PackKind, info: PackInfo, src: PackSource): Pack => ({
  format: PACK_FORMAT,
  // a pack is written in the oldest format that can hold it (screens need 2)
  formatVersion: 1,
  name: info.name.trim(),
  kind,
  description: info.description ?? '',
  author: info.author ?? '',
  licence: info.licence ?? '',
  tags: info.tags ?? [],
  createdAt: new Date().toISOString(),
  tileSize: src.tileSize,
  files: [],
  tiles: [],
  autotile: [],
  uiPrefabs: [],
  uiScreens: [],
  code: false,
});

export interface Built {
  pack: Pack;
  /** Things the item uses that could not be found in the project (so the pack is not complete). */
  missing: string[];
}

/** Pictures: characters, animations, tall props, wall and floor attachments (with their other side and variants). */
export async function buildSpritePack(src: PackSource, kind: 'character' | 'animation' | 'prop' | 'attachment', info: PackInfo, sprites: string[]): Promise<Built> {
  const files = new Map<string, PackFile>();
  const missing: string[] = [];
  await addSprites(src, sprites, files, missing);
  return { pack: { ...base(kind, info, src), files: [...files.values()] }, missing };
}

function withTiles(src: PackSource, p: Pack, ids: Iterable<number>): Pack {
  const tiles = tileClosure(src.tiles, ids);
  const bases = new Set(tiles.map((t) => t.id));
  return { ...p, tiles: structuredClone(tiles as TileDefData[]), autotile: src.autotile.filter((r) => bases.has(r.base) && bases.has(r.result)).map((r) => structuredClone(r) as AutotileRuleData) };
}

/** One tile, or a tileset (the tiles you pick, their variants and the autotile rules between them), with the pictures. */
export async function buildTilePack(src: PackSource, kind: 'tile' | 'tileset', info: PackInfo, tileIds: number[]): Promise<Built> {
  const p = withTiles(src, base(kind, info, src), tileIds);
  const files = new Map<string, PackFile>();
  const missing: string[] = [];
  await addSprites(src, spritesOfTiles(p.tiles), files, missing);
  return { pack: { ...p, files: [...files.values()] }, missing };
}

/** A structure: its file, the tiles its blocks use (ids are local to the pack), and everything they and its objects draw with. */
export async function buildStructurePack(src: PackSource, info: PackInfo, structureName: string): Promise<Built> {
  const rel = `assets/structures/${structureName}.structure.json`;
  const file = await readFile(src, rel);
  if (!file) return { pack: base('structure', info, src), missing: [`structure ${structureName}`] };
  const files = new Map<string, PackFile>([[rel, file]]);
  const missing: string[] = [];
  const parsed = JSON.parse(file.data) as { blocks: { tile: number; faces?: Record<string, number> }[]; entities?: { components?: Record<string, { asset?: string }> }[] };
  const p = withTiles(src, base('structure', info, src), tilesUsedByStructure(parsed));
  const sprites = new Set(spritesOfTiles(p.tiles));
  for (const e of parsed.entities ?? []) {
    const a = e.components?.sprite?.asset;
    if (typeof a === 'string') sprites.add(a.split('#')[0]!);
  }
  await addSprites(src, sprites, files, missing);
  return { pack: { ...p, files: [...files.values()] }, missing };
}

/**
 * Interface pieces: the prefabs and screens picked in the UI designer. A pick is a name (a prefab), `prefab:Name` or `screen:Name`.
 * A screen that is a copy of a plugin's screen keeps the note of where it came from.
 */
export function buildUiPack(src: PackSource, info: PackInfo, picks: string[]): Built {
  const prefabNames = picks.filter((n) => !n.startsWith('screen:')).map((n) => n.replace(/^prefab:/, ''));
  const screenNames = picks.filter((n) => n.startsWith('screen:')).map((n) => n.slice(7));
  const wanted = src.uiPrefabs.filter((p) => prefabNames.includes(p.name));
  const screens = (src.uiScreens ?? []).filter((s) => screenNames.includes(s.name));
  const missing = [
    ...prefabNames.filter((n) => !wanted.some((p) => p.name === n)).map((n) => `UI prefab ${n}`),
    ...screenNames.filter((n) => !screens.some((s) => s.name === n)).map((n) => `UI screen ${n}`),
  ];
  const pack: Pack = { ...base('ui', info, src), uiPrefabs: structuredClone(wanted as UiPrefab[]), uiScreens: structuredClone(screens as UiScreen[]) };
  return { pack: screens.length > 0 ? { ...pack, formatVersion: 2 } : pack, missing };
}

/** A behaviour with the custom components and tables it names. */
export async function buildBehaviourPack(src: PackSource, info: PackInfo, behaviourNames: string[], extra: { components: string[]; tables: string[] }): Promise<Built> {
  const files = new Map<string, PackFile>();
  const missing: string[] = [];
  const add = async (rel: string, label: string): Promise<string | null> => {
    const f = await readFile(src, rel);
    if (!f) {
      missing.push(label);
      return null;
    }
    files.set(rel, f);
    return f.data;
  };
  const texts: string[] = [];
  for (const n of behaviourNames) {
    const t = await add(`assets/behaviors/${n}.behavior.json`, `behaviour ${n}`);
    if (t) texts.push(t);
  }
  for (const c of extra.components) await add(`assets/components/${c}.component.json`, `component ${c}`);
  for (const t of extra.tables) await add(`assets/tables/${t}.table.json`, `table ${t}`);
  return { pack: { ...base('behaviour', info, src), files: [...files.values()] }, missing };
}

/** Names of components and tables the text of a behaviour mentions, so the builder can offer to bring them along. */
export function guessBehaviourNeeds(behaviourText: string, componentNames: readonly string[], tableNames: readonly string[]): { components: string[]; tables: string[] } {
  const mentions = (n: string): boolean => behaviourText.includes(`"${n}"`) || new RegExp(`\\b${n}\\.`).test(behaviourText);
  return { components: componentNames.filter(mentions), tables: tableNames.filter(mentions) };
}

/** Sounds (files under assets/audio). */
export async function buildSoundPack(src: PackSource, info: PackInfo, soundFiles: string[]): Promise<Built> {
  const files: PackFile[] = [];
  const missing: string[] = [];
  for (const rel of soundFiles) {
    const f = await readFile(src, rel.startsWith('assets/') ? rel : `assets/audio/${rel}`);
    if (f) files.push(f);
    else missing.push(`sound ${rel}`);
  }
  return { pack: { ...base('sound', info, src), files }, missing };
}

/** A small picture for the library grid: the first sprite's first frame as a data URL, or '' when there is none to draw. */
export type ThumbMaker = (spriteName: string) => Promise<string>;

/** The sprite a pack is best shown with. */
export function thumbnailSprite(pack: Pack): string | null {
  const first = pack.tiles[0];
  if (first?.art) return first.art.split('#')[0]!;
  const f = pack.files.find((x) => x.path.endsWith('.sprite.json'));
  return f ? f.path.split('/').pop()!.replace('.sprite.json', '') : null;
}
