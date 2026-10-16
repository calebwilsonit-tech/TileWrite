import type { SimContext } from '../core/simulation';
import { C, type TransformIso } from '../scene/components';
import type { Entity, EntityId } from '../scene/world';
import type { TileMap } from '../tilemap/tilemap';
import {
  DEFAULT_STEP_DOWN,
  DEFAULT_STEP_UP,
  PIT_KILL_Z,
  oneWayBlocks,
  surfaceAt,
  type SurfaceQuery,
} from './terrain';

/** Collision layer bits. Games can define more; these are the built-in ones. */
export const LAYER = {
  DEFAULT: 1,
  PLAYER: 2,
  ENEMY: 4,
  ECHO: 8,
  PROP: 16,
  GHOST: 32,
} as const;

export const GRAVITY = 36; // levels / s^2
const MAX_SUBSTEP = 0.2; // cells; keeps fast bodies from tunnelling
const AIR_STEP_UP = 0.05;

export type BodyState = 'ground' | 'air' | 'pit';

/** A thing that walks, falls and collides. Behaviours set vx/vy each tick; physics does the rest. */
export interface Body {
  /** Desired velocity in cells/second (grid space). */
  vx: number;
  vy: number;
  /** Vertical velocity in levels/second (set by jumps; managed while airborne). */
  vz: number;
  /** Half-width of the square footprint. */
  radius: number;
  /** Height in levels (for ceilings/bridge undersides and entity overlap). */
  height: number;
  state: BodyState;
  /** Highest ledge the body walks up without a jump. */
  stepUp: number;
  /** Largest drop it follows down without becoming airborne. */
  stepDown: number;
  /** 'fall': walking off a ledge drops you. 'block': drops bigger than stepDown are walls (AI). */
  ledge: 'fall' | 'block';
  /** 'fall': pits swallow the body. 'block': pits are walls (AI that avoids them). */
  pits: 'fall' | 'block';
  /** Can walk through water. */
  wade: boolean;
  /** Gravity multiplier. */
  gravity: number;
  /** Highest point of the current fall (for fall distance). */
  peakZ: number;
  layer: number;
  mask: number;
  noclip: boolean;
  /** Ids of solid entities that stopped movement this tick (pushables read this). */
  blockedBy: EntityId[];
  /** True if terrain stopped movement this tick. */
  blockedTerrain: boolean;
}

export interface Collider {
  /** Footprint width (x) and depth (y) in cells; height in levels. Centred on the transform. */
  w: number;
  d: number;
  height: number;
  /** Blocks bodies. */
  solid: boolean;
  /** Reports overlaps as trigger-enter / trigger-stay / trigger-exit events. */
  trigger: boolean;
  layer: number;
  /** Layers this collider interacts with. */
  mask: number;
  enabled: boolean;
  /** Triggers only: ids currently inside (managed by physics). */
  inside: EntityId[];
}

export function makeBody(partial: Partial<Body> = {}): Body {
  return {
    vx: 0,
    vy: 0,
    vz: 0,
    radius: 0.3,
    height: 1,
    state: 'ground',
    stepUp: DEFAULT_STEP_UP,
    stepDown: DEFAULT_STEP_DOWN,
    ledge: 'fall',
    pits: 'fall',
    wade: false,
    gravity: 1,
    peakZ: 0,
    layer: LAYER.DEFAULT,
    mask: 0xffff,
    noclip: false,
    blockedBy: [],
    blockedTerrain: false,
    ...partial,
  };
}

export function makeCollider(partial: Partial<Collider> = {}): Collider {
  return {
    w: 1,
    d: 1,
    height: 1,
    solid: true,
    trigger: false,
    layer: LAYER.DEFAULT,
    mask: 0xffff,
    enabled: true,
    inside: [],
    ...partial,
  };
}

/** Give a grounded body an upward kick. */
export function jumpBody(b: Body, speed: number): void {
  if (b.state !== 'ground') return;
  b.vz = speed;
  b.state = 'air';
}

/** Put a body somewhere new and reset its motion (respawns, checkpoints, scene portals). */
export function teleportBody(ctx: SimContext, e: Entity, x: number, y: number, z?: number): void {
  const t = e.require<TransformIso>(C.Transform);
  const b = e.get<Body>(C.Body);
  t.x = x;
  t.y = y;
  if (b) {
    b.vx = b.vy = b.vz = 0;
    if (z === undefined && ctx.map) {
      const s = surfaceAt(ctx.map, x, y, 1e6, { stepUp: b.stepUp, bodyHeight: b.height });
      t.h = Number.isFinite(s.z) ? s.z : 0;
    } else {
      t.h = z ?? 0;
    }
    b.state = 'ground';
    b.peakZ = t.h;
  } else if (z !== undefined) {
    t.h = z;
  }
}

function layersMatch(aLayer: number, aMask: number, bLayer: number, bMask: number): boolean {
  return (aLayer & bMask) !== 0 && (bLayer & aMask) !== 0;
}

interface SolidRef {
  e: Entity;
  t: TransformIso;
  c: Collider;
}

/** Moves bodies with collision, gravity and ledges, then updates triggers. Run after behaviours set velocities. */
export function physicsSystem(ctx: SimContext): void {
  const { world, map, dt } = ctx;
  const solids: SolidRef[] = [];
  for (const e of world.query(C.Transform, C.Collider)) {
    const c = e.require<Collider>(C.Collider);
    if (c.solid && c.enabled) solids.push({ e, t: e.require<TransformIso>(C.Transform), c });
  }

  if (map) {
    for (const e of world.query(C.Transform, C.Body)) {
      if (!e.alive) continue;
      stepBody(ctx, e, e.require<TransformIso>(C.Transform), e.require<Body>(C.Body), solids, dt);
    }
  }
  updateTriggers(ctx);
}

function stepBody(ctx: SimContext, e: Entity, t: TransformIso, b: Body, solids: SolidRef[], dt: number): void {
  b.blockedBy = [];
  b.blockedTerrain = false;
  if (b.state === 'pit') return;

  if (b.state === 'ground') settle(ctx, t, b);

  const dx = b.vx * dt;
  const dy = b.vy * dt;
  if (dx !== 0 || dy !== 0) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / MAX_SUBSTEP));
    for (let i = 0; i < n; i++) {
      moveAxis(ctx, e, t, b, solids, dx / n, 0);
      moveAxis(ctx, e, t, b, solids, 0, dy / n);
    }
  }
  if (b.state === 'air') fall(ctx, e, t, b, dt);
}

function query(b: Body, airborne: boolean): SurfaceQuery {
  return { stepUp: airborne ? AIR_STEP_UP : b.stepUp, bodyHeight: b.height };
}

function moveAxis(ctx: SimContext, e: Entity, t: TransformIso, b: Body, solids: SolidRef[], dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const nx = t.x + dx;
  const ny = t.y + dy;
  if (b.noclip) {
    t.x = nx;
    t.y = ny;
    return;
  }
  const map = ctx.map!;
  if (oneWayBlocks(map, Math.floor(t.x), Math.floor(t.y), Math.floor(nx), Math.floor(ny))) {
    b.blockedTerrain = true;
    return;
  }
  // A grounded body rides the slope, so judge the new footprint at the height it will have there.
  let z = t.h;
  if (b.state === 'ground') {
    const c = surfaceAt(map, nx, ny, t.h, query(b, false));
    if ((c.kind === 'ground' || c.kind === 'deck') && c.z - t.h <= b.stepUp && t.h - c.z <= b.stepDown) z = c.z;
  }
  if (!terrainAllows(ctx, b, t.x, t.y, nx, ny, z)) {
    b.blockedTerrain = true;
    return;
  }
  const blockers = solidBlockers(e, b, nx, ny, z, solids);
  if (blockers.length > 0) {
    for (const id of blockers) if (!b.blockedBy.includes(id)) b.blockedBy.push(id);
    return;
  }
  t.x = nx;
  t.y = ny;
  if (b.state === 'ground') settle(ctx, t, b);
}

/** Would a footprint corner at (cx, cy) be inside something the body cannot occupy? */
function cornerBlocked(map: TileMap, b: Body, cx: number, cy: number, z: number): boolean {
  const airborne = b.state === 'air';
  const q = query(b, airborne);
  const s = surfaceAt(map, cx, cy, z, q);
  switch (s.kind) {
    case 'void':
    case 'solid':
      return true;
    case 'water':
      return !b.wade || s.z - z > q.stepUp;
    case 'pit':
      return b.pits === 'block';
    default:
      if (s.z - z > q.stepUp) return true; // cliff or wall
      return !airborne && b.ledge === 'block' && z - s.z > b.stepDown;
  }
}

const CORNERS = [[-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

/**
 * Can the body's footprint move from (ox, oy) to (nx, ny) at height z?
 * A corner that is already stuck inside an obstacle (after a landing, a teleport or a spawn) may move
 * AWAY from that obstacle's centre, so bodies can never be trapped inside walls.
 */
function terrainAllows(ctx: SimContext, b: Body, ox: number, oy: number, nx: number, ny: number, z: number): boolean {
  const map = ctx.map!;
  const r = b.radius;
  const dx = nx - ox;
  const dy = ny - oy;
  for (const [sx, sy] of CORNERS) {
    const cx = nx + sx * r;
    const cy = ny + sy * r;
    if (!cornerBlocked(map, b, cx, cy, z)) continue;
    const stuck = cornerBlocked(map, b, ox + sx * r, oy + sy * r, z);
    const away = (cx - (Math.floor(cx) + 0.5)) * dx + (cy - (Math.floor(cy) + 0.5)) * dy > 0;
    if (stuck && away) continue;
    return false;
  }
  return true;
}

function solidBlockers(self: Entity, b: Body, x: number, y: number, z: number, solids: SolidRef[]): EntityId[] {
  const out: EntityId[] = [];
  for (const s of solids) {
    if (s.e === self || !s.e.alive) continue;
    if (!layersMatch(b.layer, b.mask, s.c.layer, s.c.mask)) continue;
    if (Math.abs(x - s.t.x) >= b.radius + s.c.w / 2) continue;
    if (Math.abs(y - s.t.y) >= b.radius + s.c.d / 2) continue;
    if (z >= s.t.h + s.c.height - 0.01 || z + b.height <= s.t.h + 0.01) continue;
    out.push(s.e.id);
  }
  return out;
}

/** Snap a grounded body to the surface under its centre, or send it airborne if there's nothing close. */
function settle(ctx: SimContext, t: TransformIso, b: Body): void {
  const s = surfaceAt(ctx.map!, t.x, t.y, t.h, query(b, false));
  const standable = s.kind === 'ground' || s.kind === 'deck' || (s.kind === 'water' && b.wade);
  if (standable) {
    const diff = s.z - t.h;
    if (diff <= b.stepUp && -diff <= b.stepDown) {
      t.h = s.z;
      return;
    }
  }
  b.state = 'air';
  b.vz = 0;
  b.peakZ = t.h;
}

function fall(ctx: SimContext, e: Entity, t: TransformIso, b: Body, dt: number): void {
  b.peakZ = Math.max(b.peakZ, t.h);
  b.vz -= GRAVITY * b.gravity * dt;
  const nz = t.h + b.vz * dt;
  const s = surfaceAt(ctx.map!, t.x, t.y, t.h, query(b, true));
  const standable = s.kind === 'ground' || s.kind === 'deck' || (s.kind === 'water' && b.wade);
  if (standable && b.vz <= 0 && nz <= s.z) {
    const distance = b.peakZ - s.z;
    t.h = s.z;
    b.vz = 0;
    b.state = 'ground';
    ctx.events.emit('landed', { entity: e.id, distance });
    b.peakZ = t.h;
    return;
  }
  t.h = nz;
  if (!standable && t.h <= PIT_KILL_Z) {
    t.h = PIT_KILL_Z;
    b.vx = b.vy = b.vz = 0;
    b.state = 'pit';
    ctx.events.emit('fell', { entity: e.id, cause: s.kind });
  }
}

function overlapsTrigger(tt: TransformIso, c: Collider, ot: TransformIso, radius: number, height: number): boolean {
  if (Math.abs(ot.x - tt.x) >= radius + c.w / 2) return false;
  if (Math.abs(ot.y - tt.y) >= radius + c.d / 2) return false;
  return ot.h < tt.h + c.height - 0.01 && ot.h + height > tt.h + 0.01;
}

function updateTriggers(ctx: SimContext): void {
  const { world, events } = ctx;
  const triggers = world.query(C.Transform, C.Collider).filter((e) => {
    const c = e.require<Collider>(C.Collider);
    return c.trigger && c.enabled;
  });
  if (triggers.length === 0 && world.query(C.Collider).every((e) => e.require<Collider>(C.Collider).inside.length === 0)) return;

  // candidates: anything with a body, plus solid colliders (crates on plates)
  const candidates: { e: Entity; t: TransformIso; layer: number; radius: number; height: number }[] = [];
  for (const e of world.query(C.Transform)) {
    const t = e.require<TransformIso>(C.Transform);
    const b = e.get<Body>(C.Body);
    if (b) {
      candidates.push({ e, t, layer: b.layer, radius: b.radius, height: b.height });
      continue;
    }
    const c = e.get<Collider>(C.Collider);
    if (c && c.solid && c.enabled && !c.trigger) {
      candidates.push({ e, t, layer: c.layer, radius: Math.max(c.w, c.d) / 2, height: c.height });
    }
  }

  // also process triggers that were disabled/destroyed but still list occupants
  const all = new Set(triggers);
  for (const e of world.query(C.Collider)) {
    const c = e.require<Collider>(C.Collider);
    if (c.trigger && c.inside.length > 0) all.add(e);
  }

  for (const trig of [...all].sort((a, b) => a.id - b.id)) {
    const c = trig.require<Collider>(C.Collider);
    const tt = trig.require<TransformIso>(C.Transform);
    const now: EntityId[] = [];
    if (c.enabled) {
      for (const cand of candidates) {
        if (cand.e === trig) continue;
        if ((cand.layer & c.mask) === 0) continue;
        if (overlapsTrigger(tt, c, cand.t, cand.radius, cand.height)) now.push(cand.e.id);
      }
    }
    now.sort((a, b) => a - b);
    const before = c.inside;
    for (const id of now) {
      events.emit(before.includes(id) ? 'trigger-stay' : 'trigger-enter', { trigger: trig.id, other: id });
    }
    for (const id of before) if (!now.includes(id)) events.emit('trigger-exit', { trigger: trig.id, other: id });
    c.inside = now;
  }
}
