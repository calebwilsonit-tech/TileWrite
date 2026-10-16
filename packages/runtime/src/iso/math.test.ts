import { describe, expect, it } from 'vitest';
import {
  DEFAULT_ISO,
  cellOf,
  facingOfGridDir,
  facingOfScreenDir,
  gridToScreen,
  lineCells,
  lineOfSight,
  neighbours,
  screenIntentToGrid,
  screenToCell,
  screenToGrid,
} from './math';

describe('iso projection', () => {
  it('maps the origin to the origin', () => {
    expect(gridToScreen(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('puts +x down-right and +y down-left with 2:1 tiles', () => {
    expect(gridToScreen(1, 0)).toEqual({ x: 32, y: 16 });
    expect(gridToScreen(0, 1)).toEqual({ x: -32, y: 16 });
    expect(gridToScreen(1, 1)).toEqual({ x: 0, y: 32 });
  });

  it('raises things by heightPx per level', () => {
    expect(gridToScreen(0, 0, 2).y).toBe(-2 * DEFAULT_ISO.heightPx);
  });

  it('round-trips grid -> screen -> grid at several heights', () => {
    for (const h of [0, 1, 3.5]) {
      for (const [x, y] of [[0, 0], [3.25, 7.5], [-4, 2.125], [100, -50]] as const) {
        const s = gridToScreen(x, y, h);
        const g = screenToGrid(s.x, s.y, h);
        expect(g.x).toBeCloseTo(x, 9);
        expect(g.y).toBeCloseTo(y, 9);
      }
    }
  });

  it('honours custom tile sizes', () => {
    const cfg = { tileW: 128, tileH: 64, heightPx: 32 };
    expect(gridToScreen(1, 0, 0, cfg)).toEqual({ x: 64, y: 32 });
    const s = gridToScreen(2.5, 1.5, 1, cfg);
    const g = screenToGrid(s.x, s.y, 1, cfg);
    expect(g.x).toBeCloseTo(2.5);
    expect(g.y).toBeCloseTo(1.5);
  });
});

describe('cell queries', () => {
  it('floors to cells, including negatives', () => {
    expect(cellOf(2.9, 0.1)).toEqual({ x: 2, y: 0 });
    expect(cellOf(-0.1, -1)).toEqual({ x: -1, y: -1 });
  });

  it('finds the cell under a screen point, depending on height', () => {
    const s = gridToScreen(4.5, 6.5, 0);
    expect(screenToCell(s.x, s.y, 0)).toEqual({ x: 4, y: 6 });
    // the same screen point seen on a plane 2 levels up is a different cell
    expect(screenToCell(s.x, s.y, 2)).not.toEqual({ x: 4, y: 6 });
  });

  it('lists 4 and 8 neighbours', () => {
    expect(neighbours({ x: 5, y: 5 })).toHaveLength(4);
    expect(neighbours({ x: 5, y: 5 }, true)).toHaveLength(8);
    expect(neighbours({ x: 0, y: 0 })).toContainEqual({ x: -1, y: 0 });
  });
});

describe('screen intent and facing', () => {
  it('turns screen-right into grid (+1,-1) normalised', () => {
    const v = screenIntentToGrid(1, 0);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(-Math.SQRT1_2);
  });

  it('turns screen-down into grid (+1,+1) normalised', () => {
    const v = screenIntentToGrid(0, 1);
    expect(v.x).toBeCloseTo(Math.SQRT1_2);
    expect(v.y).toBeCloseTo(Math.SQRT1_2);
  });

  it('keeps diagonal screen intent at unit grid length', () => {
    const v = screenIntentToGrid(1, 1);
    expect(Math.hypot(v.x, v.y)).toBeCloseTo(1);
    expect(v).toEqual({ x: 1, y: 0 });
  });

  it('returns zero for no intent', () => {
    expect(screenIntentToGrid(0, 0)).toEqual({ x: 0, y: 0 });
  });

  it('names facings clockwise from East on screen', () => {
    expect(facingOfScreenDir(1, 0)).toBe(0); // E
    expect(facingOfScreenDir(0, 1)).toBe(2); // S
    expect(facingOfScreenDir(-1, 0)).toBe(4); // W
    expect(facingOfScreenDir(0, -1)).toBe(6); // N
    expect(facingOfScreenDir(1, -1)).toBe(7); // NE
  });

  it('maps grid +x,+y (screen down) to facing S', () => {
    expect(facingOfGridDir(1, 1)).toBe(2);
    expect(facingOfGridDir(1, -1)).toBe(0);
  });
});

describe('line of sight', () => {
  it('lists cells of a straight line', () => {
    expect(lineCells({ x: 0, y: 0 }, { x: 3, y: 0 })).toEqual([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 2, y: 0 },
      { x: 3, y: 0 },
    ]);
  });

  it('is a single cell when start equals end', () => {
    expect(lineCells({ x: 2, y: 2 }, { x: 2, y: 2 })).toEqual([{ x: 2, y: 2 }]);
  });

  it('touches both orthogonal cells on an exact diagonal (no corner slipping)', () => {
    const cells = lineCells({ x: 0, y: 0 }, { x: 1, y: 1 });
    expect(cells).toContainEqual({ x: 1, y: 0 });
    expect(cells).toContainEqual({ x: 0, y: 1 });
  });

  it('is clear in an empty field and blocked by a wall', () => {
    const none = () => false;
    expect(lineOfSight({ x: 0, y: 0 }, { x: 5, y: 3 }, none)).toBe(true);
    const wall = (c: { x: number; y: number }) => c.x === 2 && c.y >= -5 && c.y <= 5;
    expect(lineOfSight({ x: 0, y: 0 }, { x: 5, y: 0 }, wall)).toBe(false);
  });

  it('never tests the end cells themselves', () => {
    const onlyEnds = (c: { x: number; y: number }) => (c.x === 0 && c.y === 0) || (c.x === 4 && c.y === 0);
    expect(lineOfSight({ x: 0, y: 0 }, { x: 4, y: 0 }, onlyEnds)).toBe(true);
  });

  it('is symmetric for blockers', () => {
    const blocked = (c: { x: number; y: number }) => c.x === 3 && c.y === 2;
    const a = { x: 0, y: 0 };
    const b = { x: 7, y: 4 };
    expect(lineOfSight(a, b, blocked)).toBe(lineOfSight(b, a, blocked));
  });
});
