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

/** A face of a block: its top, or one of the four sides (named by where the side faces in the world). */
export type BlockFace = 'top' | 'n' | 'e' | 's' | 'w';

/** One block of a stack: a cube one level tall, with its own tile and optionally another tile on single faces. */
export interface StackBlock {
  /** The level its bottom is on. */
  z: number;
  tile: number;
  faces?: Partial<Record<BlockFace, number>>;
}

/**
 * A cell edited block by block. Normally a cell is a column (one tile, one height). A cell with a stack lists its blocks, with
 * gaps allowed (arches, tunnels, overhangs, balconies); the cell's column fields keep describing the ground-level part (the run
 * of blocks that starts at level 0, or the floor), so everything that only needs the ground keeps working.
 */
export interface CellStack {
  /** The tile of the ground at level 0 where no block stands (0 = no floor: a hole). */
  floor: number;
  /** Sorted by z, one block per level. */
  blocks: StackBlock[];
}

/** A solid run of blocks in a stack: from level `bottom` up to `top`. */
export interface BlockRun {
  bottom: number;
  top: number;
  /** Tile of the run's top block. */
  tile: number;
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
  /** Cells edited block by block (see CellStack), by cell index. */
  readonly stacks = new Map<number, CellStack>();

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
    this.stacks.delete(i);
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
    this.stacks.clear();
  }

  // ---------- blocks ----------

  getStack(x: number, y: number): CellStack | undefined {
    return this.inBounds(x, y) ? this.stacks.get(this.idx(x, y)) : undefined;
  }

  /**
   * Make the cell block-by-block (its column becomes one block per level, in the cell's tile) and return the stack.
   * Stairs, ramps and decks cannot be split into blocks: this returns null for those.
   */
  toStack(x: number, y: number): CellStack | null {
    if (!this.inBounds(x, y)) return null;
    const i = this.idx(x, y);
    const have = this.stacks.get(i);
    if (have) return have;
    if (this.slopes[i] !== 0 || this.decks[i] !== 0) return null;
    const tile = this.tiles[i]!;
    const h = this.heights[i]!;
    const blocks: StackBlock[] = [];
    for (let z = 0; z < h; z++) blocks.push({ z, tile });
    const stack: CellStack = { floor: h === 0 ? tile : 0, blocks };
    this.stacks.set(i, stack);
    return stack;
  }

  /** The block at a level of a cell (a plain column counts: one block per level up to its height). */
  blockAt(x: number, y: number, z: number): StackBlock | undefined {
    if (!this.inBounds(x, y)) return undefined;
    const i = this.idx(x, y);
    const s = this.stacks.get(i);
    if (s) return s.blocks.find((b) => b.z === z);
    if (this.slopes[i] === 0 && this.tiles[i] !== EMPTY_TILE && z >= 0 && z < this.heights[i]!) return { z, tile: this.tiles[i]! };
    return undefined;
  }

  /** Put a block at a level (replacing the one there). False when the cell cannot take blocks. */
  setBlock(x: number, y: number, z: number, tile: number, faces?: StackBlock['faces']): boolean {
    const s = this.toStack(x, y);
    if (!s || z < 0 || z > 254 || tile === EMPTY_TILE) return false;
    const block: StackBlock = faces && Object.keys(faces).length > 0 ? { z, tile, faces: { ...faces } } : { z, tile };
    const at = s.blocks.findIndex((b) => b.z === z);
    if (at >= 0) s.blocks[at] = block;
    else {
      s.blocks.push(block);
      s.blocks.sort((a, b) => a.z - b.z);
    }
    this.syncColumn(x, y);
    return true;
  }

  /** Take the block at a level away (the cell becomes block-by-block if it was a column). */
  removeBlock(x: number, y: number, z: number): boolean {
    const s = this.toStack(x, y);
    if (!s) return false;
    const at = s.blocks.findIndex((b) => b.z === z);
    if (at < 0) return false;
    s.blocks.splice(at, 1);
    if (s.floor === 0 && !s.blocks.some((b) => b.z === 0)) s.floor = this.tiles[this.idx(x, y)] || 0;
    this.syncColumn(x, y);
    return true;
  }

  /** Change the tile of one face of a block (tile 0 puts the block's own tile back). */
  setBlockFace(x: number, y: number, z: number, face: BlockFace, tile: number): boolean {
    const s = this.toStack(x, y);
    const b = s?.blocks.find((v) => v.z === z);
    if (!s || !b) return false;
    const faces = { ...(b.faces ?? {}) };
    if (tile === 0 || tile === b.tile) delete faces[face];
    else faces[face] = tile;
    if (Object.keys(faces).length > 0) b.faces = faces;
    else delete b.faces;
    return true;
  }

  /** Solid runs of blocks in a cell, from the bottom up (a plain column is one run). */
  runs(x: number, y: number): BlockRun[] {
    if (!this.inBounds(x, y)) return [];
    const i = this.idx(x, y);
    const s = this.stacks.get(i);
    if (!s) {
      const h = this.heights[i]!;
      return this.tiles[i] !== EMPTY_TILE && h > 0 && this.slopes[i] === 0 ? [{ bottom: 0, top: h, tile: this.tiles[i]! }] : [];
    }
    const out: BlockRun[] = [];
    for (const b of s.blocks) {
      const last = out[out.length - 1];
      if (last && last.top === b.z) {
        last.top = b.z + 1;
        last.tile = b.tile;
      } else out.push({ bottom: b.z, top: b.z + 1, tile: b.tile });
    }
    return out;
  }

  /** Levels a body can stand at in this cell (the floor, and the top of every run), lowest first. */
  surfaces(x: number, y: number): number[] {
    if (!this.inBounds(x, y)) return [];
    const s = this.stacks.get(this.idx(x, y));
    if (!s) return [this.walkLevel(x, y)];
    const out: number[] = [];
    const runs = this.runs(x, y);
    if (s.floor !== 0 && !(runs[0] && runs[0].bottom === 0)) out.push(0);
    for (const r of runs) out.push(r.top);
    return out;
  }

  /** Bring the column fields (tile and height) in line with the stack: the ground-level run, or the floor. */
  syncColumn(x: number, y: number): void {
    const i = this.idx(x, y);
    const s = this.stacks.get(i);
    if (!s) return;
    const run = this.runs(x, y)[0];
    if (run && run.bottom === 0) {
      this.heights[i] = Math.min(255, run.top);
      this.tiles[i] = run.tile;
    } else {
      this.heights[i] = 0;
      this.tiles[i] = s.floor;
    }
  }

  /** Every stack as plain data (what scene files store). */
  stacksToJSON(): StackData[] {
    const out: StackData[] = [];
    for (const [i, s] of [...this.stacks.entries()].sort((a, b) => a[0] - b[0])) out.push({ x: i % this.width, y: Math.floor(i / this.width), floor: s.floor, blocks: s.blocks.map((b) => (b.faces ? { z: b.z, tile: b.tile, faces: { ...b.faces } } : { z: b.z, tile: b.tile })) });
    return out;
  }

  stacksFromJSON(data: readonly StackData[]): void {
    for (const d of data) {
      if (!this.inBounds(d.x, d.y)) continue;
      const blocks = d.blocks.map((b) => (b.faces ? { z: b.z, tile: b.tile, faces: { ...b.faces } } : { z: b.z, tile: b.tile })).sort((a, b) => a.z - b.z);
      this.stacks.set(this.idx(d.x, d.y), { floor: d.floor, blocks });
      this.syncColumn(d.x, d.y);
    }
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

  /** Highest point of the cell's ground (top of a slope), or of its highest block. */
  topHeight(x: number, y: number): number {
    const s = this.getStack(x, y);
    if (s && s.blocks.length > 0) return s.blocks[s.blocks.length - 1]!.z + 1;
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
      ...(this.stacks.size > 0 ? { stacks: this.stacksToJSON() } : {}),
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
    if (d.stacks) m.stacksFromJSON(d.stacks);
    return m;
  }
}

/** One block-by-block cell as stored in files. */
export interface StackData {
  x: number;
  y: number;
  floor: number;
  blocks: { z: number; tile: number; faces?: Partial<Record<BlockFace, number>> }[];
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
  stacks?: StackData[];
}
