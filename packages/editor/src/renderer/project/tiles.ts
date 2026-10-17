import { DEFAULT_TILESET, PATTERN_CHARS, compositeFrame, type AutotileRule, type GeneratedSet, type ProjectData, type SpriteData, type TileDefData } from '@tilewright/runtime';

/** The project's tiles; a project that never customised them uses the built-in set, which is copied in so it can be extended. */
export function ownTiles(project: Pick<ProjectData, 'tileset'>): TileDefData[] {
  return project.tileset.length > 0 ? project.tileset : Object.entries(DEFAULT_TILESET).map(([id, t]) => ({ id: Number(id), ...t }));
}

/** Tiles you paint with (everything that is not a variant of another tile). */
export const baseTiles = (tiles: readonly TileDefData[]): TileDefData[] => tiles.filter((t) => t.group === undefined);

export const variantsOf = (tiles: readonly TileDefData[], base: number): TileDefData[] => tiles.filter((t) => t.group === base);

export const nextTileId = (tiles: readonly TileDefData[]): number => tiles.reduce((m, t) => Math.max(m, t.id), 0) + 1;

/** Next pattern character when a neighbour square is clicked: * -> 1 -> 0 -> L -> H -> * */
export function nextPatternChar(c: string): string {
  const i = PATTERN_CHARS.indexOf(c as (typeof PATTERN_CHARS)[number]);
  const order = ['*', '1', '0', 'L', 'H'];
  return order[(order.indexOf(i < 0 ? '*' : c) + 1) % order.length]!;
}

export const withPatternChar = (pattern: string, index: number, c: string): string => pattern.slice(0, index) + c + pattern.slice(index + 1);

/** Add a generated set of variants and rules for a base tile. */
export function addGeneratedSet(tiles: readonly TileDefData[], rules: readonly AutotileRule[], set: GeneratedSet): { tiles: TileDefData[]; rules: AutotileRule[] } {
  return { tiles: [...tiles, ...set.tiles], rules: [...rules, ...set.rules] };
}

/** Take away everything autotiling added for a base tile: its rules and its variants. */
export function removeAutotile(tiles: readonly TileDefData[], rules: readonly AutotileRule[], base: number): { tiles: TileDefData[]; rules: AutotileRule[]; removed: number[] } {
  const removed = variantsOf(tiles, base).map((t) => t.id);
  return { tiles: tiles.filter((t) => !removed.includes(t.id)), rules: rules.filter((r) => r.base !== base), removed };
}

/** Mistakes in a rule list that would stop a rule from doing anything, in plain English. */
export function checkRules(tiles: readonly TileDefData[], rules: readonly AutotileRule[]): string[] {
  const out: string[] = [];
  const byId = new Map(tiles.map((t) => [t.id, t]));
  const seen = new Map<string, AutotileRule>();
  rules.forEach((r, i) => {
    const label = `Rule ${i + 1} (${r.name || 'unnamed'})`;
    const base = byId.get(r.base);
    const result = byId.get(r.result);
    if (!base) out.push(`${label} is for a tile that no longer exists.`);
    if (!result) out.push(`${label} shows a tile that no longer exists.`);
    else if (result.id !== r.base && result.group !== r.base) out.push(`${label} shows "${result.name}", which is not a variant of "${base?.name ?? r.base}".`);
    const key = `${r.base}:${r.pattern}`;
    const earlier = seen.get(key);
    if (earlier) out.push(`${label} can never apply: the earlier rule "${earlier.name || 'unnamed'}" matches the same neighbours.`);
    else seen.set(key, r);
    const catchAll = rules.findIndex((x) => x.base === r.base && x.pattern === '********');
    if (catchAll >= 0 && catchAll < i && r.pattern !== '********') out.push(`${label} can never apply: the earlier rule "${rules[catchAll]!.name || 'unnamed'}" matches every cell.`);
  });
  return out;
}

/** Tile ids a scene's map uses that the tile list does not have (they draw as magenta squares). */
export function missingTiles(tileIds: Iterable<number>, tiles: readonly TileDefData[]): number[] {
  const have = new Set(tiles.map((t) => t.id));
  return [...new Set(tileIds)].filter((id) => id !== 0 && !have.has(id)).sort((a, b) => a - b);
}

// ---------- tile art ----------

const shadeInt = (c: number, k: number): number => {
  const ch = (shift: number): number => Math.max(0, Math.min(255, Math.round(((c >> shift) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** The average colour of what a sprite's first frame shows (0xRRGGBB); grey for a blank sprite. */
export function averageColor(sprite: SpriteData): number {
  const rgba = compositeFrame(sprite, 0);
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < rgba.length; i += 4) {
    const a = rgba[i + 3]! / 255;
    if (a < 0.5) continue;
    r += rgba[i]!;
    g += rgba[i + 1]!;
    b += rgba[i + 2]!;
    n++;
  }
  return n === 0 ? 0x9a9a9a : (Math.round(r / n) << 16) | (Math.round(g / n) << 8) | Math.round(b / n);
}

/** A new tile whose top face is drawn by a sprite; its sides take darker shades of the picture's average colour. */
export function tileFromSprite(tiles: readonly TileDefData[], sprite: SpriteData): TileDefData {
  const avg = averageColor(sprite);
  let name = sprite.name;
  for (let n = 2; tiles.some((t) => t.name.toLowerCase() === name.toLowerCase()); n++) name = `${sprite.name} ${n}`;
  return { id: nextTileId(tiles), name, top: avg, left: shadeInt(avg, 0.78), right: shadeInt(avg, 0.6), art: sprite.name };
}

/** Give a tile a sprite for its top face, or take its art away (undefined). Its variants follow it. */
export function setTileArt(tiles: readonly TileDefData[], id: number, art: string | undefined): TileDefData[] {
  return tiles.map((t) => {
    if (t.id !== id && t.group !== id) return t;
    const { art: _old, ...rest } = t;
    return art ? { ...rest, art } : rest;
  });
}

/** Tiles whose art is not a sprite of this project, in plain English. */
export function tileArtProblems(tiles: readonly TileDefData[], sprites: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const t of tiles) if (t.art && !sprites.has(t.art)) out.push(`The tile "${t.name}" is covered by the sprite "${t.art}", which is not in this project, so it is drawn as a flat colour.`);
  return out;
}
