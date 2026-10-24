import type { SimContext } from '../core/simulation';
import { C, type TransformIso } from '../scene/components';
import type { Entity, EntityId } from '../scene/world';
import { GRAVITY, layersMatch } from './common';
import { DOWN, axisIndex, bodyBox, feetOf, gravityFrame, turnFeet, type Aabb, type GravityDir, type GravityFrame } from './gravity';
import type { Body, SolidRef } from './physics';
import { SolidField } from './solids';
import { DEFAULT_STEP_DOWN, DEFAULT_STEP_UP, PIT_KILL_Z, oneWayBlocks } from './terrain';
import { FLAG } from '../tilemap/tilemap';

/**
 * Moving bodies with their whole box, under any gravity.
 *
 * A body is a box: `radius` to each side and `height` long, standing on a point (its feet, the transform) on whatever face is
 * under it when you look along gravity. Every move is made one axis at a time and stopped by the first solid block or object
 * in the way, so nothing is passed through, whichever way it is moving: walking into a wall, jumping into a ceiling, falling
 * onto a floor, or standing on a wall with gravity pulling sideways. Small steps up (stairs, a kerb) are climbed; small drops
 * are followed down. Where gravity is a different way, "down" below means that way.
 *
 * Velocities are in the world's axes: the two that lie in the plane the body walks on are what the controls and AI set each tick,
 * the one along gravity is the body's fall (or jump), managed here.
 */

const EPS = 1e-6;
const MAX_SUBSTEP = 0.2;
const AIR_STEP_UP = 0.05;
/** Falling this far "up" (levels) with nothing in the way counts as having left the world, like falling out of a pit. */
const WORLD_TOP = 64;
/** The most a body is pushed out of a block it ends up inside. */
const UNSTICK_MAX = 2;

interface Work {
  ctx: SimContext;
  field: SolidField;
  solids: SolidRef[];
  self: Entity;
  b: Body;
  frame: GravityFrame;
  who: { wade: boolean };
  /** The three world axes' index along gravity and the two in the plane. */
  gi: number;
  plane: readonly [number, number];
}

const lo = (b: Aabb, a: number): number => (a === 0 ? b.x0 : a === 1 ? b.y0 : b.z0);
const hi = (b: Aabb, a: number): number => (a === 0 ? b.x1 : a === 1 ? b.y1 : b.z1);

function shifted(b: Aabb, a: number, d: number): Aabb {
  return a === 0 ? { ...b, x0: b.x0 + d, x1: b.x1 + d } : a === 1 ? { ...b, y0: b.y0 + d, y1: b.y1 + d } : { ...b, z0: b.z0 + d, z1: b.z1 + d };
}

/** The entity solids' boxes (a crate, a platform, a closed gate) as the physics sees them. */
function solidBox(s: SolidRef): Aabb {
  return { x0: s.t.x - s.c.w / 2, x1: s.t.x + s.c.w / 2, y0: s.t.y - s.c.d / 2, y1: s.t.y + s.c.d / 2, z0: s.t.h, z1: s.t.h + s.c.height };
}

const overlapOn = (a: Aabb, p: Aabb, axis: number): boolean => {
  for (let o = 0; o < 3; o++) if (o !== axis && !(lo(a, o) < hi(p, o) - EPS && hi(a, o) > lo(p, o) + EPS)) return false;
  return true;
};

interface Hit {
  /** How far the box can move along the axis (never more than asked). */
  dist: number;
  /** What stopped it: an entity's id, 'terrain', or nothing. */
  by: EntityId | 'terrain' | null;
}

/** How far can the box move along an axis (`dir` is +1 or -1), at most `want`? */
function sweep(w: Work, box: Aabb, axis: number, dir: 1 | -1, want: number, forSupport = false): Hit {
  let dist = want;
  let by: Hit['by'] = null;
  const reach = shifted(box, axis, dir * want);
  const swept: Aabb = { x0: Math.min(box.x0, reach.x0), x1: Math.max(box.x1, reach.x1), y0: Math.min(box.y0, reach.y0), y1: Math.max(box.y1, reach.y1), z0: Math.min(box.z0, reach.z0), z1: Math.max(box.z1, reach.z1) };
  w.field.some(swept, w.who, (p) => {
    if (!overlapOn(box, p, axis)) return;
    const gap = dir > 0 ? lo(p, axis) - hi(box, axis) : lo(box, axis) - hi(p, axis);
    if (gap < -EPS) return; // already inside it: depenetration deals with that
    if (gap < dist) {
      dist = Math.max(0, gap);
      by = 'terrain';
    }
  });
  const b = w.b;
  for (const s of w.solids) {
    if (s.e === w.self || !s.e.alive) continue;
    if (forSupport && s.c.platform === false) continue;
    if (!layersMatch(b.layer, b.mask, s.c.layer, s.c.mask)) continue;
    const p = solidBox(s);
    if (p.x1 < swept.x0 || p.x0 > swept.x1 || p.y1 < swept.y0 || p.y0 > swept.y1 || p.z1 < swept.z0 || p.z0 > swept.z1) continue;
    if (!overlapOn(box, p, axis)) continue;
    const gap = dir > 0 ? lo(p, axis) - hi(box, axis) : lo(box, axis) - hi(p, axis);
    if (gap < -EPS) continue;
    if (gap < dist) {
      dist = Math.max(0, gap);
      by = s.e.id;
    }
  }
  return { dist, by };
}

function hitsSomething(w: Work, box: Aabb): boolean {
  if (w.field.overlaps(box, w.who)) return true;
  const b = w.b;
  for (const s of w.solids) {
    if (s.e === w.self || !s.e.alive || !layersMatch(b.layer, b.mask, s.c.layer, s.c.mask)) continue;
    const p = solidBox(s);
    if (p.x0 < box.x1 - EPS && p.x1 > box.x0 + EPS && p.y0 < box.y1 - EPS && p.y1 > box.y0 + EPS && p.z0 < box.z1 - EPS && p.z1 > box.z0 + EPS) return true;
  }
  return false;
}

/** Push a body that ended up inside something out of it (a block was put on it, or gravity turned beside a wall). */
function unstick(w: Work, box: Aabb): Aabb {
  if (!hitsSomething(w, box)) return box;
  const up = w.frame.up;
  const tries: [number, number][] = [];
  // first away from the surface (up), then to either side, in small steps
  for (let d = 0.05; d <= UNSTICK_MAX; d += 0.05) tries.push([w.gi, d]);
  for (const a of w.plane) for (let d = 0.05; d <= 1; d += 0.05) tries.push([a, d], [a, -d]);
  for (const [axis, d] of tries) {
    const sign = axis === w.gi ? (up[axis] as number) : 1;
    const moved = shifted(box, axis, d * sign);
    if (!hitsSomething(w, moved)) return moved;
  }
  return box;
}

/** Look along gravity for something to stand on within `reach`; returns how far down it is, and what it is. */
function supportBelow(w: Work, box: Aabb, reach: number): Hit {
  return sweep(w, box, w.gi, w.frame.sign, reach, true);
}

/** Advance every body one tick. Systems call this after behaviours set velocities. */
export function stepBodies3d(ctx: SimContext, solids: SolidRef[]): void {
  const map = ctx.map;
  if (!map) return;
  const field = new SolidField(map, ctx.assets.tileset ?? undefined);
  for (const e of ctx.world.query(C.Transform, C.Body)) {
    if (!e.alive) continue;
    stepBody3d(ctx, field, solids, e, e.require<TransformIso>(C.Transform), e.require<Body>(C.Body));
  }
}

function stepBody3d(ctx: SimContext, field: SolidField, solids: SolidRef[], e: Entity, t: TransformIso, b: Body): void {
  b.blockedBy = [];
  b.blockedTerrain = false;
  if (b.state === 'pit') return;
  const dt = ctx.dt;
  const dir: GravityDir = b.gdir ?? ctx.runtime.gravity ?? DOWN;
  const frame = gravityFrame(dir);
  const gi = axisIndex(frame.axis);
  const w: Work = { ctx, field, solids, self: e, b, frame, who: { wade: b.wade }, gi, plane: [axisIndex(frame.plane[0]), axisIndex(frame.plane[1])] };

  let feet = { x: t.x, y: t.y, h: t.h };
  if (b.g !== undefined && b.g !== dir) {
    // gravity turned: the body keeps the middle it had, forgets how it was moving, and falls toward the new surface
    const from = gravityFrame(b.g);
    feet = turnFeet(from, frame, feet, b.height);
    b.vx = b.vy = b.vz = 0;
    b.state = 'air';
    b.standingOn = null;
    b.turnedAt = ctx.tick;
    ctx.events.emit('gravity-changed', { entity: e.id, from: b.g, to: dir });
    const up = frame.up;
    b.peakZ = feet.x * up[0] + feet.y * up[1] + feet.h * up[2];
  }
  b.g = dir;

  let box = bodyBox(frame, feet, b.radius, b.height);
  if (b.noclip) {
    box = { x0: box.x0 + b.vx * dt, x1: box.x1 + b.vx * dt, y0: box.y0 + b.vy * dt, y1: box.y1 + b.vy * dt, z0: box.z0 + b.vz * dt, z1: box.z1 + b.vz * dt };
    write(t, frame, box, b);
    return;
  }
  box = unstick(w, box);

  const vel = [b.vx, b.vy, b.vz];
  // standing: make sure there is still something under the feet, and settle onto it
  if (b.state === 'ground') {
    const down = supportBelow(w, box, b.stepDown + EPS);
    if (down.by !== null && down.dist <= b.stepDown) {
      box = shifted(box, gi, frame.sign * down.dist);
      b.standingOn = typeof down.by === 'number' ? down.by : null;
    } else {
      b.state = 'air';
      b.standingOn = null;
      vel[gi] = 0;
      b.peakZ = upCoord(frame, box);
    }
  } else b.standingOn = null;

  // walking: the two axes of the plane, a little at a time
  const [pa, pc] = w.plane;
  const da = vel[pa]! * dt;
  const dc = vel[pc]! * dt;
  if (da !== 0 || dc !== 0) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(da), Math.abs(dc)) / MAX_SUBSTEP));
    for (let i = 0; i < n; i++) {
      box = moveInPlane(w, box, pa, da / n);
      box = moveInPlane(w, box, pc, dc / n);
    }
  }

  // falling and jumping: the axis along gravity
  if (b.state === 'air') {
    let vg = vel[gi]! * frame.sign; // positive: falling
    b.peakZ = Math.max(b.peakZ, upCoord(frame, box));
    vg += GRAVITY * b.gravity * dt;
    const move = vg * dt;
    if (move !== 0) {
      const dirSign = move > 0 ? frame.sign : (-frame.sign as 1 | -1);
      const hit = sweep(w, box, gi, dirSign, Math.abs(move), move > 0);
      box = shifted(box, gi, dirSign * hit.dist);
      if (hit.dist < Math.abs(move) - EPS) {
        if (move > 0) {
          // landed
          const distance = b.peakZ - upCoord(frame, box);
          b.state = 'ground';
          b.standingOn = typeof hit.by === 'number' ? hit.by : null;
          vg = 0;
          ctx.events.emit('landed', { entity: e.id, distance });
          b.peakZ = upCoord(frame, box);
        } else {
          vg = 0; // hit its head
          if (typeof hit.by === 'number' && !b.blockedBy.includes(hit.by)) b.blockedBy.push(hit.by);
          b.blockedTerrain = b.blockedTerrain || hit.by === 'terrain';
        }
      }
    }
    vel[gi] = vg * frame.sign;
    b.vx = vel[0]!;
    b.vy = vel[1]!;
    b.vz = vel[2]!;
  }

  write(t, frame, box, b);
  if (b.state === 'air') {
    const f = feetOf(frame, box, b.radius);
    if (frame.axis === 'z' && frame.sign === -1 && f.h <= PIT_KILL_Z) fell(ctx, e, t, b, 'pit');
    else if (frame.axis === 'z' && frame.sign === 1 && f.h >= WORLD_TOP) fell(ctx, e, t, b, 'sky');
  }
}

function fell(ctx: SimContext, e: Entity, t: TransformIso, b: Body, cause: string): void {
  if (cause === 'pit') t.h = PIT_KILL_Z;
  b.vx = b.vy = b.vz = 0;
  b.state = 'pit';
  ctx.events.emit('fell', { entity: e.id, cause });
}

/** How far "up" the feet are (what a fall is measured along). */
function upCoord(frame: GravityFrame, box: Aabb): number {
  const f = feetOf(frame, box, 0);
  return f.x * frame.up[0] + f.y * frame.up[1] + f.h * frame.up[2];
}

function write(t: TransformIso, frame: GravityFrame, box: Aabb, b: Body): void {
  const f = feetOf(frame, box, b.radius);
  t.x = f.x;
  t.y = f.y;
  t.h = f.h;
}

/** Is there ground within a step down under every corner of the body's footing? (A guard that must not leave its platform asks.) */
function cornersSupported(w: Work, box: Aabb): boolean {
  const gi = w.gi;
  const feet = w.frame.sign === -1 ? lo(box, gi) : hi(box, gi);
  for (const sa of [-1, 1]) {
    for (const sc of [-1, 1]) {
      // a thin box standing on that corner of the feet
      const min = [0, 0, 0];
      const max = [0, 0, 0];
      for (let axis = 0; axis < 3; axis++) {
        const side = axis === w.plane[0] ? sa : axis === w.plane[1] ? sc : 0;
        const at = side < 0 ? lo(box, axis) + 0.01 : hi(box, axis) - 0.01;
        if (axis === gi) {
          min[axis] = w.frame.sign === -1 ? feet : feet - 0.01;
          max[axis] = w.frame.sign === -1 ? feet + 0.01 : feet;
        } else {
          min[axis] = at - 0.005;
          max[axis] = at + 0.005;
        }
      }
      const thin: Aabb = { x0: min[0]!, x1: max[0]!, y0: min[1]!, y1: max[1]!, z0: min[2]!, z1: max[2]! };
      const down = sweep(w, thin, gi, w.frame.sign, w.b.stepDown + EPS, true);
      if (down.by === null || down.dist > w.b.stepDown) return false;
    }
  }
  return true;
}

/**
 * Move along one axis of the walking plane. A step up (a stair, a kerb) is climbed if the body fits; after the move a body on
 * the ground follows the surface down. Returns the new box (the old one if the move could not be made).
 */
function moveInPlane(w: Work, box: Aabb, axis: number, delta: number): Aabb {
  if (delta === 0) return box;
  const b = w.b;
  const dir: 1 | -1 = delta > 0 ? 1 : -1;
  const want = Math.abs(delta);

  // a one-way edge: crossing into the neighbouring cell through a forbidden side
  if (w.frame.axis === 'z' && w.ctx.map) {
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;
    const nx = cx + (axis === 0 ? delta : 0);
    const ny = cy + (axis === 1 ? delta : 0);
    if (oneWayBlocks(w.ctx.map, Math.floor(cx), Math.floor(cy), Math.floor(nx), Math.floor(ny))) {
      b.blockedTerrain = true;
      return box;
    }
  }

  let moved = box;
  const hit = sweep(w, box, axis, dir, want);
  if (hit.dist >= want - EPS) moved = shifted(box, axis, dir * want);
  else {
    // blocked: climb it if it is low enough
    const up = b.state === 'ground' ? b.stepUp : AIR_STEP_UP;
    let climbed = false;
    if (up > EPS) {
      const sign = w.frame.up[w.gi] as number;
      for (const lift of [Math.min(up, 0.1), Math.min(up, 0.2), up]) {
        const lifted = shifted(box, w.gi, sign * lift);
        if (hitsSomething(w, lifted)) continue;
        const h2 = sweep(w, lifted, axis, dir, want);
        if (h2.dist >= want - EPS) {
          moved = shifted(lifted, axis, dir * want);
          climbed = true;
          break;
        }
      }
    }
    if (!climbed) {
      // stopped by it: slide right up to it, and say what it was
      b.blockedTerrain = b.blockedTerrain || hit.by === 'terrain';
      if (typeof hit.by === 'number' && !b.blockedBy.includes(hit.by)) b.blockedBy.push(hit.by);
      moved = shifted(box, axis, dir * hit.dist);
    }
  }

  if (b.state === 'ground') {
    const down = supportBelow(w, moved, b.stepDown + EPS);
    if (down.by !== null && down.dist <= b.stepDown && !(b.ledge === 'block' && !cornersSupported(w, moved))) {
      moved = shifted(moved, w.gi, w.frame.sign * down.dist);
      b.standingOn = typeof down.by === 'number' ? down.by : null;
    } else if (b.ledge === 'block') {
      // a drop too big to follow is a wall for this body (guards that stay on their platform)
      b.blockedTerrain = true;
      return box;
    } else {
      b.state = 'air';
      b.standingOn = null;
      b.peakZ = upCoord(w.frame, moved);
      const v = [b.vx, b.vy, b.vz];
      v[w.gi] = 0;
      b.vx = v[0]!;
      b.vy = v[1]!;
      b.vz = v[2]!;
    }
    if (b.pits === 'block' && w.frame.axis === 'z' && w.ctx.map) {
      const cx = Math.floor((moved.x0 + moved.x1) / 2);
      const cy = Math.floor((moved.y0 + moved.y1) / 2);
      if (w.ctx.map.getFlags(cx, cy) & FLAG.PIT && w.ctx.map.getDeck(cx, cy) === 0) {
        b.blockedTerrain = true;
        return box;
      }
    }
  }
  return moved;
}

export { DEFAULT_STEP_DOWN, DEFAULT_STEP_UP };
