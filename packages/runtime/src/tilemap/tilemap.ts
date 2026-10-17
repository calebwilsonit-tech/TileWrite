import type { DepthBox } from '../render/depth';

/** Tile id 0 means "no tile" (void: nothing to stand on, impassable). */
export const EMPTY_TILE = 0;

export interface TileDef {
  name: string;
  /** Procedural colours until the sprite studio provides art (0xRRGGBB). */
  top: number;
  left: number;
  right: number;
  /** This tile is a variant of another tile (autotiling): the base tile's id. */
  group?: number;
  /** Counts as part of the Walls layer (the Layers panel can hide or lock walls). */
  wall?: boolean;
  /** An outline along some sides of the top face and dots in some corners (edges and shores). */
  rim?: { sides: number; corners: number; color: number };
  /** A sprite (drawn or imported in the sprite studio) that covers the top face instead of the flat colour. */
  art?: string;
}

export type TileSet = Record<number, TileDef>;

/** A project's tile list as a lookup table (undefined for an empty list, which means the built-in tiles). */
export function tilesetFromList(tiles: readonly ({ id: number } & TileDef)[]): TileSet | undefined {
  if (tiles.length === 0) return undefined;
  const set: TileSet = {};
  for (const { id, ...def } of tiles) set[id] = def;
  return set;
}

export const DEFAULT_TILESET: TileSet = {
  1: { name: 'grass', top: 0x6fae5b, left: 0x4f8a43, right: 0x3f7236 },
  2: { name: 'stone', top: 0xa3a7b3, left: 0x80848f, right: 0x666a75 },
  3: { name: 'sand', top: 0xe3d08e, left: 0xc4b374, right: 0xa8985f },
  4: { name: 'water', top: 0x4a90d9, left: 0x3a76b4, right: 0x2f6091 },
  5: { name: 'brick', top: 0xb5654a, left: 0x934f39, right: 0x78402e, wall: true },
  6: { name: 'wood', top: 0x9c6b3f, left: 0x7d5532, right: 0x634327 },
};

/** Per-cell flag bits. */
export const FLAG = {
  /** No floor: bodies fall through. */
  PIT: 1,
  /** Solid at every height (props, invisible walls), or only between the cell's block levels (`blockLow` .. `blockHigh`) when it has them. */
  BLOCK: 2,
  /** Trigger area marker (tools and validators read it; entity triggers do the real work). */
  TRIGGER: 4,
  /** Water: blocks walking; swimming/wading behaviours can opt in. */
  WATER: 8,
} as const;

/** Slope direction = the way the ground RISES across the cell. */
export const SLOPE = { NONE: 0, N: 1, E: 2, S: 3, W: 4 } as const;
export type SlopeDir = (typeof SLOPE)[keyof typeof SLOPE];
export type SlopeStyle = 'ramp' | 'stairs';

/** Every slope climbs exactly this many levels across its cell. */
export const SLOPE_RISE = 1;

/** Edge bits for `oneWay`: crossing INTO the cell through this side is forbidden. */
export const EDGE = { N: 1, E: 2, S: 4, W: 8 } as const;

export interface SlopeInfo {
  dir: SlopeDir;
  style: SlopeStyle;
}

/**
 * Dense grid of columns. Each cell has a tile id and a ground height (levels). A column fills from
 * below the floor up to its height, so sorting and collision treat it as solid ground at that level.
 */
export class TileMap {
  readonly tiles: Uint16Array;
  readonly heights: Uint8Array;
  /** low 3 bits: SLOPE dir; bit 3: stairs style. */
  readonly slopes: Uint8Array;
  readonly flags: Uint8Array;
  /** 0 = no deck, otherwise the deck's walkable level (above the ground). */
  readonly decks: Uint8Array;
  /** Tile id drawn for the deck (0 = use the ground tile's look). */
  readonly deckTiles: Uint16Array;
  readonly oneWay: Uint8Array;
  /** With BLOCK: the lowest level the blocker covers (feet at or above this level... see `blockedAt`). */
  readonly blockLow: Uint8Array;
  /** With BLOCK: 0 = the blocker covers every height; otherwise the level where it stops (exclusive). */
  readonly blockHigh: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    const n = width * height;
    this.tiles = new Uint16Array(n);
    this.heights = new Uint8Array(n);
    this.slopes = new Uint8Array(n);
    this.flags = new Uint8Array(n);
    this.decks = new Uint8Array(n);
    this.deckTiles = new Uint16Array(n);
    this.oneWay = new Uint8Array(n);
    this.blockLow = new Uint8Array(n);
    this.blockHigh = new Uint8Array(n);
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  private idx(x: number, y: number): number {
    return y * this.width + x;
  }

  getTile(x: number, y: number): number {
    return this.inBounds(x, y) ? this.tiles[this.idx(x, y)]! : EMPTY_TILE;
  }

  /** Base ground height (levels) of the cell; 0 outside the map. For a slope this is the LOW end. */
  getHeight(x: number, y: number): number {
    return this.inBounds(x, y) ? this.heights[this.idx(x, y)]! : 0;
  }

  /** Set tile + height. Clears slope, flags, deck and one-way edges so a repaint starts clean. */
  set(x: number, y: number, tile: number, height = 0): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.tiles[i] = tile;
    this.heights[i] = Math.max(0, Math.min(255, Math.round(height)));
    this.slopes[i] = 0;
    this.flags[i] = 0;
    this.decks[i] = 0;
    this.deckTiles[i] = 0;
    this.oneWay[i] = 0;
    this.blockLow[i] = 0;
    this.blockHigh[i] = 0;
  }

  getSlope(x: number, y: number): SlopeInfo | null {
    if (!this.inBounds(x, y)) return null;
    const v = this.slopes[this.idx(x, y)]!;
    const dir = (v & 7) as SlopeDir;
    if (dir === SLOPE.NONE) return null;
    return { dir, style: v & 8 ? 'stairs' : 'ramp' };
  }

  /** Make the cell a stair/ramp rising toward `dir`. `height` is the low end. */
  setSlope(x: number, y: number, dir: SlopeDir, style: SlopeStyle = 'stairs'): void {
    if (!this.inBounds(x, y)) return;
    this.slopes[this.idx(x, y)] = dir === SLOPE.NONE ? 0 : dir | (style === 'stairs' ? 8 : 0);
  }

  getFlags(x: number, y: number): number {
    return this.inBounds(x, y) ? this.flags[this.idx(x, y)]! : 0;
  }

  hasFlag(x: number, y: number, flag: number): boolean {
    return (this.getFlags(x, y) & flag) !== 0;
  }

  setFlag(x: number, y: number, flag: number, on = true): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.flags[i] = on ? this.flags[i]! | flag : this.flags[i]! & ~flag;
  }

  /** Walkable deck level above the ground, or 0. */
  getDeck(x: number, y: number): number {
    return this.inBounds(x, y) ? this.decks[this.idx(x, y)]! : 0;
  }

  setDeck(x: number, y: number, level: number, tile = 0): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    this.decks[i] = Math.max(0, Math.min(255, Math.round(level)));
    this.deckTiles[i] = tile;
  }

  getOneWay(x: number, y: number): number {
    return this.inBounds(x, y) ? this.oneWay[this.idx(x, y)]! : 0;
  }

  setOneWay(x: number, y: number, edges: number): void {
    if (this.inBounds(x, y)) this.oneWay[this.idx(x, y)] = edges;
  }

  /** The levels a blocker covers, as [low, high), or null when it covers every height (or there is none). */
  getBlockBand(x: number, y: number): { low: number; high: number } | null {
    if (!this.inBounds(x, y)) return null;
    const i = this.idx(x, y);
    const high = this.blockHigh[i]!;
    return high === 0 ? null : { low: this.blockLow[i]!, high };
  }

  /** Make the blocker of this cell cover only the levels [low, high); high 0 = every height again. */
  setBlockBand(x: number, y: number, low: number, high: number): void {
    if (!this.inBounds(x, y)) return;
    const i = this.idx(x, y);
    const hi = Math.max(0, Math.min(255, Math.round(high)));
    this.blockLow[i] = hi === 0 ? 0 : Math.max(0, Math.min(hi - 1, Math.round(low)));
    this.blockHigh[i] = hi;
  }

  /**
   * Does the invisible blocker of this cell stop a body whose feet are at `z` and that is `bodyHeight` tall?
   * A blocker without levels stops everything; one with levels only stops bodies that overlap them, so a walker on
   * a bridge at level 4 passes over a blocker that covers levels 0 to 2.
   */
  blockedAt(x: number, y: number, z: number, bodyHeight: number): boolean {
    if (!this.inBounds(x, y)) return false;
    const i = this.idx(x, y);
    if (!(this.flags[i]! & FLAG.BLOCK)) return false;
    const high = this.blockHigh[i]!;
    if (high === 0) return true;
    return z < high - 1e-6 && z + bodyHeight > this.blockLow[i]! + 1e-6;
  }

  /** The level a walker's feet are at on this cell: the deck when there is one, otherwise the ground. */
  walkLevel(x: number, y: number): number {
    const deck = this.getDeck(x, y);
    return deck > 0 ? deck : this.getHeight(x, y);
  }

  /** Is this cell blocked for a walker standing on it (what paths, the walk test and the checks care about)? */
  cellBlocked(x: number, y: number, level = this.walkLevel(x, y)): boolean {
    return this.blockedAt(x, y, level, 1);
  }

  fill(tile: number, height = 0): void {
    this.tiles.fill(tile);
    this.heights.fill(height);
    this.slopes.fill(0);
    this.flags.fill(0);
    this.decks.fill(0);
    this.deckTiles.fill(0);
    this.oneWay.fill(0);
    this.blockLow.fill(0);
    this.blockHigh.fill(0);
  }

  /** Visit every non-empty cell. */
  forEach(fn: (x: number, y: number, tile: number, height: number) => void): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const t = this.tiles[this.idx(x, y)]!;
        if (t !== EMPTY_TILE) fn(x, y, t, this.heights[this.idx(x, y)]!);
      }
    }
  }

  /** Highest point of the cell's ground (top of a slope). */
  topHeight(x: number, y: number): number {
    return this.getHeight(x, y) + (this.getSlope(x, y) ? SLOPE_RISE : 0);
  }

  /** Depth-sort volume for a cell: a column from one level below the floor up to its highest point. */
  boxFor(x: number, y: number, id: number): DepthBox {
    return { id, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: -1, maxZ: this.topHeight(x, y) };
  }

  toJSON(): TileMapData {
    return {
      width: this.width,
      height: this.height,
      tiles: [...this.tiles],
      heights: [...this.heights],
      slopes: [...this.slopes],
      flags: [...this.flags],
      decks: [...this.decks],
      deckTiles: [...this.deckTiles],
      oneWay: [...this.oneWay],
      blockLow: [...this.blockLow],
      blockHigh: [...this.blockHigh],
    };
  }

  static fromJSON(d: TileMapData): TileMap {
    const m = new TileMap(d.width, d.height);
    m.tiles.set(d.tiles);
    m.heights.set(d.heights);
    if (d.slopes) m.slopes.set(d.slopes);
    if (d.flags) m.flags.set(d.flags);
    if (d.decks) m.decks.set(d.decks);
    if (d.deckTiles) m.deckTiles.set(d.deckTiles);
    if (d.oneWay) m.oneWay.set(d.oneWay);
    if (d.blockLow) m.blockLow.set(d.blockLow);
    if (d.blockHigh) m.blockHigh.set(d.blockHigh);
    return m;
  }
}

export interface TileMapData {
  width: number;
  height: number;
  tiles: number[];
  heights: number[];
  slopes?: number[];
  flags?: number[];
  decks?: number[];
  deckTiles?: number[];
  oneWay?: number[];
  blockLow?: number[];
  blockHigh?: number[];
}
