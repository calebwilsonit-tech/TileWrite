import { describe, expect, it } from 'vitest';
import { boxAt, sortBoxes, type DepthBox } from './depth';

const cell = (id: number, x: number, y: number, h = 0): DepthBox => ({ id, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: -1, maxZ: h });
const before = (order: number[], a: number, b: number): boolean => order.indexOf(a) < order.indexOf(b);

describe('sortBoxes', () => {
  it('draws floor tiles back to front', () => {
    const tiles = [cell(1, 2, 2), cell(2, 0, 0), cell(3, 1, 0), cell(4, 0, 1), cell(5, 1, 1)];
    const order = sortBoxes(tiles);
    expect(order[0]).toBe(2);
    expect(before(order, 3, 5)).toBe(true);
    expect(before(order, 4, 5)).toBe(true);
    expect(before(order, 5, 1)).toBe(true);
  });

  it('puts an entity in front of a tall block when it stands nearer the camera', () => {
    const block = cell(1, 5, 5, 3);
    const front = boxAt(2, 6.5, 5.5, 0, 0.6, 0.6, 1);
    const behind = boxAt(3, 4.5, 5.5, 0, 0.6, 0.6, 1);
    const order = sortBoxes([front, behind, block]);
    expect(before(order, 1, 2)).toBe(true);
    expect(before(order, 3, 1)).toBe(true);
  });

  it('puts an entity standing on top of a block after the block', () => {
    const block = cell(1, 5, 5, 2);
    const onTop = boxAt(2, 5.5, 5.5, 2, 0.6, 0.6, 1);
    expect(before(sortBoxes([onTop, block]), 1, 2)).toBe(true);
    expect(before(sortBoxes([block, onTop]), 1, 2)).toBe(true);
  });

  it('orders an entity correctly against a wide multi-cell wall', () => {
    // wall spans x 4..8 along one row (y 5..6), 3 levels high
    const wall: DepthBox = { id: 1, minX: 4, maxX: 8, minY: 5, maxY: 6, minZ: 0, maxZ: 3 };
    const inFront = boxAt(2, 6, 7, 0, 0.6, 0.6, 1); // nearer the camera than the whole wall
    const behindIt = boxAt(3, 6, 3.5, 0, 0.6, 0.6, 1); // hidden behind the wall
    const order = sortBoxes([inFront, behindIt, wall]);
    expect(before(order, 1, 2)).toBe(true);
    expect(before(order, 3, 1)).toBe(true);
  });

  it('is correct where a single scalar key fails: entity beside the end of a long wall', () => {
    // Long wall along x. Entity stands at x=9.5 (past its end) but its x+y (15) is smaller
    // than the wall centre's x+y (6+5.5=11.5)? Here we pick values so a centre-key sort is wrong.
    const wall: DepthBox = { id: 1, minX: 0, maxX: 10, minY: 5, maxY: 6, minZ: 0, maxZ: 3 };
    const entity = boxAt(2, 2, 7, 0, 0.6, 0.6, 1); // in front of the wall (larger y), key 9+... smaller than wall centre key
    const order = sortBoxes([wall, entity]);
    expect(before(order, 1, 2)).toBe(true);
    const behindEntity = boxAt(3, 7.5, 3.5, 0, 0.6, 0.6, 1); // behind the wall (smaller y) with larger key than wall centre
    const order2 = sortBoxes([wall, behindEntity]);
    expect(before(order2, 3, 1)).toBe(true);
  });

  it('uses sortOffset only to break ties between unrelated items', () => {
    const a = boxAt(1, 0.5, 0.5, 0, 0.4, 0.4, 1);
    const b = boxAt(2, 10.5, 0.5, 0, 0.4, 0.4, 1, -50); // far apart, no screen overlap
    expect(sortBoxes([a, b])).toEqual([2, 1]);
  });

  it('gives the same result regardless of input order', () => {
    const items: DepthBox[] = [];
    for (let i = 0; i < 40; i++) items.push(cell(i, i % 8, Math.floor(i / 8), (i * 7) % 4));
    items.push(boxAt(100, 3.5, 2.5, 1, 0.6, 0.6, 1));
    const a = sortBoxes(items);
    const b = sortBoxes([...items].reverse());
    expect(b).toEqual(a);
  });

  it('survives interpenetrating boxes (cycles) without throwing or dropping items', () => {
    const a: DepthBox = { id: 1, minX: 0, maxX: 2, minY: 0, maxY: 2, minZ: 0, maxZ: 2 };
    const b: DepthBox = { id: 2, minX: 1, maxX: 3, minY: 1, maxY: 3, minZ: 0, maxZ: 2 };
    const c: DepthBox = { id: 3, minX: 0.5, maxX: 2.5, minY: 0.5, maxY: 2.5, minZ: 0, maxZ: 2 };
    const order = sortBoxes([a, b, c]);
    expect(order.sort()).toEqual([1, 2, 3]);
  });

  it('handles empty input and a single item', () => {
    expect(sortBoxes([])).toEqual([]);
    expect(sortBoxes([cell(7, 0, 0)])).toEqual([7]);
  });

  it('sorts 5,000 tiles and 200 entities quickly and correctly', () => {
    const items: DepthBox[] = [];
    let id = 0;
    for (let y = 0; y < 50; y++) for (let x = 0; x < 100; x++) items.push(cell(id++, x, y, (x + y) % 3));
    for (let i = 0; i < 200; i++) items.push(boxAt(100000 + i, (i * 13) % 100 + 0.5, (i * 7) % 50 + 0.5, 3, 0.6, 0.6, 1));
    const t0 = performance.now();
    const order = sortBoxes(items);
    const ms = performance.now() - t0;
    expect(order).toHaveLength(items.length);
    expect(new Set(order).size).toBe(items.length);
    // spot check: a cell is drawn before the cell diagonally in front of it
    expect(before(order, 0, 101)).toBe(true);
    expect(ms).toBeLessThan(1500); // loose guard; the real budget test arrives in M14
  });
});
