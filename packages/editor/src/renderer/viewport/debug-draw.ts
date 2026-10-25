import type { Graphics } from 'pixi.js';
import { FADE_ON, cameraDirection, gridToScreen, viewOverlap, type Aabb, type DepthBox, type IsoConfig, type SolidField } from '@tilewright/runtime';
import { PALETTE } from './palette';
import { facingVector } from '@tilewright/behaviors';

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

// ---------- wires ----------

/** One line between two objects: a signal wire, or the line from an action node to the object its actions change. */
export interface WireShape {
  a: { x: number; y: number; h: number };
  b: { x: number; y: number; h: number };
  hot: boolean;
  kind: 'signal' | 'ref';
  /** 0 = idle, 1 = a signal is running through it right now (fades out over half a second while playing). */
  lit: number;
  /** For the wires drawn while playing: the id the line belongs to (a signal wire's id, or "ref:node:target"). */
  id: string;
}

/** An object as the wire drawing needs it: the same for editor data and for live objects (ids are scene ids). */
export interface WireEnd {
  id: string;
  components: Record<string, unknown>;
}

const anchorOfEnd = (e: WireEnd): { x: number; y: number; h: number } | null => {
  const t = e.components.transform as { x: number; y: number; h: number } | undefined;
  const s = e.components.sprite as { height?: number } | undefined;
  return t ? { x: t.x, y: t.y, h: t.h + Math.min(1, (s?.height ?? 0.5) / 2) } : null;
};

/** Every line to draw: the wires, plus a dotted line from each action node to the objects its actions point at. */
export function wireShapes(
  entities: readonly WireEnd[],
  wires: readonly { id: string; from: { entity: string }; to: { entity: string } }[],
  selected: readonly string[],
  lit: (id: string) => number = () => 0,
): WireShape[] {
  const byId = new Map(entities.map((e) => [e.id, e]));
  const out: WireShape[] = [];
  for (const w of wires) {
    const f = byId.get(w.from.entity);
    const t = byId.get(w.to.entity);
    const a = f && anchorOfEnd(f);
    const b = t && anchorOfEnd(t);
    if (a && b) out.push({ a, b, hot: selected.includes(w.from.entity) || selected.includes(w.to.entity), kind: 'signal', lit: lit(w.id), id: w.id });
  }
  for (const e of entities) {
    const an = e.components.actionNode as { actions?: { params: Record<string, unknown> }[] } | undefined;
    if (!an?.actions) continue;
    const seen = new Set<string>();
    for (const act of an.actions) {
      for (const v of Object.values(act.params)) {
        if (typeof v !== 'string' || !v.startsWith('id:')) continue;
        const target = byId.get(v.slice(3));
        const a = anchorOfEnd(e);
        const b = target && anchorOfEnd(target);
        if (a && b && !seen.has(target!.id)) {
          seen.add(target!.id);
          const id = `ref:${e.id}:${target!.id}`;
          out.push({ a, b, hot: selected.includes(e.id) || selected.includes(target!.id), kind: 'ref', lit: lit(id), id });
        }
      }
    }
  }
  return out;
}

/** A wire as a line with an arrowhead. Signal wires are yellow (green and thick while a signal runs); action lines are blue and dotted. */
export function drawWire(g: Graphics, w: WireShape, iso: IsoConfig): void {
  const pa = gridToScreen(w.a.x, w.a.y, w.a.h, iso);
  const pb = gridToScreen(w.b.x, w.b.y, w.b.h, iso);
  const live = w.lit > 0.02;
  const color = live ? 0x6fe08a : w.kind === 'ref' ? 0x6aa8ff : w.hot ? 0xffd34a : 0xe8b84a;
  const width = (w.hot ? 3 : 2) + (live ? 2 * w.lit : 0);
  const alpha = live ? 0.55 + 0.45 * w.lit : w.kind === 'ref' ? 0.7 : 0.95;
  if (w.kind === 'ref') {
    const dx = pb.x - pa.x;
    const dy = pb.y - pa.y;
    const len = Math.hypot(dx, dy) || 1;
    for (let d = 0; d < len; d += 12) {
      const e = Math.min(len, d + 6);
      g.moveTo(pa.x + (dx * d) / len, pa.y + (dy * d) / len).lineTo(pa.x + (dx * e) / len, pa.y + (dy * e) / len).stroke({ width, color, alpha });
    }
  } else {
    g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ width, color, alpha });
  }
  g.circle(pa.x, pa.y, width + 1).fill({ color, alpha });
  const angle = Math.atan2(pb.y - pa.y, pb.x - pa.x);
  const head = 10;
  g.poly([pb.x, pb.y, pb.x - head * Math.cos(angle - 0.45), pb.y - head * Math.sin(angle - 0.45), pb.x - head * Math.cos(angle + 0.45), pb.y - head * Math.sin(angle + 0.45)]).fill({ color, alpha });
}

/** The corners of a box in grid space, as screen points. */
function corners(b: Aabb, iso: IsoConfig): { x: number; y: number }[] {
  const out: { x: number; y: number }[] = [];
  for (const z of [b.z0, b.z1]) for (const [x, y] of [[b.x0, b.y0], [b.x1, b.y0], [b.x1, b.y1], [b.x0, b.y1]] as const) out.push(gridToScreen(x, y, z, iso));
  return out;
}

/** A box's edges (what a body occupies, as the physics sees it). */
export function drawBox(g: Graphics, b: Aabb, iso: IsoConfig, color: number, alpha = 0.9): void {
  const c = corners(b, iso);
  const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
  for (const [i, j] of edges) g.moveTo(c[i]!.x, c[i]!.y).lineTo(c[j]!.x, c[j]!.y);
  g.stroke({ width: 1, color, alpha });
}

const depthBox = (b: Aabb, id = 0): DepthBox => ({ id, minX: b.x0, maxX: b.x1, minY: b.y0, maxY: b.y1, minZ: b.z0, maxZ: b.z1 });

/**
 * The line of sight, as a volume: the box slid toward the camera until it leaves the scene (`reach` cells), and the solid blocks it runs into.
 * Those are the blocks that fade (the same test the renderer asks, see `viewOverlap`). The camera looks along one direction, so on the
 * screen the slid box lies exactly over the box itself; a single arrow along it is a dot, which is why the volume is drawn instead.
 */
export function sweptBlocks(field: Pick<SolidField, 'some'>, focus: Aabb, iso: IsoConfig, map: { width: number; height: number }, reach = 24): Aabb[] {
  const d = cameraDirection(iso);
  const far: Aabb = { x0: focus.x0, x1: focus.x1 + d.x * reach, y0: focus.y0, y1: focus.y1 + d.y * reach, z0: focus.z0, z1: focus.z1 + d.z * reach };
  const hits: Aabb[] = [];
  field.some(far, { wade: false }, (piece) => {
    if (piece.x0 < 0 || piece.y0 < 0 || piece.x1 > map.width || piece.y1 > map.height) return false; // (past the edge of the map everything counts as solid: that is not a block anyone sees)
    if (viewOverlap(depthBox(focus), depthBox(piece), iso) > FADE_ON) hits.push(piece);
    return false;
  });
  return hits;
}

/**
 * Draw the swept box and the blocks it hits. The box is drawn where it stands and again at steps along the line of sight, each step nudged
 * a few pixels aside (only so the steps can be told apart: they all lie on the same spot of the picture), joined by a line; every block
 * it hits is outlined and its top face tinted.
 */
export function drawSweep(g: Graphics, focus: Aabb, hits: readonly Aabb[], iso: IsoConfig, reach = 24): void {
  const d = cameraDirection(iso);
  const steps = Math.max(1, Math.min(6, Math.floor(reach / 4)));
  let prev: { x: number; y: number } | null = null;
  for (let i = 0; i <= steps; i++) {
    const t = (reach * i) / steps;
    const box: Aabb = { x0: focus.x0 + d.x * t, x1: focus.x1 + d.x * t, y0: focus.y0 + d.y * t, y1: focus.y1 + d.y * t, z0: focus.z0 + d.z * t, z1: focus.z1 + d.z * t };
    const nudge = i * 5;
    const c = corners(box, iso).map((p) => ({ x: p.x - nudge, y: p.y - nudge }));
    const edges = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]] as const;
    for (const [a, b] of edges) g.moveTo(c[a]!.x, c[a]!.y).lineTo(c[b]!.x, c[b]!.y);
    g.stroke({ width: 1, color: i === 0 ? 0xffffff : 0x6ad2ff, alpha: i === 0 ? 0.95 : 0.35 });
    const mid = { x: (c[0]!.x + c[6]!.x) / 2, y: (c[0]!.y + c[6]!.y) / 2 };
    if (prev) g.moveTo(prev.x, prev.y).lineTo(mid.x, mid.y).stroke({ width: 1, color: 0x6ad2ff, alpha: 0.5 });
    prev = mid;
  }
  for (const h of hits) {
    drawBox(g, h, iso, 0xff9a3c, 1);
    const top = corners(h, iso).slice(4);
    g.poly(top.flatMap((p) => [p.x, p.y])).fill({ color: 0xff9a3c, alpha: 0.25 });
  }
}

/** An arrow from a point along a direction (in grid space, `len` levels or cells long). */
export function drawArrow(g: Graphics, from: { x: number; y: number; h: number }, dir: readonly [number, number, number], len: number, iso: IsoConfig, color: number): void {
  const a = gridToScreen(from.x, from.y, from.h, iso);
  const b = gridToScreen(from.x + dir[0] * len, from.y + dir[1] * len, from.h + dir[2] * len, iso);
  g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: 2, color, alpha: 0.95 });
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  for (const turn of [2.6, -2.6]) g.moveTo(b.x, b.y).lineTo(b.x + Math.cos(ang + turn) * 8, b.y + Math.sin(ang + turn) * 8);
  g.stroke({ width: 2, color, alpha: 0.95 });
}

/** A small mark where a body touches what it stands on. */
export function drawContact(g: Graphics, at: { x: number; y: number; h: number }, iso: IsoConfig, on: boolean): void {
  const p = gridToScreen(at.x, at.y, at.h, iso);
  g.circle(p.x, p.y, on ? 4 : 3).fill({ color: on ? 0x6fe08a : 0xff6b6b, alpha: 0.95 });
}
