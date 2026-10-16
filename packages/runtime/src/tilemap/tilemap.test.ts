import { describe, expect, it } from 'vitest';
import { TileMap } from './tilemap';

describe('TileMap', () => {
  it('stores tiles and heights and ignores out-of-range writes', () => {
    const m = new TileMap(4, 3);
    m.set(1, 2, 5, 3);
    m.set(99, 99, 1, 1);
    expect(m.getTile(1, 2)).toBe(5);
    expect(m.getHeight(1, 2)).toBe(3);
    expect(m.getTile(-1, 0)).toBe(0);
    expect(m.getHeight(10, 10)).toBe(0);
  });

  it('visits only non-empty cells', () => {
    const m = new TileMap(3, 3);
    m.set(0, 0, 1);
    m.set(2, 1, 2, 1);
    const seen: string[] = [];
    m.forEach((x, y, t, h) => seen.push(`${x},${y},${t},${h}`));
    expect(seen).toEqual(['0,0,1,0', '2,1,2,1']);
  });

  it('round-trips through JSON', () => {
    const m = new TileMap(5, 5);
    m.fill(1);
    m.set(2, 2, 2, 4);
    const back = TileMap.fromJSON(JSON.parse(JSON.stringify(m)));
    expect(back.getTile(2, 2)).toBe(2);
    expect(back.getHeight(2, 2)).toBe(4);
    expect(back.getTile(0, 0)).toBe(1);
  });

  it('builds a depth box that rises to the cell height', () => {
    const m = new TileMap(2, 2);
    m.set(1, 0, 1, 3);
    expect(m.boxFor(1, 0, 7)).toEqual({ id: 7, minX: 1, maxX: 2, minY: 0, maxY: 1, minZ: -1, maxZ: 3 });
  });
});
