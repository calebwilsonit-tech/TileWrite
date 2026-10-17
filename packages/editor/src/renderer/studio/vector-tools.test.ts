import { describe, expect, it } from 'vitest';
import { newEllipseShape, newPathShape, newRectShape } from '@tilewright/runtime';
import { boxHandles, boxOfDrag, dragBox, handleAt, handlesOf, movePoint, snap } from './vector-tools';

describe('vector tool helpers', () => {
  it('snaps to whole or half pixels', () => {
    expect(snap(3.4)).toBe(3);
    expect(snap(3.6)).toBe(4);
    expect(snap(3.3, 0.5)).toBe(3.5);
  });

  it('has eight handles on a box, and a handle for every point of a path', () => {
    expect(boxHandles({ x: 0, y: 0, w: 10, h: 6 })).toHaveLength(8);
    const rect = newRectShape(2, 2, 6, 4, 3);
    expect(handlesOf(rect)).toHaveLength(8);
    const path = newPathShape([{ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 4, y: 4 }], 0, 1);
    const ids = handlesOf(path).map((h) => h.id);
    expect(ids.slice(0, 3)).toEqual(['p0', 'p1', 'p2']);
    expect(ids).toHaveLength(11);
  });

  it('finds the nearest handle within reach, preferring path points', () => {
    const rect = newRectShape(2, 2, 6, 4, 3);
    expect(handleAt(rect, 8.2, 6.1, 1)?.id).toBe('se');
    expect(handleAt(rect, 5, 4, 1)).toBeNull();
    const path = newPathShape([{ x: 0, y: 0 }, { x: 4, y: 4 }], 0, 1);
    expect(handleAt(path, 0.2, 0.1, 1)?.id).toBe('p0');
    expect(handleAt(newEllipseShape(5, 5, 3, 2, 1), 5, 3, 0.8)?.id).toBe('n');
  });

  it('drags corners and sides of a box, never below one pixel', () => {
    const b = { x: 2, y: 2, w: 6, h: 4 };
    expect(dragBox(b, 'se', 12, 9)).toEqual({ x: 2, y: 2, w: 10, h: 7 });
    expect(dragBox(b, 'nw', 0, 0)).toEqual({ x: 0, y: 0, w: 8, h: 6 });
    expect(dragBox(b, 'e', 10, 99)).toEqual({ x: 2, y: 2, w: 8, h: 4 });
    expect(dragBox(b, 'n', 99, 0)).toEqual({ x: 2, y: 0, w: 6, h: 6 });
    expect(dragBox(b, 'e', -5, 0).w).toBe(1);
    expect(dragBox(b, 'sw', 20, 20)).toEqual({ x: 7, y: 2, w: 1, h: 18 });
  });

  it('moves one point of a path and ignores anything else', () => {
    const path = newPathShape([{ x: 0, y: 0 }, { x: 4, y: 4 }], 0, 1);
    const moved = movePoint(path, 1, { x: 9, y: 2 });
    expect(moved.type === 'path' && moved.points[1]).toEqual({ x: 9, y: 2 });
    expect(movePoint(newRectShape(0, 0, 2, 2, 1), 0, { x: 1, y: 1 })).toEqual(newRectShape(0, 0, 2, 2, 1));
  });

  it('makes a box from a drag, or nothing when the drag has no size', () => {
    expect(boxOfDrag({ x: 5, y: 5 }, { x: 2, y: 9 })).toEqual({ x: 2, y: 5, w: 3, h: 4 });
    expect(boxOfDrag({ x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    expect(boxOfDrag({ x: 5, y: 5 }, { x: 9, y: 5 })).toEqual({ x: 5, y: 5, w: 4, h: 1 });
  });
});
