import { describe, expect, it } from 'vitest';
import { expandBrush, formatFrameList, isoBoxPixels, parseFrameList, shadeHex, shapePixels, withSymmetry } from './paint';

const S = { w: 16, h: 16 };
const key = (p: { x: number; y: number }): string => `${p.x},${p.y}`;

describe('brush and symmetry', () => {
  it('expands a point to a square brush without duplicates', () => {
    expect(expandBrush([{ x: 5, y: 5 }], 1)).toEqual([{ x: 5, y: 5 }]);
    expect(expandBrush([{ x: 5, y: 5 }], 3)).toHaveLength(9);
    const line = expandBrush([{ x: 5, y: 5 }, { x: 6, y: 5 }], 3);
    expect(line).toHaveLength(12);
    expect(new Set(line.map(key)).size).toBe(12);
  });

  it('mirrors about the canvas centre', () => {
    expect(withSymmetry([{ x: 2, y: 3 }], S, { x: true, y: false }).map(key).sort()).toEqual(['13,3', '2,3']);
    expect(withSymmetry([{ x: 2, y: 3 }], S, { x: true, y: true })).toHaveLength(4);
    expect(withSymmetry([{ x: 7, y: 7 }, { x: 8, y: 7 }], S, { x: true, y: false })).toHaveLength(2); // already symmetric: no duplicates
  });
});

describe('shape tools', () => {
  const o = { size: 1, filled: true, sym: { x: false, y: false }, canvas: S };

  it('draws lines, filled and outlined boxes and ellipses', () => {
    expect(shapePixels('line', { x: 0, y: 0 }, { x: 5, y: 0 }, o)).toHaveLength(6);
    expect(shapePixels('rect', { x: 1, y: 1 }, { x: 4, y: 3 }, o)).toHaveLength(12);
    expect(shapePixels('rect', { x: 1, y: 1 }, { x: 4, y: 3 }, { ...o, filled: false })).toHaveLength(10);
    const fill = shapePixels('ellipse', { x: 0, y: 0 }, { x: 8, y: 6 }, o);
    const ring = shapePixels('ellipse', { x: 0, y: 0 }, { x: 8, y: 6 }, { ...o, filled: false });
    expect(ring.length).toBeLessThan(fill.length);
  });

  it('clips to the canvas and applies size and symmetry', () => {
    expect(shapePixels('line', { x: -3, y: 0 }, { x: 3, y: 0 }, o).every((p) => p.x >= 0)).toBe(true);
    expect(shapePixels('pencil', { x: 5, y: 5 }, { x: 5, y: 5 }, { ...o, size: 3 })).toHaveLength(9);
    expect(shapePixels('pencil', { x: 2, y: 2 }, { x: 2, y: 2 }, { ...o, sym: { x: true, y: true } })).toHaveLength(4);
  });
});

describe('colour and iso helpers', () => {
  it('shades colours and keeps alpha', () => {
    expect(shadeHex('#80c0ffcc', 0.5)).toBe('#406080cc');
    expect(shadeHex('#ffffffff', 2)).toBe('#ffffffff');
  });

  it('draws an iso box from three non-overlapping faces', () => {
    const b = isoBoxPixels(8, 12, 1, 1, 6, 4, { w: 32, h: 32 });
    expect(b.top.length).toBeGreaterThan(0);
    expect(b.left.length).toBeGreaterThan(0);
    expect(b.right.length).toBeGreaterThan(0);
    const all = [...b.top, ...b.left, ...b.right].map(key);
    expect(new Set(all).size).toBeGreaterThan(all.length * 0.9); // faces share at most edge pixels
  });
});

describe('frame lists', () => {
  it('parses numbers, lists and ranges (1-based) into 0-based frames', () => {
    expect(parseFrameList('1, 2, 3', 5)).toEqual([0, 1, 2]);
    expect(parseFrameList('2-4', 5)).toEqual([1, 2, 3]);
    expect(parseFrameList('4-2', 5)).toEqual([3, 2, 1]);
    expect(parseFrameList('1 3 5', 5)).toEqual([0, 2, 4]);
    expect(parseFrameList('  ', 5)).toEqual([]);
  });

  it('explains mistakes', () => {
    expect(() => parseFrameList('1, x', 5)).toThrow(/not a frame number/);
    expect(() => parseFrameList('9', 5)).toThrow(/Frame 9 does not exist; this sprite has 5 frames/);
    expect(() => parseFrameList('0', 5)).toThrow(/does not exist/);
    expect(() => parseFrameList('2', 1)).toThrow(/1 frame\./);
  });

  it('formats runs compactly and round-trips', () => {
    expect(formatFrameList([0, 1, 2, 4])).toBe('1-3, 5');
    expect(formatFrameList([0, 2])).toBe('1, 3');
    expect(formatFrameList([])).toBe('');
    for (const list of [[0, 1, 2, 3], [3, 1, 0], [0, 0, 1], [2]]) expect(parseFrameList(formatFrameList(list), 6)).toEqual(list);
  });
});
