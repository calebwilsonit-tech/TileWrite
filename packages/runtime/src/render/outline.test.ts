import { describe, expect, it } from 'vitest';
import { TileMap, type TileDef } from '../tilemap/tilemap';
import { outlineEdges } from './outline';

const WOOD = 1, STONE = 2, BRICK = 3;
const tileset: Record<number, TileDef> = {
  [WOOD]: { name: 'wood', top: 0, left: 0, right: 0, outline: {} },
  [STONE]: { name: 'stone', top: 0, left: 0, right: 0, outline: {} },
  [BRICK]: { name: 'brick', top: 0, left: 0, right: 0, outline: { group: 'wall' } },
};
tileset[STONE]!.outline = { group: 'wall' };

/** A map with blocks at the given (x, y, z, tile) and nothing else. */
function map(blocks: [number, number, number, number][]): TileMap {
  const m = new TileMap(6, 6);
  for (const [x, y, z, t] of blocks) m.setBlock(x, y, z, t);
  return m;
}
const edges = (m: TileMap, x: number, y: number, z: number, t: number) => outlineEdges(m, tileset, x, y, z, t, 0);
const key = (e: [number[], number[]]) => JSON.stringify(e);

describe('outlineEdges', () => {
  it('outlines every seen edge of a block standing alone: 4 on the top and 4 on each of the two sides the camera sees', () => {
    expect(edges(map([[2, 2, 0, WOOD]]), 2, 2, 0, WOOD)).toHaveLength(12);
  });

  it('draws no line between two blocks of the same tile side by side, so the pair is outlined as one shape', () => {
    const m = map([[2, 2, 0, WOOD], [3, 2, 0, WOOD]]);
    const left = edges(m, 2, 2, 0, WOOD).map(key);
    const right = edges(m, 3, 2, 0, WOOD).map(key);
    // the shared edge of the two tops is the east side of the left block and the west side of the right one
    expect(left).not.toContain(key([[1, 0, 0], [1, 1, 0]]));
    expect(right).not.toContain(key([[0, 1, 0], [0, 0, 0]]));
  });

  it('draws the line where a block meets a different tile, and not where it meets a tile of the same group', () => {
    const different = map([[2, 2, 0, WOOD], [3, 2, 0, STONE]]);
    expect(edges(different, 2, 2, 0, WOOD).map(key)).toContain(key([[1, 0, 0], [1, 1, 0]]));
    const grouped = map([[2, 2, 0, BRICK], [3, 2, 0, STONE]]);
    expect(edges(grouped, 2, 2, 0, BRICK).map(key)).not.toContain(key([[1, 0, 0], [1, 1, 0]]));
  });

  it('a block with one on top has no top face lines, and the side faces carry on up without a line between the levels', () => {
    const m = map([[2, 2, 0, WOOD], [2, 2, 1, WOOD]]);
    const low = edges(m, 2, 2, 0, WOOD);
    expect(low.some(([a, b]) => a[2] === 0 && b[2] === 0 && a[0] !== b[0] && a[1] !== b[1])).toBe(false);
    // no horizontal line across the side at the top of the lower block
    expect(low.some(([a, b]) => a[2] === 0 && b[2] === 0)).toBe(false);
  });

  it('a step outlines its inner corner: the top of the low block meets the side of the high one', () => {
    // a low block at x 2 with a taller column beside it at x 3: the top of the low one ends against a wall of the same tile
    const m = map([[2, 2, 0, WOOD], [3, 2, 0, WOOD], [3, 2, 1, WOOD]]);
    expect(edges(m, 2, 2, 0, WOOD).map(key)).toContain(key([[1, 0, 0], [1, 1, 0]]));
  });

  it('hides the sides that face another block', () => {
    // a block with neighbours on both camera-facing sides only shows its top
    const m = map([[2, 2, 0, WOOD], [2, 3, 0, WOOD], [3, 2, 0, WOOD]]);
    const e = edges(m, 2, 2, 0, WOOD);
    expect(e.every(([a, b]) => a[2] === 0 && b[2] === 0)).toBe(true);
  });
});
