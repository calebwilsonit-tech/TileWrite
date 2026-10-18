import { describe, expect, it } from 'vitest';
import { DEFAULT_ISO, gridToScreen, relToScreen, rotateGrid, rotateVec, screenIntentToGrid, screenToGrid, unrotateGrid, unrotateVec, type IsoConfig, type ViewRotation } from './math';
import { boxAt, rotateBox, screenRect } from '../render/depth';

const cfg = (view: ViewRotation): IsoConfig => ({ ...DEFAULT_ISO, view, mapW: 20, mapH: 12 });

describe('turning the view', () => {
  it('rotating four quarter turns is the identity, and unrotate undoes rotate', () => {
    for (const view of [0, 1, 2, 3] as ViewRotation[]) {
      const c = cfg(view);
      for (const [x, y] of [[0, 0], [3.5, 7.25], [19.9, 11.1]] as const) {
        const r = rotateGrid(x, y, c);
        const back = unrotateGrid(r.x, r.y, c);
        expect(back.x).toBeCloseTo(x, 9);
        expect(back.y).toBeCloseTo(y, 9);
      }
      const v = rotateVec(2, 5, view);
      const u = unrotateVec(v.x, v.y, view);
      expect([u.x, u.y]).toEqual([2, 5]);
    }
    let v = { x: 1, y: 0 };
    for (let i = 0; i < 4; i++) v = rotateVec(v.x, v.y, 1);
    expect(v).toEqual({ x: 1, y: 0 });
  });

  it('screenToGrid undoes gridToScreen in every view, at any height', () => {
    for (const view of [0, 1, 2, 3] as ViewRotation[]) {
      const c = cfg(view);
      const s = gridToScreen(6.25, 4.75, 2, c);
      const g = screenToGrid(s.x, s.y, 2, c);
      expect(g.x).toBeCloseTo(6.25, 9);
      expect(g.y).toBeCloseTo(4.75, 9);
    }
  });

  it('keeps the world inside the same picture: each view puts a rotated map in the positive quadrant', () => {
    for (const view of [0, 1, 2, 3] as ViewRotation[]) {
      const c = cfg(view);
      for (const [x, y] of [[0, 0], [20, 0], [20, 12], [0, 12]] as const) {
        const r = rotateGrid(x, y, c);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x).toBeLessThanOrEqual(view % 2 === 0 ? 20 : 12);
      }
    }
  });

  it('turns local offsets without moving them (a cell\'s corners stay around its middle)', () => {
    const c = cfg(1);
    const mid = gridToScreen(5.5, 5.5, 0, c);
    const corner = relToScreen(0.5, -0.5, 0, c);
    const full = gridToScreen(6, 5, 0, c);
    expect(mid.x + corner.x).toBeCloseTo(full.x, 9);
    expect(mid.y + corner.y).toBeCloseTo(full.y, 9);
  });

  it('turns walking directions with the view, so "up the screen" stays up', () => {
    // a step up the screen (dy = -1) is -x-and-y in the usual view; after a quarter turn it is a different world direction
    const up0 = screenIntentToGrid(0, -1, 0);
    const up1 = screenIntentToGrid(0, -1, 1);
    expect(up0.x).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(up0.y).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(up1.x).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(up1.y).toBeCloseTo(Math.SQRT1_2, 9);
    // and it really does go up the screen in that view
    const s0 = relToScreen(up1.x, up1.y, 0, cfg(1));
    expect(s0.x).toBeCloseTo(0, 9);
    expect(s0.y).toBeLessThan(0);
  });

  it('turns depth boxes with the world so the draw order follows the view', () => {
    const c = cfg(1);
    const b = boxAt(1, 3, 2, 0, 2, 1, 1);
    const r = rotateBox(b, c);
    expect([r.minX, r.maxX, r.minY, r.maxY]).toEqual([12 - 2.5, 12 - 1.5, 2, 4]);
    // the picture of the turned box is where the turned position is
    const rect = screenRect(r, c);
    const p = gridToScreen(3, 2, 0, c);
    expect(rect.left).toBeLessThanOrEqual(p.x);
    expect(rect.right).toBeGreaterThanOrEqual(p.x);
    expect(rotateBox(b, cfg(0))).toBe(b);
  });
});
