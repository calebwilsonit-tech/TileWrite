import { describe, expect, it } from 'vitest';
import { newSprite, parseSprite, stringifySprite } from './format';
import {
  VectorShapeSchema,
  flipShape,
  hitShape,
  moveShape,
  newEllipseShape,
  newPathShape,
  newRectShape,
  outlineOf,
  pickShape,
  rasterizeShapes,
  resizeShape,
  shapeBounds,
  shapeProblems,
} from './vector';

const count = (cel: Uint8Array, v?: number): number => cel.reduce((n, p) => n + (v === undefined ? (p !== 0 ? 1 : 0) : p === v ? 1 : 0), 0);
const at = (cel: Uint8Array, w: number, x: number, y: number): number => cel[y * w + x]!;

describe('drawing shapes into pixels', () => {
  it('fills a rectangle exactly where it lies', () => {
    const cel = rasterizeShapes([newRectShape(2, 3, 4, 2, 5)], 12, 12);
    expect(count(cel)).toBe(8);
    expect(at(cel, 12, 2, 3)).toBe(5);
    expect(at(cel, 12, 5, 4)).toBe(5);
    expect(at(cel, 12, 6, 4)).toBe(0);
    expect(at(cel, 12, 1, 3)).toBe(0);
  });

  it('draws an outline of the chosen thickness in its own colour on top of the fill', () => {
    const cel = rasterizeShapes([newRectShape(1, 1, 8, 8, 5, 7)], 12, 12);
    expect(at(cel, 12, 5, 5)).toBe(5); // the inside keeps the fill
    expect(at(cel, 12, 1, 5)).toBe(7); // the left edge is the outline
    expect(at(cel, 12, 8, 5)).toBe(7);
    const thick = rasterizeShapes([{ ...newRectShape(1, 1, 8, 8, 0, 7), strokeWidth: 3 } as never], 12, 12);
    expect(count(thick, 7)).toBeGreaterThan(count(rasterizeShapes([newRectShape(1, 1, 8, 8, 0, 7)], 12, 12), 7));
  });

  it('draws ellipses round: a circle covers about pi r squared pixels and leaves the corners empty', () => {
    const cel = rasterizeShapes([newEllipseShape(10, 10, 6, 6, 3)], 20, 20);
    expect(count(cel)).toBeGreaterThan(Math.PI * 36 * 0.93);
    expect(count(cel)).toBeLessThan(Math.PI * 36 * 1.07);
    expect(at(cel, 20, 10, 10)).toBe(3);
    expect(at(cel, 20, 4, 4)).toBe(0);
  });

  it('draws paths: an open line, a filled triangle and a smooth curve', () => {
    const line = rasterizeShapes([newPathShape([{ x: 1, y: 1 }, { x: 10, y: 1 }], 0, 4)], 12, 4);
    for (let x = 1; x < 10; x++) expect(at(line, 12, x, 1)).toBe(4);
    const tri = rasterizeShapes([newPathShape([{ x: 2, y: 2 }, { x: 14, y: 2 }, { x: 8, y: 12 }], 6, 0, true)], 16, 16);
    expect(at(tri, 16, 8, 5)).toBe(6);
    expect(at(tri, 16, 2, 10)).toBe(0);
    const curve = newPathShape([{ x: 1, y: 8 }, { x: 8, y: 1 }, { x: 15, y: 8 }], 0, 2, false, true);
    expect(outlineOf(curve).points.length).toBeGreaterThan(8); // curves are made of many short pieces
    expect(count(rasterizeShapes([curve], 16, 10))).toBeGreaterThan(12);
  });

  it('later shapes cover earlier ones, rounded corners cut the corner pixels, rotation turns the shape', () => {
    const cel = rasterizeShapes([newRectShape(0, 0, 8, 8, 3), newRectShape(2, 2, 4, 4, 9)], 8, 8);
    expect(at(cel, 8, 3, 3)).toBe(9);
    expect(at(cel, 8, 0, 0)).toBe(3);
    const rounded = rasterizeShapes([{ ...(newRectShape(0, 0, 10, 10, 3) as object), radius: 4 } as never], 10, 10);
    expect(at(rounded, 10, 0, 0)).toBe(0);
    expect(at(rounded, 10, 5, 0)).toBe(3);
    const wide = newRectShape(2, 8, 12, 2, 5);
    const turned = { ...(wide as object), rotation: 90 } as never;
    const cel2 = rasterizeShapes([turned], 16, 16);
    expect(at(cel2, 16, 8, 3)).toBe(5); // now standing up
    expect(at(cel2, 16, 3, 9)).toBe(0);
  });

  it('keeps everything inside the canvas when a shape sticks out', () => {
    const cel = rasterizeShapes([newRectShape(-5, -5, 30, 30, 2), newEllipseShape(0, 0, 40, 40, 3, 4)], 8, 8);
    expect(cel).toHaveLength(64);
    expect(count(cel)).toBe(64);
  });
});

describe('editing shapes', () => {
  const rect = newRectShape(2, 2, 6, 4, 5);

  it('finds the shape under a point, the topmost first, and thin outlines can still be clicked', () => {
    const a = newRectShape(0, 0, 10, 10, 3);
    const b = newEllipseShape(5, 5, 2, 2, 4);
    expect(pickShape([a, b], 5, 5)).toBe(1);
    expect(pickShape([a, b], 1, 1)).toBe(0);
    expect(pickShape([a, b], 20, 20)).toBe(-1);
    const line = newPathShape([{ x: 0, y: 0 }, { x: 10, y: 0 }], 0, 1);
    expect(hitShape(line, 5, 0.6)).toBe(true);
    expect(hitShape(line, 5, 3)).toBe(false);
    const hollow = newRectShape(0, 0, 10, 10, 0, 1);
    expect(hitShape(hollow, 5, 5)).toBe(false); // an outline only: the middle is not the shape
  });

  it('measures, moves, resizes and mirrors shapes', () => {
    expect(shapeBounds(rect)).toEqual({ x: 2, y: 2, w: 6, h: 4 });
    expect(shapeBounds(newRectShape(2, 2, 6, 4, 5, 1))).toEqual({ x: 1.5, y: 1.5, w: 7, h: 5 });
    expect(moveShape(rect, 3, -1)).toMatchObject({ x: 5, y: 1 });
    const stretched = resizeShape(rect, { x: 2, y: 2, w: 6, h: 4 }, { x: 0, y: 0, w: 12, h: 4 });
    expect(stretched).toMatchObject({ x: 0, y: 0, w: 12, h: 4 });
    const path = resizeShape(newPathShape([{ x: 0, y: 0 }, { x: 4, y: 4 }], 0, 1), { x: 0, y: 0, w: 4, h: 4 }, { x: 10, y: 10, w: 8, h: 8 });
    expect(path.type === 'path' && path.points).toEqual([{ x: 10, y: 10 }, { x: 18, y: 18 }]);
    expect(flipShape(rect, 'h', 16)).toMatchObject({ x: 8, y: 2 });
    const e = flipShape(newEllipseShape(3, 4, 2, 2, 1), 'v', 20);
    expect(e).toMatchObject({ cx: 3, cy: 16 });
  });
});

describe('vector layers in the sprite file', () => {
  it('are saved with their shapes and read back, and older files with no vectors still load', () => {
    const s = newSprite('Hero', 16, 16);
    s.layers.push({ id: 'v1', name: 'Shapes', visible: true, kind: 'vector' });
    const shapes = [newRectShape(1, 1, 5, 5, 3), newPathShape([{ x: 2, y: 2 }, { x: 9, y: 9 }], 0, 4, false, true)];
    s.frames[0]!.vectors = { v1: shapes };
    const back = parseSprite(JSON.parse(stringifySprite(s)));
    expect(back.ok).toBe(true);
    if (back.ok) {
      expect(back.value.layers[1]!.kind).toBe('vector');
      expect(back.value.frames[0]!.vectors!.v1).toEqual(shapes);
    }
    expect(parseSprite(JSON.parse(stringifySprite(newSprite('Old')))).ok).toBe(true);
  });

  it('refuse shapes on a layer that is not a vector layer, and invalid shapes', () => {
    const s = newSprite('Bad', 8, 8);
    s.frames[0]!.vectors = { l1: [newRectShape(0, 0, 2, 2, 1)] };
    const r = parseSprite(JSON.parse(JSON.stringify(s)));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/not a vector layer/);
    expect(VectorShapeSchema.safeParse({ type: 'path', points: [{ x: 0, y: 0 }] }).success).toBe(false);
    expect(VectorShapeSchema.safeParse({ type: 'star' }).success).toBe(false);
  });

  it('reports plain-English problems', () => {
    expect(shapeProblems([newRectShape(0, 0, 2, 2, 40)], 16)[0]).toMatch(/not in the palette/);
    expect(shapeProblems([newRectShape(0, 0, 2, 2, 3)], 16)).toEqual([]);
  });
});
