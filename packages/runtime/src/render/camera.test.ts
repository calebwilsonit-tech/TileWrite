import { describe, expect, it } from 'vitest';
import { Camera } from './camera';

function cam(): Camera {
  const c = new Camera();
  c.setViewport(800, 600);
  return c;
}

describe('Camera', () => {
  it('maps world <-> view and round-trips', () => {
    const c = cam();
    c.snapTo({ x: 100, y: 50 });
    c.zoom = 2;
    expect(c.worldToView({ x: 100, y: 50 })).toEqual({ x: 400, y: 300 });
    const v = c.worldToView({ x: 130, y: 20 });
    const w = c.viewToWorld(v);
    expect(w.x).toBeCloseTo(130);
    expect(w.y).toBeCloseTo(20);
  });

  it('snaps to the target when there is no deadzone', () => {
    const c = cam();
    c.follow({ x: 40, y: -10 });
    expect({ x: c.x, y: c.y }).toEqual({ x: 40, y: -10 });
  });

  it('does not move while the target stays inside the deadzone', () => {
    const c = cam();
    c.deadzoneW = 50;
    c.deadzoneH = 30;
    c.follow({ x: 40, y: -20 });
    expect({ x: c.x, y: c.y }).toEqual({ x: 0, y: 0 });
  });

  it('drags the camera just enough to keep the target at the deadzone edge', () => {
    const c = cam();
    c.deadzoneW = 50;
    c.deadzoneH = 30;
    c.follow({ x: 120, y: 0 });
    expect(c.x).toBe(70);
    c.follow({ x: -200, y: 100 });
    expect(c.x).toBe(-150);
    expect(c.y).toBe(70);
  });

  it('smooths toward the goal', () => {
    const c = cam();
    c.smoothing = 0.5;
    c.follow({ x: 100, y: 0 });
    expect(c.x).toBe(50);
    c.follow({ x: 100, y: 0 });
    expect(c.x).toBe(75);
  });

  it('clamps to bounds so the view never leaves the room', () => {
    const c = cam();
    c.bounds = { minX: -1000, minY: -1000, maxX: 1000, maxY: 1000 };
    c.snapTo({ x: 5000, y: -5000 });
    expect(c.x).toBe(1000 - 400);
    expect(c.y).toBe(-1000 + 300);
  });

  it('centres on bounds smaller than the view', () => {
    const c = cam();
    c.bounds = { minX: 0, minY: 0, maxX: 200, maxY: 100 };
    c.snapTo({ x: 999, y: 999 });
    expect({ x: c.x, y: c.y }).toEqual({ x: 100, y: 50 });
  });

  it('accounts for zoom when clamping', () => {
    const c = cam();
    c.zoom = 2;
    c.bounds = { minX: 0, minY: 0, maxX: 1000, maxY: 1000 };
    c.snapTo({ x: 0, y: 0 });
    expect(c.x).toBe(200); // half-view is 400/2 world px at 2x
  });

  it('shakes then settles back to exactly zero', () => {
    const c = cam();
    c.shake(10, 0.5);
    let moved = false;
    for (let i = 0; i < 60; i++) {
      c.update(1 / 60);
      const v = c.worldToView({ x: 0, y: 0 });
      if (v.x !== 400 || v.y !== 300) moved = true;
      expect(Math.abs(v.x - 400)).toBeLessThanOrEqual(10);
    }
    expect(moved).toBe(true);
    expect(c.shaking).toBe(false);
    c.update(1 / 60);
    expect(c.worldToView({ x: 0, y: 0 })).toEqual({ x: 400, y: 300 });
  });

  it('shakes identically every run (seeded)', () => {
    const run = (): number[] => {
      const c = cam();
      c.shake(8, 1);
      const out: number[] = [];
      for (let i = 0; i < 10; i++) {
        c.update(1 / 60);
        out.push(c.worldToView({ x: 0, y: 0 }).x);
      }
      return out;
    };
    expect(run()).toEqual(run());
  });
});
