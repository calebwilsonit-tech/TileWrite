import { C, facingOfGridDir, findPath, straightWalkable, type Body, type Cell2, type Collider, type Entity, type SimContext, type TransformIso } from '@tilewright/runtime';

const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);
const body = (e: Entity): Body | undefined => e.get<Body>(C.Body);

// ---------- walking along a path ----------

export interface NavState {
  path: Cell2[];
  goal: Cell2 | null;
  repath: number;
  failed: boolean;
}

export const newNav = (): NavState => ({ path: [], goal: null, repath: 0, failed: false });

/** Cells taken up by solid objects (crates, closed gates, pillars) that a walker must go around. */
function obstacleCells(ctx: SimContext, self: Entity): Set<string> {
  const out = new Set<string>();
  for (const o of ctx.world.query(C.Transform, C.Collider)) {
    if (o === self || o.has(C.Body)) continue;
    const c = o.require<Collider>(C.Collider);
    if (!c.solid || !c.enabled || c.trigger || c.height < 0.4) continue;
    const t = transform(o);
    for (let x = Math.floor(t.x - c.w / 2 + 0.05); x <= Math.floor(t.x + c.w / 2 - 0.05); x++) {
      for (let y = Math.floor(t.y - c.d / 2 + 0.05); y <= Math.floor(t.y + c.d / 2 - 0.05); y++) out.add(`${x},${y}`);
    }
  }
  return out;
}

/** A push (up to about 0.7 of a walker's speed) away from other walkers that are closer than 0.9 cells. */
function separation(ctx: SimContext, self: Entity, t: TransformIso): { x: number; y: number } {
  let px = 0;
  let py = 0;
  for (const o of ctx.world.query('state:aiFlags', C.Transform, C.Body)) {
    if (o === self || !o.alive) continue;
    const ot = transform(o);
    if (Math.abs(ot.h - t.h) > 1) continue;
    const dx = t.x - ot.x;
    const dy = t.y - ot.y;
    const d = Math.hypot(dx, dy);
    if (d >= 0.9) continue;
    // exactly on top of each other: the one with the lower id steps aside one way, the other the other way
    const [ux, uy] = d < 0.001 ? [self.id < o.id ? 1 : -1, 0] : [dx / d, dy / d];
    const k = (0.9 - d) / 0.9;
    px += ux * k * 0.7;
    py += uy * k * 0.7;
  }
  return { x: px, y: py };
}

/**
 * Walk towards a point, going around walls, pits and objects (A* when the straight way is not clear).
 * Sets the body's velocity and facing. Returns 'arrived', 'moving' or 'stuck' (no way there).
 */
export function steerTo(ctx: SimContext, e: Entity, goal: Cell2, speed: number, nav: NavState, arrive = 0.18): 'arrived' | 'moving' | 'stuck' {
  const b = body(e);
  const t = transform(e);
  if (!b || !ctx.map) return 'stuck';
  const dxg = goal.x - t.x;
  const dyg = goal.y - t.y;
  if (Math.hypot(dxg, dyg) <= arrive) {
    b.vx = b.vy = 0;
    nav.path = [];
    return 'arrived';
  }
  nav.repath -= ctx.dt;
  const goalCell = { x: Math.floor(goal.x), y: Math.floor(goal.y) };
  const moved = !nav.goal || nav.goal.x !== goalCell.x || nav.goal.y !== goalCell.y;
  if (moved || nav.repath <= 0) {
    nav.goal = goalCell;
    nav.repath = 0.5;
    const obstacles = obstacleCells(ctx, e);
    const blocked = (x: number, y: number): boolean => obstacles.has(`${x},${y}`);
    const opts = { stepUp: b.stepUp, maxDrop: b.stepDown, blocked, clearance: b.radius };
    if (straightWalkable(ctx.map, t, goal, opts)) {
      nav.path = [{ x: goal.x, y: goal.y }];
      nav.failed = false;
    } else {
      // a walker that cannot get there gives up looking early, and looks again only after a while (so a crowd with no way is cheap)
      const p = findPath(ctx.map, t, goal, { ...opts, diagonal: false, maxNodes: 6000 });
      nav.failed = p === null;
      if (p === null) nav.repath = 2;
      nav.path = p ?? [];
      if (p && p.length > 0) p[p.length - 1] = { x: goal.x, y: goal.y };
    }
  }
  if (nav.path.length === 0) {
    b.vx = b.vy = 0;
    return nav.failed ? 'stuck' : 'moving';
  }
  let next = nav.path[0]!;
  while (nav.path.length > 1 && Math.hypot(next.x - t.x, next.y - t.y) < 0.18) {
    nav.path.shift();
    next = nav.path[0]!;
  }
  const dx = next.x - t.x;
  const dy = next.y - t.y;
  const len = Math.hypot(dx, dy);
  if (len < 0.05) {
    b.vx = b.vy = 0;
    return 'moving';
  }
  let vx = (dx / len) * speed;
  let vy = (dy / len) * speed;
  // other walkers with a mind of their own are not walked through: a gentle push away from anyone too close
  const push = separation(ctx, e, t);
  vx += push.x * speed;
  vy += push.y * speed;
  const mag = Math.hypot(vx, vy);
  if (mag > speed && mag > 0) {
    vx = (vx / mag) * speed;
    vy = (vy / mag) * speed;
  }
  b.vx = vx;
  b.vy = vy;
  t.facing = facingOfGridDir(dx, dy);
  return 'moving';
}

/** "12,8; 16.5,8; 16,12" -> points. Anything that is not a pair of numbers is skipped. */
export function parsePoints(text: string): Cell2[] {
  const out: Cell2[] = [];
  for (const part of text.split(';')) {
    const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(part);
    if (m) out.push({ x: Number(m[1]), y: Number(m[2]) });
  }
  return out;
}

export function formatPoints(points: readonly Cell2[]): string {
  return points.map((p) => `${p.x},${p.y}`).join('; ');
}
