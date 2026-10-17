import { EMPTY_TILE, TileMap, type TileDef, type TileSet } from './tilemap';

/**
 * Autotiling: paint "water" and the engine picks the right look for each cell from its neighbours, so shores,
 * edges, corners and cliff faces appear by themselves.
 *
 * A tile can be a *variant* of another tile (`group` = the base tile). A rule says: "for a cell whose base is X,
 * when its eight neighbours look like this pattern, show the variant Y". Rules are tried in order and the first
 * match wins; no match leaves the base tile. Rules never need to know about art: a variant is just another tile.
 */

/** Neighbour order in a pattern: N, NE, E, SE, S, SW, W, NW (N is toward smaller y, E toward bigger x). */
export const NEIGHBOURS: readonly { dx: number; dy: number; name: string }[] = [
  { dx: 0, dy: -1, name: 'N' },
  { dx: 1, dy: -1, name: 'NE' },
  { dx: 1, dy: 0, name: 'E' },
  { dx: 1, dy: 1, name: 'SE' },
  { dx: 0, dy: 1, name: 'S' },
  { dx: -1, dy: 1, name: 'SW' },
  { dx: -1, dy: 0, name: 'W' },
  { dx: -1, dy: -1, name: 'NW' },
];

/**
 * What one neighbour must be, one character each:
 * `1` the same kind of tile (same base), `0` anything else (other tile, empty, off the map), `*` don't care,
 * `L` lower ground than this cell (empty and off the map count as lower), `H` higher ground.
 */
export const PATTERN_CHARS = ['1', '0', '*', 'L', 'H'] as const;
export type PatternChar = (typeof PATTERN_CHARS)[number];

export interface AutotileRule {
  id: string;
  name: string;
  /** The base tile this rule is for. */
  base: number;
  /** Eight characters, see `PATTERN_CHARS`. */
  pattern: string;
  /** The variant tile shown when the rule matches. */
  result: number;
}

export const PATTERN_RE = /^[01*LH]{8}$/;

/** Edge bits of a rim (which sides of the top face get an outline). */
export const RIM_SIDE = { N: 1, E: 2, S: 4, W: 8 } as const;
/** Corner bits of a rim (which corners get a dot): NE, SE, SW, NW. */
export const RIM_CORNER = { NE: 1, SE: 2, SW: 4, NW: 8 } as const;

export const groupOf = (tileset: TileSet, tile: number): number => tileset[tile]?.group ?? tile;

/** The tile in a neighbouring cell, as a base, or -1 for empty / off the map. */
function baseAt(map: TileMap, tileset: TileSet, x: number, y: number): number {
  const t = map.getTile(x, y);
  return t === EMPTY_TILE ? -1 : groupOf(tileset, t);
}

function matches(map: TileMap, tileset: TileSet, x: number, y: number, base: number, pattern: string): boolean {
  const here = map.getHeight(x, y);
  for (let i = 0; i < 8; i++) {
    const c = pattern[i]!;
    if (c === '*') continue;
    const n = NEIGHBOURS[i]!;
    const nx = x + n.dx;
    const ny = y + n.dy;
    const nb = baseAt(map, tileset, nx, ny);
    const nh = nb === -1 ? -Infinity : map.getHeight(nx, ny);
    const ok = c === '1' ? nb === base : c === '0' ? nb !== base : c === 'L' ? nh < here : nh > here;
    if (!ok) return false;
  }
  return true;
}

/** The tile that should be stored in a cell: a variant if a rule matches, else the base tile. Cells whose base has no rules are left alone. */
export function resolveTile(map: TileMap, tileset: TileSet, rules: readonly AutotileRule[], x: number, y: number): number {
  const tile = map.getTile(x, y);
  if (tile === EMPTY_TILE) return tile;
  const base = groupOf(tileset, tile);
  let any = false;
  for (const r of rules) {
    if (r.base !== base) continue;
    any = true;
    if (matches(map, tileset, x, y, base, r.pattern)) return r.result;
  }
  return any ? base : tile;
}

/** Which rule would apply to a cell (for "why does this look like that?" in the editor). */
export function ruleFor(map: TileMap, tileset: TileSet, rules: readonly AutotileRule[], x: number, y: number): AutotileRule | null {
  const tile = map.getTile(x, y);
  if (tile === EMPTY_TILE) return null;
  const base = groupOf(tileset, tile);
  for (const r of rules) if (r.base === base && matches(map, tileset, x, y, base, r.pattern)) return r;
  return null;
}

/** The cell and its eight neighbours (the cells whose look can change when this one changes), inside the map. */
export function around(map: TileMap, x: number, y: number): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (map.inBounds(x + dx, y + dy)) out.push({ x: x + dx, y: y + dy });
  return out;
}

/** Work out the tile for each cell and set the ones that differ. Returns the cells that changed. */
export function applyAutotile(map: TileMap, tileset: TileSet, rules: readonly AutotileRule[], cells?: readonly { x: number; y: number }[]): { x: number; y: number; from: number; to: number }[] {
  const changed: { x: number; y: number; from: number; to: number }[] = [];
  const visit = (x: number, y: number): void => {
    const from = map.getTile(x, y);
    const to = resolveTile(map, tileset, rules, x, y);
    if (to !== from) {
      map.tiles[y * map.width + x] = to;
      changed.push({ x, y, from, to });
    }
  };
  if (cells) for (const c of cells) visit(c.x, c.y);
  else for (let y = 0; y < map.height; y++) for (let x = 0; x < map.width; x++) visit(x, y);
  return changed;
}

/** Replace every variant in the map with its base tile (used before changing the rules, and by "turn autotiling off"). */
export function stripVariants(map: TileMap, tileset: TileSet): number {
  let n = 0;
  for (let i = 0; i < map.tiles.length; i++) {
    const t = map.tiles[i]!;
    const g = groupOf(tileset, t);
    if (g !== t) {
      map.tiles[i] = g;
      n++;
    }
  }
  return n;
}

// ---------- ready-made rule sets ----------

export interface NewTile {
  id: number;
  name: string;
  top: number;
  left: number;
  right: number;
  group: number;
  wall?: boolean;
  rim?: { sides: number; corners: number; color: number };
}

export interface GeneratedSet {
  tiles: NewTile[];
  rules: AutotileRule[];
}

const SIDE_NAMES: [string, number][] = [['N', RIM_SIDE.N], ['E', RIM_SIDE.E], ['S', RIM_SIDE.S], ['W', RIM_SIDE.W]];
const CORNER_NAMES: [string, number][] = [['NE', RIM_CORNER.NE], ['SE', RIM_CORNER.SE], ['SW', RIM_CORNER.SW], ['NW', RIM_CORNER.NW]];

const bitsName = (mask: number, names: [string, number][]): string => names.filter(([, b]) => mask & b).map(([n]) => n).join('+');

/**
 * Edges and corners for a base tile: a rim along every side that borders something else (a shore for water, a
 * grass edge for grass) and a dot in every corner where only the diagonal neighbour differs. 30 variants and the
 * rules that choose them. The new tiles get ids from `firstId` up.
 */
export function generateEdgeSet(base: number, tileset: TileSet, firstId: number, rimColor: number): GeneratedSet {
  const def: TileDef = tileset[base]!;
  const tiles: NewTile[] = [];
  const rules: AutotileRule[] = [];
  let id = firstId;
  const add = (name: string, pattern: string, sides: number, corners: number): void => {
    const nid = id++;
    tiles.push({ id: nid, name: `${def.name} ${name}`, top: def.top, left: def.left, right: def.right, group: base, ...(def.wall ? { wall: true } : {}), rim: { sides, corners, color: rimColor } });
    rules.push({ id: `auto-${base}-${nid}`, name, base, pattern, result: nid });
  };
  // sides: N E S W are the 1st, 3rd, 5th and 7th characters; diagonals are "don't care" when a side is open
  for (let sides = 1; sides < 16; sides++) {
    const ch = (bit: number): string => (sides & bit ? '0' : '1');
    add(`edge ${bitsName(sides, SIDE_NAMES)}`, `${ch(RIM_SIDE.N)}*${ch(RIM_SIDE.E)}*${ch(RIM_SIDE.S)}*${ch(RIM_SIDE.W)}*`, sides, 0);
  }
  // corners: every side is the same kind, and some diagonals are not
  for (let corners = 1; corners < 16; corners++) {
    const dg = (bit: number): string => (corners & bit ? '0' : '1');
    add(`corner ${bitsName(corners, CORNER_NAMES)}`, `1${dg(RIM_CORNER.NE)}1${dg(RIM_CORNER.SE)}1${dg(RIM_CORNER.SW)}1${dg(RIM_CORNER.NW)}`, 0, corners);
  }
  return { tiles, rules };
}

/**
 * Cliff faces for a base tile: where the ground next to a cell is lower, the camera-facing wall of that cell
 * (south = left face, east = right face) is drawn in the `faceColor` rock instead of the base colour.
 */
export function generateCliffSet(base: number, tileset: TileSet, firstId: number, faceColor: number): GeneratedSet {
  const def: TileDef = tileset[base]!;
  const dark = (c: number): number => ((((c >> 16) & 255) * 0.8) << 16) | ((((c >> 8) & 255) * 0.8) << 8) | ((c & 255) * 0.8);
  const variants: { name: string; s: boolean; e: boolean }[] = [
    { name: 'cliff south', s: true, e: false },
    { name: 'cliff east', s: false, e: true },
    { name: 'cliff south+east', s: true, e: true },
  ];
  const tiles: NewTile[] = [];
  const rules: AutotileRule[] = [];
  let id = firstId;
  for (const v of variants.slice().reverse()) {
    const nid = id++;
    tiles.push({ id: nid, name: `${def.name} ${v.name}`, top: def.top, left: v.s ? faceColor : def.left, right: v.e ? dark(faceColor) : def.right, group: base, ...(def.wall ? { wall: true } : {}) });
    // E is the 3rd character and S the 5th; the other side must NOT be lower, so the three rules never overlap
    const e = v.e ? 'L' : '*';
    const s = v.s ? 'L' : '*';
    rules.push({ id: `auto-${base}-${nid}`, name: v.name, base, pattern: `*${'*'}${e}*${s}***`, result: nid });
  }
  return { tiles, rules };
}
