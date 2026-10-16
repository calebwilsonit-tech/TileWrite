import { describe, expect, it } from 'vitest';
import { bakeShapes, drawShape, paletteIndexFor, PROCEDURAL_S } from './procedural';
import { bounds, celFor, isoBoxFaces, newCel, polygonPoints } from './raster';
import { newSprite, parseSprite, type ShapeData } from './format';

describe('polygon fill', () => {
  it('fills a rectangle exactly', () => {
    const pts = polygonPoints([{ x: 1, y: 1 }, { x: 5, y: 1 }, { x: 5, y: 4 }, { x: 1, y: 4 }]);
    expect(pts).toHaveLength(12);
    expect(Math.min(...pts.map((p) => p.x))).toBe(1);
    expect(Math.max(...pts.map((p) => p.x))).toBe(4);
  });

  it('fills a triangle and handles degenerate input', () => {
    const tri = polygonPoints([{ x: 0, y: 0 }, { x: 8, y: 0 }, { x: 0, y: 8 }]);
    expect(tri.length).toBeGreaterThan(20);
    expect(tri.length).toBeLessThan(40);
    expect(polygonPoints([{ x: 0, y: 0 }, { x: 5, y: 5 }])).toEqual([]);
  });

  it('does not double count pixels', () => {
    const pts = polygonPoints([{ x: 0, y: 0 }, { x: 10, y: 3 }, { x: 4, y: 9 }, { x: 0, y: 5 }]);
    expect(new Set(pts.map((p) => `${p.x},${p.y}`)).size).toBe(pts.length);
  });
});

describe('iso box', () => {
  it('has a diamond top and two sides in 2:1 projection', () => {
    const f = isoBoxFaces({ cx: 20, cy: 30, w: 1, d: 1, h: 10, s: 16 });
    // top diamond is 2*s wide and s tall, lifted by h
    const xs = f.top.map((p) => p.x);
    const ys = f.top.map((p) => p.y);
    expect(Math.max(...xs) - Math.min(...xs)).toBe(32);
    expect(Math.max(...ys) - Math.min(...ys)).toBe(16);
    expect(Math.max(...ys)).toBe(30 + 8 - 10);
    // sides drop by h
    expect(f.left[2]!.y - f.left[1]!.y).toBe(10);
    expect(f.right[2]!.y - f.right[1]!.y).toBe(10);
  });

  it('is wider for bigger footprints', () => {
    const a = isoBoxFaces({ cx: 0, cy: 0, w: 1, d: 1, h: 4, s: 8 });
    const b = isoBoxFaces({ cx: 0, cy: 0, w: 2, d: 1, h: 4, s: 8 });
    const width = (f: ReturnType<typeof isoBoxFaces>): number => Math.max(...f.top.map((p) => p.x)) - Math.min(...f.top.map((p) => p.x));
    expect(width(b)).toBeGreaterThan(width(a));
  });
});

describe('procedural shapes', () => {
  const base = (): ShapeData => ({ type: 'box', color: 0xe8553d, x: 0, y: 0, w: 0.6, d: 0.6, h: 24 });

  it('adds colours to the palette once and reuses them', () => {
    const pal = ['#00000000', '#ff0000ff'];
    expect(paletteIndexFor(pal, 0xff0000)).toBe(1);
    expect(paletteIndexFor(pal, 0x00ff00)).toBe(2);
    expect(paletteIndexFor(pal, 0x00ff00)).toBe(2);
    expect(pal).toHaveLength(3);
  });

  it('draws a three-tone box standing on the origin', () => {
    const s = newSprite('shape', 64, 96);
    s.origin = { x: 32, y: 80 };
    const cel = newCel(64, 96);
    drawShape(cel, s, base());
    const b = bounds(cel, { w: 64, h: 96 })!;
    expect(b.h).toBeGreaterThan(24); // taller than the walls alone: the top diamond adds height
    expect(b.y + b.h - 1).toBeLessThanOrEqual(80 + Math.ceil(0.6 * PROCEDURAL_S)); // base at/near the origin line
    const colours = new Set(cel.filter((v) => v !== 0));
    expect(colours.size).toBe(3); // top, left, right
  });

  it('draws every shape type without leaving the canvas', () => {
    for (const type of ['box', 'cylinder', 'ellipse', 'diamond'] as const) {
      const s = newSprite('s', 64, 96);
      s.origin = { x: 32, y: 70 };
      const cel = newCel(64, 96);
      drawShape(cel, s, { ...base(), type });
      expect(cel.some((v) => v !== 0), type).toBe(true);
    }
  });

  it('moves with x/y offsets and grows with sliders', () => {
    const s = newSprite('s', 128, 128);
    s.origin = { x: 64, y: 100 };
    const small = newCel(128, 128);
    drawShape(small, s, { ...base(), w: 0.4, d: 0.4 });
    const big = newCel(128, 128);
    drawShape(big, s, { ...base(), w: 1.2, d: 1.2 });
    expect(big.filter((v) => v !== 0).length).toBeGreaterThan(small.filter((v) => v !== 0).length);
    const moved = newCel(128, 128);
    drawShape(moved, s, { ...base(), x: 20 });
    expect(bounds(moved, { w: 128, h: 128 })!.x).toBeGreaterThan(bounds(small, { w: 128, h: 128 })!.x - 1);
  });

  it('bakes shapes into a valid sprite without changing the original', () => {
    const s = newSprite('hero', 64, 96);
    s.origin = { x: 32, y: 80 };
    s.procedural = { shapes: [base(), { ...base(), type: 'ellipse', y: -30, w: 0.5, d: 0.5, h: 12, color: 0xf4a259 }] };
    const baked = bakeShapes(s);
    expect(s.frames[0]!.cels.l1).toBeUndefined();
    expect(celFor(baked, 0, 'l1').some((v) => v !== 0)).toBe(true);
    expect(baked.palette.length).toBeGreaterThan(s.palette.length);
    expect(parseSprite(JSON.parse(JSON.stringify(baked))).ok).toBe(true);
    expect(bakeShapes(newSprite('plain'))).toEqual(newSprite('plain'));
  });
});
