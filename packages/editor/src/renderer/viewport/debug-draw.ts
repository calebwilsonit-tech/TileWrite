import type { Graphics } from 'pixi.js';
import { facingVector } from '@tilewright/behaviors';
import { gridToScreen, type IsoConfig } from '@tilewright/runtime';
import { PALETTE } from './palette';

/** Debug shapes drawn in grid space on a Graphics, shared by the editor's overlay and the running game's. */

export interface ConeShape {
  x: number;
  y: number;
  h: number;
  facing: number;
  range: number;
  angle: number;
  hearing: number;
  hot: boolean;
}

export interface PathShape {
  points: { x: number; y: number; h: number }[];
  loop: boolean;
  hot: boolean;
}

export interface FootprintShape {
  x: number;
  y: number;
  h: number;
  w: number;
  d: number;
  /** Walk-through area (true) or solid (false). */
  trigger: boolean;
}

export interface LightShape {
  x: number;
  y: number;
  h: number;
  radius: number;
}

/** A guard's view: a wedge for the vision cone and a ring for how far it hears. */
export function drawCone(g: Graphics, c: ConeShape, iso: IsoConfig): void {
  const base = facingVector(c.facing);
  const baseAngle = Math.atan2(base.y, base.x);
  const half = (c.angle / 2) * (Math.PI / 180);
  const pts = [gridToScreen(c.x, c.y, c.h, iso)];
  const steps = 18;
  for (let i = 0; i <= steps; i++) {
    const a = baseAngle - half + (2 * half * i) / steps;
    pts.push(gridToScreen(c.x + Math.cos(a) * c.range, c.y + Math.sin(a) * c.range, c.h, iso));
  }
  g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: 0xff9a3c, alpha: c.hot ? 0.22 : 0.09 });
  g.poly(pts.flatMap((p) => [p.x, p.y])).stroke({ width: c.hot ? 2 : 1, color: 0xff9a3c, alpha: c.hot ? 0.9 : 0.35 });
  if (c.hearing > 0) drawRing(g, c.x, c.y, c.h, c.hearing, 0xffd34a, c.hot ? 0.8 : 0.25, iso);
}

function drawRing(g: Graphics, x: number, y: number, h: number, radius: number, color: number, alpha: number, iso: IsoConfig): void {
  const ring: number[] = [];
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * Math.PI * 2;
    const p = gridToScreen(x + Math.cos(a) * radius, y + Math.sin(a) * radius, h, iso);
    ring.push(p.x, p.y);
  }
  g.poly(ring).stroke({ width: 1, color, alpha });
}

/** A patrol route: a line through the waypoints, with a dot at each, and back to the start when it loops. */
export function drawPath(g: Graphics, p: PathShape, iso: IsoConfig): void {
  if (p.points.length === 0) return;
  const color = 0x4ad1c8;
  const alpha = p.hot ? 0.95 : 0.4;
  const pts = p.points.map((q) => gridToScreen(q.x, q.y, q.h, iso));
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i]!;
    const b = i + 1 < pts.length ? pts[i + 1]! : p.loop && pts.length > 1 ? pts[0]! : null;
    if (b) g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: p.hot ? 3 : 2, color, alpha });
    g.circle(a.x, a.y, p.hot ? 6 : 4).fill({ color, alpha });
  }
}

/** Where things take up room: trigger areas in purple, solid objects in red. */
export function drawFootprint(g: Graphics, f: FootprintShape, iso: IsoConfig): void {
  const color = f.trigger ? PALETTE.trigger : PALETTE.solid;
  const hx = f.w / 2;
  const hy = f.d / 2;
  const pts = [gridToScreen(f.x - hx, f.y - hy, f.h, iso), gridToScreen(f.x + hx, f.y - hy, f.h, iso), gridToScreen(f.x + hx, f.y + hy, f.h, iso), gridToScreen(f.x - hx, f.y + hy, f.h, iso)];
  const flat = pts.flatMap((p) => [p.x, p.y]);
  g.poly(flat).fill({ color, alpha: f.trigger ? 0.2 : 0.12 });
  g.poly(flat).stroke({ width: f.trigger ? 2 : 1.5, color, alpha: 0.85 });
}

/** How far a light reaches (before shadows). */
export function drawLightRadius(g: Graphics, l: LightShape, iso: IsoConfig): void {
  drawRing(g, l.x, l.y, l.h, l.radius, 0xffe9a8, 0.8, iso);
  const c = gridToScreen(l.x, l.y, l.h, iso);
  g.circle(c.x, c.y, 4).fill({ color: 0xffe9a8, alpha: 0.9 });
}

/** The same shapes from a bag of an object's components (editor data and live objects both fit). */
export function shapesOf(components: Record<string, unknown>): { cone?: Omit<ConeShape, 'hot'>; path?: Omit<PathShape, 'hot'>; footprint?: FootprintShape; light?: LightShape } {
  const t = components.transform as { x: number; y: number; h: number; facing: number } | undefined;
  if (!t) return {};
  const out: ReturnType<typeof shapesOf> = {};
  const vis = components.vision as { range?: number; angle?: number; hearing?: number } | undefined;
  if (vis) out.cone = { x: t.x, y: t.y, h: t.h + 0.05, facing: t.facing, range: vis.range ?? 6, angle: vis.angle ?? 100, hearing: vis.hearing ?? 0 };
  const c = components.collider as { w: number; d: number; trigger: boolean; enabled?: boolean } | undefined;
  if (c && c.enabled !== false) out.footprint = { x: t.x, y: t.y, h: t.h + 0.03, w: c.w, d: c.d, trigger: c.trigger };
  const l = components.light as { radius?: number } | undefined;
  if (l) out.light = { x: t.x, y: t.y, h: t.h + 0.05, radius: l.radius ?? 5 };
  const cp = components.checkpoint as { lightRadius?: number } | undefined;
  if (!out.light && cp) out.light = { x: t.x, y: t.y, h: t.h + 0.05, radius: cp.lightRadius ?? 5 };
  return out;
}
