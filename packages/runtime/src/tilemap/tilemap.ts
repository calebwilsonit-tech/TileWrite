import type { DepthBox } from '../render/depth';

/** Tile id 0 means "no tile". */
export const EMPTY_TILE = 0;

export interface TileDef {
  name: string;
  /** Procedural colours until the sprite studio provides art (0xRRGGBB). */
  top: number;
  left: number;
  right: number;
}

export type TileSet = Record<number, TileDef>;

export const DEFAULT_TILESET: TileSet = {
  1: { name: 'grass', top: 0x6fae5b, left: 0x4f8a43, right: 0x3f7236 },
  2: { name: 'stone', top: 0xa3a7b3, left: 0x80848f, right: 0x666a75 },
  3: { name: 'sand', top: 0xe3d08e, left: 0xc4b374, right: 0xa8985f },
  4: { name: 'water', top: 0x4a90d9, left: 0x3a76b4, right: 0x2f6091 },
  5: { name: 'brick', top: 0xb5654a, left: 0x934f39, right: 0x78402e },
};

/**
 * Dense grid of columns. Each cell has a tile id and a height (levels). A column fills from below
 * the floor up to `height`, so sorting and (from M2) collision treat it as solid ground at that level.
 */
export class TileMap {
  readonly tiles: Uint16Array;
  readonly heights: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.tiles = new Uint16Array(width * height);
    this.heights = new Uint8Array(width * height);
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

  /** Ground height (levels) of the cell; 0 outside the map. */
  getHeight(x: number, y: number): number {
    return this.inBounds(x, y) ? this.heights[this.idx(x, y)]! : 0;
  }

  set(x: number, y: number, tile: number, height = 0): void {
    if (!this.inBounds(x, y)) return;
    this.tiles[this.idx(x, y)] = tile;
    this.heights[this.idx(x, y)] = Math.max(0, Math.min(255, Math.round(height)));
  }

  fill(tile: number, height = 0): void {
    this.tiles.fill(tile);
    this.heights.fill(height);
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

  /** Depth-sort volume for a cell: a column from one level below the floor up to its height. */
  boxFor(x: number, y: number, id: number): DepthBox {
    return { id, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: -1, maxZ: this.getHeight(x, y) };
  }

  toJSON(): { width: number; height: number; tiles: number[]; heights: number[] } {
    return { width: this.width, height: this.height, tiles: [...this.tiles], heights: [...this.heights] };
  }

  static fromJSON(d: { width: number; height: number; tiles: number[]; heights: number[] }): TileMap {
    const m = new TileMap(d.width, d.height);
    m.tiles.set(d.tiles);
    m.heights.set(d.heights);
    return m;
  }
}
