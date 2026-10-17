import type { TileMap } from '@tilewright/runtime';

/** Everything stored for one map cell. */
export interface CellData {
  tile: number;
  height: number;
  slope: number;
  flags: number;
  deck: number;
  deckTile: number;
  oneWay: number;
  /** Level-limited blocker: the first level it covers and the level where it stops (0 = every height). */
  blockLow: number;
  blockHigh: number;
}

export type CellPatch = Partial<CellData>;

export interface CellEdit {
  x: number;
  y: number;
  before: CellData;
  after: CellData;
}

export function readCell(map: TileMap, x: number, y: number): CellData {
  const i = y * map.width + x;
  return {
    tile: map.tiles[i]!,
    height: map.heights[i]!,
    slope: map.slopes[i]!,
    flags: map.flags[i]!,
    deck: map.decks[i]!,
    deckTile: map.deckTiles[i]!,
    oneWay: map.oneWay[i]!,
    blockLow: map.blockLow[i]!,
    blockHigh: map.blockHigh[i]!,
  };
}

export function writeCell(map: TileMap, x: number, y: number, c: CellData): void {
  const i = y * map.width + x;
  map.tiles[i] = c.tile;
  map.heights[i] = c.height;
  map.slopes[i] = c.slope;
  map.flags[i] = c.flags;
  map.decks[i] = c.deck;
  map.deckTiles[i] = c.deckTile;
  map.oneWay[i] = c.oneWay;
  map.blockLow[i] = c.blockLow;
  map.blockHigh[i] = c.blockHigh;
}

export function sameCell(a: CellData, b: CellData): boolean {
  return (
    a.tile === b.tile &&
    a.height === b.height &&
    a.slope === b.slope &&
    a.flags === b.flags &&
    a.deck === b.deck &&
    a.deckTile === b.deckTile &&
    a.oneWay === b.oneWay &&
    a.blockLow === b.blockLow &&
    a.blockHigh === b.blockHigh
  );
}

/**
 * Collects the edits of one gesture (a brush stroke, a fill, a rectangle...).
 * Each cell keeps the state it had BEFORE the first change, so undo restores exactly that.
 */
export class EditBuffer {
  private readonly byCell = new Map<number, CellEdit>();

  constructor(private readonly width: number) {}

  /** Record that (x, y) is about to become `after`; `before` is only kept the first time. */
  record(x: number, y: number, before: CellData, after: CellData): void {
    const key = y * this.width + x;
    const existing = this.byCell.get(key);
    if (existing) existing.after = after;
    else this.byCell.set(key, { x, y, before, after });
  }

  /** Edits that actually change something. */
  edits(): CellEdit[] {
    return [...this.byCell.values()].filter((e) => !sameCell(e.before, e.after));
  }

  get size(): number {
    return this.byCell.size;
  }
}
