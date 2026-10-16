import { describe, expect, it } from 'vitest';
import { EDGE, FLAG, SLOPE, TileMap } from '../tilemap/tilemap';
import { findPath, straightWalkable } from './pathfinding';

function field(w = 12, h = 12): TileMap {
  const m = new TileMap(w, h);
  m.fill(1, 0);
  return m;
}

const cells = (p: { x: number; y: number }[] | null): string[] => (p ?? []).map((c) => `${Math.floor(c.x)},${Math.floor(c.y)}`);

describe('findPath', () => {
  it('walks straight across an open field, excluding the start and including the goal', () => {
    const p = findPath(field(), { x: 1.5, y: 1.5 }, { x: 5.5, y: 1.5 });
    expect(cells(p)).toEqual(['2,1', '3,1', '4,1', '5,1']);
  });

  it('is the goal itself when already there', () => {
    expect(cells(findPath(field(), { x: 2.5, y: 2.5 }, { x: 2.9, y: 2.1 }))).toEqual(['2,2']);
  });

  it('goes around walls', () => {
    const m = field();
    for (let y = 0; y < 9; y++) m.setFlag(5, y, FLAG.BLOCK);
    const p = findPath(m, { x: 2.5, y: 2.5 }, { x: 8.5, y: 2.5 })!;
    expect(p).not.toBeNull();
    expect(cells(p)).not.toContain('5,2');
    expect(p.every((c) => !m.hasFlag(Math.floor(c.x), Math.floor(c.y), FLAG.BLOCK))).toBe(true);
    expect(p.length).toBeGreaterThan(6);
  });

  it('returns null when the goal is walled off, a pit, or off the map', () => {
    const m = field();
    for (let y = 0; y < 12; y++) m.setFlag(5, y, FLAG.BLOCK);
    expect(findPath(m, { x: 2.5, y: 2.5 }, { x: 8.5, y: 2.5 })).toBeNull();
    const n = field();
    n.setFlag(6, 6, FLAG.PIT);
    expect(findPath(n, { x: 2.5, y: 2.5 }, { x: 6.5, y: 6.5 })).toBeNull();
    expect(findPath(n, { x: 2.5, y: 2.5 }, { x: 40, y: 2 })).toBeNull();
  });

  it('avoids pits and water but crosses them on a bridge', () => {
    const m = field();
    for (let y = 0; y < 12; y++) m.setFlag(5, y, FLAG.PIT);
    expect(findPath(m, { x: 2.5, y: 5.5 }, { x: 8.5, y: 5.5 })).toBeNull();
    m.setFlag(5, 5, FLAG.PIT);
    m.setDeck(5, 5, 1);
    // the bridge deck sits one level up, so the approach must be a climbable ramp at both ends
    expect(findPath(m, { x: 2.5, y: 5.5 }, { x: 8.5, y: 5.5 }, { stepUp: 1.1, maxDrop: 1.1 })).not.toBeNull();
  });

  it('climbs stairs but not cliffs, and walks down only so far', () => {
    const m = field(10, 4);
    m.set(5, 1, 1, 1);
    expect(findPath(m, { x: 1.5, y: 1.5 }, { x: 8.5, y: 1.5 }, { stepUp: 0.35 })).not.toBeNull(); // goes around the 1-high block
    const wall = field(10, 4);
    for (let y = 0; y < 4; y++) wall.set(5, y, 1, 2); // full-width 2-high ridge
    expect(findPath(wall, { x: 1.5, y: 1.5 }, { x: 8.5, y: 1.5 })).toBeNull();
    const stairs = field(10, 4);
    for (let y = 0; y < 4; y++) {
      stairs.set(5, y, 1, 0);
      stairs.setSlope(5, y, SLOPE.E);
      for (let x = 6; x < 10; x++) stairs.set(x, y, 1, 1);
    }
    expect(findPath(stairs, { x: 1.5, y: 1.5 }, { x: 8.5, y: 1.5 })).not.toBeNull();
    // a drop of 1 is too far for the default walker going the other way, unless it is allowed
    expect(findPath(stairs, { x: 8.5, y: 1.5 }, { x: 1.5, y: 1.5 })).not.toBeNull(); // down the stairs is fine
    const ledge = field(10, 4);
    for (let y = 0; y < 4; y++) for (let x = 6; x < 10; x++) ledge.set(x, y, 1, 1);
    expect(findPath(ledge, { x: 8.5, y: 1.5 }, { x: 1.5, y: 1.5 })).toBeNull();
    expect(findPath(ledge, { x: 8.5, y: 1.5 }, { x: 1.5, y: 1.5 }, { maxDrop: 1.1 })).not.toBeNull();
  });

  it('honours one-way edges', () => {
    const m = field(8, 3);
    for (let y = 0; y < 3; y++) m.setOneWay(4, y, EDGE.W); // cannot be entered from the west
    expect(findPath(m, { x: 1.5, y: 1.5 }, { x: 6.5, y: 1.5 })).toBeNull();
    expect(findPath(m, { x: 6.5, y: 1.5 }, { x: 1.5, y: 1.5 })).not.toBeNull();
  });

  it('avoids extra blocked cells (other objects) but still reaches a goal cell that is occupied', () => {
    const m = field();
    const blocked = (x: number, y: number): boolean => x === 3 && y === 1;
    const p = findPath(m, { x: 1.5, y: 1.5 }, { x: 5.5, y: 1.5 }, { blocked })!;
    expect(cells(p)).not.toContain('3,1');
    expect(cells(findPath(m, { x: 1.5, y: 1.5 }, { x: 3.5, y: 1.5 }, { blocked }))).toContain('3,1');
  });

  it('diagonal paths are shorter and never cut corners', () => {
    const m = field();
    const straight = findPath(m, { x: 1.5, y: 1.5 }, { x: 6.5, y: 6.5 })!;
    const diag = findPath(m, { x: 1.5, y: 1.5 }, { x: 6.5, y: 6.5 }, { diagonal: true })!;
    expect(diag.length).toBeLessThan(straight.length);
    const walls = field();
    walls.setFlag(2, 1, FLAG.BLOCK);
    walls.setFlag(1, 2, FLAG.BLOCK);
    const p = findPath(walls, { x: 1.5, y: 1.5 }, { x: 3.5, y: 3.5 }, { diagonal: true });
    expect(cells(p)[0]).not.toBe('2,2'); // it walks around the two walls instead of squeezing between their corners
    expect(p!.length).toBeGreaterThan(2);
  });

  it('is deterministic and gives up on huge searches', () => {
    const m = field(60, 60);
    const a = findPath(m, { x: 1.5, y: 1.5 }, { x: 55.5, y: 55.5 }, { maxNodes: 100000 });
    const b = findPath(m, { x: 1.5, y: 1.5 }, { x: 55.5, y: 55.5 }, { maxNodes: 100000 });
    expect(a).toEqual(b);
    expect(findPath(m, { x: 1.5, y: 1.5 }, { x: 55.5, y: 55.5 }, { maxNodes: 50 })).toBeNull();
  });
});

describe('straightWalkable', () => {
  it('is true across open ground and false through a wall or a pit', () => {
    const m = field();
    expect(straightWalkable(m, { x: 1.5, y: 1.5 }, { x: 8.5, y: 6.5 })).toBe(true);
    m.setFlag(4, 3, FLAG.BLOCK);
    expect(straightWalkable(m, { x: 1.5, y: 3.5 }, { x: 8.5, y: 3.5 })).toBe(false);
    const n = field();
    n.setFlag(4, 3, FLAG.PIT);
    expect(straightWalkable(n, { x: 1.5, y: 3.5 }, { x: 8.5, y: 3.5 })).toBe(false);
  });
});
