import {
  C,
  expandEntities,
  instantiateEntity,
  surfaceAt,
  type Body,
  type Collider,
  type Entity,
  type SimContext,
  type Sprite,
  type TransformIso,
} from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { input, setOutput } from '../signals';
import { matchesWho, WHO_OPTIONS, type Who } from './puzzle';

const collider = (e: Entity): Collider | undefined => e.get<Collider>(C.Collider);
const sprite = (e: Entity): Sprite | undefined => e.get<Sprite>(C.Sprite);
const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

// ---------- spawner ----------

export interface Spawner {
  /** Name of the prefab to create. */
  prefab: string;
  /** Create one every this many seconds (0 = only when the signal arrives). */
  everySeconds: number;
  /** Create one when the game starts. */
  onStart: boolean;
  /** Stop creating while this many are alive (0 = no limit). */
  max: number;
  offsetX: number;
  offsetY: number;
}

export const spawner = defineBehavior<Spawner>({
  id: 'spawner',
  name: 'Spawner',
  category: 'World',
  description: 'Creates copies of a prefab, on a timer and/or each time its Spawn signal turns on.',
  phase: 'actuator',
  defaults: { prefab: '', everySeconds: 0, onStart: false, max: 0, offsetX: 0, offsetY: 0 },
  fields: [
    { key: 'prefab', label: 'What to create', type: 'prefab' },
    { key: 'everySeconds', label: 'Every how many seconds (0 = only on the signal)', type: 'number', min: 0, max: 600, step: 0.1 },
    { key: 'onStart', label: 'Create one when the game starts', type: 'boolean' },
    { key: 'max', label: 'Most alive at once (0 = no limit)', type: 'number', min: 0, max: 99, step: 1 },
    { key: 'offsetX', label: 'Shift X (cells)', type: 'number', min: -10, max: 10, step: 0.5 },
    { key: 'offsetY', label: 'Shift Y (cells)', type: 'number', min: -10, max: 10, step: 0.5 },
  ],
  inputs: [{ name: 'spawn', label: 'Spawn', help: 'A rising signal creates one.' }],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const st = stateOf(e, 'spawner', () => ({ prev: false, sinceLast: 0, count: 0, spawned: [] as number[], started: false }));
    st.spawned = st.spawned.filter((id) => ctx.world.get(id) !== undefined);
    let want = false;
    const sig = input(e, 'spawn');
    if (sig && !st.prev) want = true;
    st.prev = sig;
    if (!st.started) {
      st.started = true;
      if (s.onStart) want = true;
    }
    if (s.everySeconds > 0) {
      st.sinceLast += ctx.dt;
      if (st.sinceLast >= s.everySeconds) {
        st.sinceLast = 0;
        want = true;
      }
    }
    if (!want || !s.prefab) return;
    if (s.max > 0 && st.spawned.length >= s.max) return;
    const prefab = ctx.assets.prefabs.get(s.prefab);
    if (!prefab) {
      ctx.events.emit('problem', { entity: e.id, text: `The spawner "${e.name}" uses the prefab "${s.prefab}", which does not exist.` });
      return;
    }
    const t = transform(e);
    const sceneId = `${e.get<{ sceneId: string }>('meta')?.sceneId ?? e.id}#${++st.count}`;
    const { entities } = expandEntities([{ id: sceneId, name: prefab.name, tags: [], prefab: prefab.name, components: { transform: { x: t.x + s.offsetX, y: t.y + s.offsetY, h: t.h } } }], ctx.assets.prefabs);
    for (const data of entities) {
      const made = instantiate(ctx, data);
      if (data.id === sceneId) st.spawned.push(made.id);
    }
    ctx.events.emit('spawned', { spawner: e.id, entity: st.spawned.at(-1) });
  },
});

/** Create a copy of a prefab at a spot (boss helpers, projectiles). Returns null, with a problem message, if the prefab is missing. */
export function spawnPrefabAt(ctx: SimContext, by: Entity, prefabName: string, x: number, y: number, h: number, key: string): Entity | null {
  const prefab = ctx.assets.prefabs.get(prefabName);
  if (!prefab) {
    ctx.events.emit('problem', { entity: by.id, text: `"${by.name}" wants to create the prefab "${prefabName}", which does not exist.` });
    return null;
  }
  const sceneId = `${by.get<{ sceneId: string }>('meta')?.sceneId ?? by.id}#${key}-${ctx.tick}`;
  const { entities } = expandEntities([{ id: sceneId, name: prefab.name, tags: [], prefab: prefab.name, components: { transform: { x, y, h } } }], ctx.assets.prefabs);
  let root: Entity | null = null;
  for (const data of entities) {
    const made = instantiate(ctx, data);
    if (data.id === sceneId) root = made;
  }
  return root;
}

function instantiate(ctx: SimContext, data: Parameters<typeof instantiateEntity>[1]): Entity {
  const entity = ctx.world.spawn({ name: data.name, tags: data.tags, components: structuredClone(data.components) });
  entity.set('meta', { sceneId: data.id });
  ctx.runtime.ids.set(data.id, entity.id);
  const c = entity.get<{ inside?: number[] }>(C.Collider);
  if (c) c.inside = [];
  return entity;
}

// ---------- pickup ----------

export interface Pickup {
  who: Who;
  /** Variable to add to when picked up (created if missing). */
  variable: string;
  amount: number;
  /** Text to show when picked up. */
  message: string;
}

export const pickup = defineBehavior<Pickup>({
  id: 'pickup',
  name: 'Pickup',
  category: 'World',
  description: 'Disappears when the player touches it and adds to a counter (coins, keys, gems...).',
  phase: 'actuator',
  defaults: { who: 'player', variable: 'coins', amount: 1, message: '' },
  fields: [
    { key: 'who', label: 'Picked up by', type: 'select', options: WHO_OPTIONS },
    { key: 'variable', label: 'Counter to add to', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number', min: -999, max: 999, step: 1 },
    { key: 'message', label: 'Message to show', type: 'text' },
  ],
  inputs: [],
  outputs: [],
  requires: { collider: { w: 0.8, d: 0.8, height: 0.8, solid: false, trigger: true, layer: 1, mask: 65535, enabled: true, inside: [] } },
  update(ctx, e, s) {
    const c = collider(e);
    if (!c) return;
    const hit = c.inside.map((id) => ctx.world.get(id)).find((o) => o && matchesWho(o, s.who));
    if (!hit) return;
    if (s.variable) {
      const cur = ctx.runtime.vars[s.variable];
      ctx.runtime.vars[s.variable] = (typeof cur === 'number' ? cur : 0) + s.amount;
    }
    if (s.message) ctx.events.emit('message', { text: s.message });
    ctx.events.emit('pickup', { entity: e.id, by: hit.id, variable: s.variable, amount: s.amount });
    ctx.world.destroy(e);
  },
});

// ---------- moving platform ----------

export interface MovingPlatform {
  /** How far it travels from where you placed it (cells; height in levels). */
  dx: number;
  dy: number;
  dh: number;
  speed: number;
  /** Seconds it rests at each end. */
  pause: number;
  /** Only moves while its Go signal is on (if it has no wire it always moves). */
  needsSignal: boolean;
}

export const movingPlatform = defineBehavior<MovingPlatform>({
  id: 'movingPlatform',
  name: 'Moving Platform',
  category: 'World',
  description: 'A solid platform that travels back and forth and carries whatever stands on it.',
  phase: 'control',
  defaults: { dx: 4, dy: 0, dh: 0, speed: 1.5, pause: 0.5, needsSignal: false },
  fields: [
    { key: 'dx', label: 'Travel in X (cells)', type: 'number', min: -32, max: 32, step: 0.5 },
    { key: 'dy', label: 'Travel in Y (cells)', type: 'number', min: -32, max: 32, step: 0.5 },
    { key: 'dh', label: 'Travel up (levels)', type: 'number', min: -12, max: 12, step: 0.5 },
    { key: 'speed', label: 'Speed (cells per second)', type: 'number', min: 0.1, max: 20, step: 0.1 },
    { key: 'pause', label: 'Rest at each end (seconds)', type: 'number', min: 0, max: 30, step: 0.1 },
    { key: 'needsSignal', label: 'Only moves while Go is on', type: 'boolean' },
  ],
  inputs: [{ name: 'go', label: 'Go' }],
  outputs: [],
  requires: { collider: { w: 1.5, d: 1.5, height: 0.3, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } },
  update(ctx, e, s) {
    const t = transform(e);
    const st = stateOf(e, 'movingPlatform', () => ({ ox: t.x, oy: t.y, oh: t.h, k: 0, dir: 1, wait: 0 }));
    if (s.needsSignal && !input(e, 'go')) return;
    const length = Math.hypot(s.dx, s.dy, s.dh * 0.5);
    if (length === 0) return;
    if (st.wait > 0) {
      st.wait = Math.max(0, st.wait - ctx.dt);
      return;
    }
    const px = t.x;
    const py = t.y;
    const ph = t.h;
    st.k += (st.dir * s.speed * ctx.dt) / length;
    if (st.k >= 1 || st.k <= 0) {
      st.k = Math.max(0, Math.min(1, st.k));
      st.dir = -st.dir;
      st.wait = s.pause;
    }
    t.x = st.ox + s.dx * st.k;
    t.y = st.oy + s.dy * st.k;
    t.h = st.oh + s.dh * st.k;
    // carry the riders
    const [mx, my, mh] = [t.x - px, t.y - py, t.h - ph];
    for (const r of ctx.world.query(C.Transform, C.Body)) {
      const b = r.require<Body>(C.Body);
      if (b.standingOn !== e.id) continue;
      const rt = transform(r);
      rt.x += mx;
      rt.y += my;
      rt.h += mh;
    }
  },
});

// ---------- falling floor ----------

export interface FallingFloor {
  /** Seconds after someone steps on it before it drops. */
  delay: number;
  /** Comes back after this many seconds (0 = never). */
  respawnAfter: number;
}

export const fallingFloor = defineBehavior<FallingFloor>({
  id: 'fallingFloor',
  name: 'Falling Floor',
  category: 'World',
  description: 'A platform that crumbles shortly after something stands on it, and comes back later.',
  phase: 'actuator',
  defaults: { delay: 0.6, respawnAfter: 3 },
  fields: [
    { key: 'delay', label: 'Seconds before it drops', type: 'number', min: 0, max: 10, step: 0.1 },
    { key: 'respawnAfter', label: 'Comes back after (seconds, 0 = never)', type: 'number', min: 0, max: 60, step: 0.5 },
  ],
  inputs: [],
  outputs: [{ name: 'fallen', label: 'Has dropped' }],
  requires: { collider: { w: 1, d: 1, height: 0.3, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } },
  update(ctx, e, s) {
    const st = stateOf(e, 'fallingFloor', () => ({ phase: 'solid' as 'solid' | 'crumbling' | 'gone', timer: 0 }));
    const c = collider(e);
    const sp = sprite(e);
    const stood = ctx.world.query(C.Body).some((b) => b.require<Body>(C.Body).standingOn === e.id);
    if (st.phase === 'solid' && stood) {
      st.phase = 'crumbling';
      st.timer = s.delay;
    } else if (st.phase === 'crumbling') {
      st.timer -= ctx.dt;
      if (sp) sp.visible = Math.floor(st.timer * 20) % 2 === 0; // shiver
      if (st.timer <= 0) {
        st.phase = 'gone';
        st.timer = s.respawnAfter;
        if (c) c.enabled = false;
        if (sp) sp.visible = false;
        ctx.events.emit('floor-fell', { entity: e.id });
      }
    } else if (st.phase === 'gone' && s.respawnAfter > 0) {
      st.timer -= ctx.dt;
      if (st.timer <= 0) {
        st.phase = 'solid';
        if (c) c.enabled = true;
        if (sp) sp.visible = true;
      }
    }
    setOutput(e, 'fallen', st.phase === 'gone');
  },
});

// ---------- projectile ----------

export interface Projectile {
  speed: number;
  /** Seconds before it disappears. */
  lifetime: number;
  /** Direction in cells per tick is taken from the object's facing unless set here. */
  useFacing: boolean;
  dirX: number;
  dirY: number;
}

const FACING_DIRS: [number, number][] = [[1, -1], [1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1]];

export const projectile = defineBehavior<Projectile>({
  id: 'projectile',
  name: 'Projectile',
  category: 'World',
  description: 'Flies in a straight line and disappears when it hits a wall or a solid object (or runs out of time), announcing the hit.',
  phase: 'control',
  defaults: { speed: 8, lifetime: 3, useFacing: true, dirX: 1, dirY: 0 },
  fields: [
    { key: 'speed', label: 'Speed (cells per second)', type: 'number', min: 0.5, max: 40, step: 0.5 },
    { key: 'lifetime', label: 'Seconds before it vanishes', type: 'number', min: 0.1, max: 60, step: 0.1 },
    { key: 'useFacing', label: 'Fly the way the object faces', type: 'boolean' },
    { key: 'dirX', label: 'Direction X', type: 'number', min: -1, max: 1, step: 0.1 },
    { key: 'dirY', label: 'Direction Y', type: 'number', min: -1, max: 1, step: 0.1 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const t = transform(e);
    const st = stateOf(e, 'projectile', () => ({ age: 0 }));
    st.age += ctx.dt;
    if (st.age >= s.lifetime) {
      ctx.world.destroy(e);
      return;
    }
    let [dx, dy] = s.useFacing ? FACING_DIRS[((t.facing % 8) + 8) % 8]! : [s.dirX, s.dirY];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    const nx = t.x + dx * s.speed * ctx.dt;
    const ny = t.y + dy * s.speed * ctx.dt;
    const map = ctx.map;
    if (map) {
      const surf = surfaceAt(map, nx, ny, t.h, { stepUp: 0.6, bodyHeight: 0.5 });
      if (surf.kind === 'void' || surf.kind === 'solid' || (surf.kind !== 'pit' && surf.z - t.h > 0.6)) {
        ctx.events.emit('projectile-hit', { entity: e.id, other: null });
        ctx.world.destroy(e);
        return;
      }
    }
    for (const o of ctx.world.query(C.Transform, C.Collider)) {
      if (o === e) continue;
      const oc = collider(o)!;
      if (!oc.solid || !oc.enabled) continue;
      const ot = transform(o);
      if (Math.abs(nx - ot.x) < oc.w / 2 && Math.abs(ny - ot.y) < oc.d / 2 && t.h < ot.h + oc.height && t.h + 0.5 > ot.h) {
        ctx.events.emit('projectile-hit', { entity: e.id, other: o.id });
        ctx.world.destroy(e);
        return;
      }
    }
    t.x = nx;
    t.y = ny;
  },
});

// ---------- follow camera ----------

export interface FollowCamera {
  deadzoneW: number;
  deadzoneH: number;
  smoothing: number;
  zoom: number;
}

export const followCamera = defineBehavior<FollowCamera>({
  id: 'followCamera',
  name: 'Follow Camera',
  category: 'World',
  description: 'The camera follows this object. (With none in the scene it follows the player.)',
  phase: 'control',
  defaults: { deadzoneW: 50, deadzoneH: 30, smoothing: 0.2, zoom: 1 },
  fields: [
    { key: 'deadzoneW', label: 'Dead zone width (pixels)', type: 'number', min: 0, max: 400, step: 5 },
    { key: 'deadzoneH', label: 'Dead zone height (pixels)', type: 'number', min: 0, max: 400, step: 5 },
    { key: 'smoothing', label: 'Smoothing (1 = snap, small = lazy)', type: 'number', min: 0.02, max: 1, step: 0.02 },
    { key: 'zoom', label: 'Zoom', type: 'number', min: 0.25, max: 4, step: 0.05 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update() {
    /* The game's camera reads these settings; nothing to do per tick. */
  },
});
