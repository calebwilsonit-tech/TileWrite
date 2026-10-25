import { describe, expect, it } from 'vitest';
import { FLAG, TileMap } from '@tilewright/runtime';
import { ambientDarkness, isLit, lightLevel, lineClear, makeOccluder, visibilityPolygon, type LightingModel, type LightSource } from './model';

function room(): TileMap {
  const m = new TileMap(12, 12);
  m.fill(1, 0);
  return m;
}

const lamp = (x: number, y: number, radius = 4): LightSource => ({ x, y, h: 0, radius, color: 0xffd9a0, intensity: 1, shadows: true });

function model(map: TileMap, lights: LightSource[], dark = 1): LightingModel {
  return { regions: [{ x: 0, y: 0, w: 12, h: 12, darkness: dark }], sceneDarkness: 0, lights, blocked: makeOccluder(map, []) };
}

describe('lighting', () => {
  it('is fully lit where there is no darkness', () => {
    const m = model(room(), [], 0);
    expect(lightLevel(m, 5, 5)).toBe(1);
    expect(isLit(undefined, 5, 5)).toBe(true);
  });

  it('is dark in a dark region, bright near a lamp, fading to the radius', () => {
    const m = model(room(), [lamp(6, 6)]);
    expect(lightLevel(m, 1.5, 1.5)).toBeCloseTo(0, 5);
    const near = lightLevel(m, 6.5, 6.5);
    const mid = lightLevel(m, 8.5, 6.5);
    const far = lightLevel(m, 9.9, 6.5);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
    expect(isLit(m, 6.5, 6.5)).toBe(true);
    expect(isLit(m, 11, 11)).toBe(false);
  });

  it('uses the darkest region at a point and the scene darkness as a floor', () => {
    const m: LightingModel = { regions: [{ x: 0, y: 0, w: 4, h: 4, darkness: 0.8 }], sceneDarkness: 0.2, lights: [], blocked: () => false };
    expect(ambientDarkness(m, 1, 1)).toBe(0.8);
    expect(ambientDarkness(m, 8, 8)).toBe(0.2);
  });

  it('walls cast shadows', () => {
    const map = room();
    map.setFlag(7, 6, FLAG.BLOCK);
    const m = model(map, [lamp(5.5, 6.5, 6)]);
    expect(lineClear(m, 5.5, 6.5, 6.5, 6.5, 0)).toBe(true);
    expect(lineClear(m, 5.5, 6.5, 9.5, 6.5, 0)).toBe(false);
    expect(isLit(m, 6.5, 6.5)).toBe(true);
    expect(isLit(m, 9.5, 6.5)).toBe(false); // behind the wall
    expect(isLit(m, 9.5, 3.5, 0, 0.2)).toBe(true); // off to the side is not shadowed
  });

  it('a lamp that does not cast shadows lights through walls', () => {
    const map = room();
    map.setFlag(7, 6, FLAG.BLOCK);
    const l = { ...lamp(5.5, 6.5, 6), shadows: false };
    expect(isLit(model(map, [l]), 8.5, 6.5, 0, 0.3)).toBe(true);
  });

  it('tall solid objects block light too, low ones do not', () => {
    const map = room();
    const blocked = makeOccluder(map, [
      { x: 7.5, y: 6.5, w: 1, d: 1, top: 2 },
      { x: 3.5, y: 6.5, w: 1, d: 1, top: 0.4 },
    ]);
    expect(blocked(7, 6, 0)).toBe(true);
    expect(blocked(3, 6, 0)).toBe(false);
  });

  it('the visibility polygon stops at walls and reaches the radius in the open', () => {
    const map = room();
    map.setFlag(8, 6, FLAG.BLOCK);
    const m = model(map, []);
    const l = lamp(5.5, 6.5, 5);
    const poly = visibilityPolygon(m, l, 5, 72);
    expect(poly).toHaveLength(72);
    const east = poly[0]!; // angle 0 points at +x, into the wall at x = 8
    expect(east.x).toBeLessThan(8.6);
    const west = poly[36]!;
    expect(Math.hypot(west.x - l.x, west.y - l.y)).toBeCloseTo(5, 1);
  });

  it('walls tall enough to rise above the light block it; heights below do not', () => {
    const map = room();
    map.set(7, 6, 1, 3);
    expect(makeOccluder(map, [])(7, 6, 0)).toBe(true);
    expect(makeOccluder(map, [])(7, 6, 3)).toBe(false);
  });
});
