import { describe, expect, it } from 'vitest';
import { DEFAULT_ISO, SolidField, TileMap, type Aabb } from '@tilewright/runtime';
import { sweptBlocks } from './debug-draw';

const body: Aabb = { x0: 5.2, x1: 5.8, y0: 5.2, y1: 5.8, z0: 0, z1: 1.2 };

describe('the line of sight, as the blocks it runs into', () => {
  it('finds the blocks between the camera and the body, and none that are off to the side or behind', () => {
    const m = new TileMap(16, 16);
    m.fill(1, 0);
    for (let z = 0; z < 3; z++) m.setBlock(7, 7, z, 2); // toward the camera (higher x and y, and up)
    for (let z = 0; z < 3; z++) m.setBlock(2, 2, z, 2); // behind the body
    for (let z = 0; z < 3; z++) m.setBlock(11, 2, z, 2); // off to one side of the line
    const hits = sweptBlocks(new SolidField(m), body, DEFAULT_ISO, m);
    const cells = new Set(hits.map((h) => `${Math.floor(h.x0)},${Math.floor(h.y0)}`));
    expect(cells.has('7,7')).toBe(true);
    expect(cells.has('2,2')).toBe(false);
    expect(cells.has('11,2')).toBe(false);
  });

  it('finds nothing in an open field', () => {
    const m = new TileMap(16, 16);
    m.fill(1, 0);
    expect(sweptBlocks(new SolidField(m), body, DEFAULT_ISO, m)).toEqual([]);
  });
});
