import {
  C,
  blockersBetween,
  facingOfGridDir,
  lineClear,
  lightLevel,
  makeOccluder,
  type Body,
  type Cell2,
  type Entity,
  type LightingModel,
  type TransformIso,
} from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { setOutput } from '../signals';
import { aiFlags, facingVector, healthOf } from './combat';
import { spawnPrefabAt } from './world';
import { newNav, parsePoints, steerTo, type NavState } from '../nav';

const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);
const body = (e: Entity): Body | undefined => e.get<Body>(C.Body);

// ---------- vision ----------

export interface Vision {
  range: number;
  /** Full width of the cone in degrees. */
  angle: number;
  /** How far it hears footsteps (cells); running is louder. */
  hearing: number;
  /** Each wall between it and the footsteps counts as this many extra cells of distance. */
  muffle: number;
  /** Tag of what it looks for. */
  target: string;
  /** In the dark it only sees things this close. */
  closeRange: number;
  /** How bright a spot must be to see into it (0..1). */
  darkThreshold: number;
}

export interface VisionState {
  /** Entity currently seen, or null. */
  seen: number | null;
  heard: boolean;
  /** Where the target was last seen or heard. */
  last: Cell2 | null;
}

export const vision = defineBehavior<Vision>({
  id: 'vision',
  name: 'Vision Cone',
  category: 'AI',
  description: 'Sees things in front of it, within a distance and a cone. Walls block its view, and it cannot see far into the dark. It also hears footsteps nearby. Chase uses this to notice you.',
  phase: 'source',
  defaults: { range: 6, angle: 100, hearing: 3, muffle: 3, target: 'player', closeRange: 1.3, darkThreshold: 0.3 },
  fields: [
    { key: 'range', label: 'How far it sees (cells)', type: 'number', min: 1, max: 30, step: 0.5 },
    { key: 'angle', label: 'Width of the view (degrees)', type: 'number', min: 10, max: 360, step: 5 },
    { key: 'hearing', label: 'How far it hears footsteps (cells)', type: 'number', min: 0, max: 20, step: 0.5 },
    { key: 'muffle', label: 'Each wall in the way muffles footsteps by (cells)', type: 'number', min: 0, max: 20, step: 0.5, help: 'Walls between it and the footsteps count as extra distance, so a guard does not hear you through a thick wall. 0 = walls do not matter.' },
    { key: 'target', label: 'Looks for things tagged', type: 'text' },
    { key: 'closeRange', label: 'Always notices within (cells), even in the dark', type: 'number', min: 0, max: 5, step: 0.1 },
    { key: 'darkThreshold', label: 'Cannot see where it is darker than', type: 'number', min: 0, max: 1, step: 0.05 },
  ],
  inputs: [],
  outputs: [
    { name: 'seen', label: 'Sees its target' },
    { name: 'heard', label: 'Hears its target' },
  ],
  requires: {},
  summary: (s) => `Sees ${s.range} cells ahead in a ${s.angle} degree cone, hears ${s.hearing} cells around.`,
  update(ctx, e, s) {
    const st = stateOf<VisionState>(e, 'vision', () => ({ seen: null, heard: false, last: null }));
    st.seen = null;
    st.heard = false;
    if (aiFlags(e).disabled || (e.get<{ dead: boolean }>('state:health')?.dead ?? false)) {
      setOutput(e, 'seen', false);
      setOutput(e, 'heard', false);
      return;
    }
    const t = transform(e);
    const model: LightingModel = ctx.runtime.lighting ?? { regions: [], sceneDarkness: 0, lights: [], blocked: makeOccluder(ctx.map, []) };
    const f = facingVector(t.facing);
    const half = Math.cos((s.angle / 2) * (Math.PI / 180));
    let best: { e: Entity; d: number } | null = null;
    for (const o of ctx.world.withTag(s.target)) {
      const ot = o.get<TransformIso>(C.Transform);
      if (!ot || o === e) continue;
      if ((o.get<{ dead: boolean }>('state:health')?.dead ?? false)) continue;
      const dx = ot.x - t.x;
      const dy = ot.y - t.y;
      const d = Math.hypot(dx, dy);
      if (Math.abs(ot.h - t.h) > 2.5) continue;
      // hearing: footsteps within earshot, louder when running
      const ob = body(o);
      const moving = ob ? Math.hypot(ob.vx, ob.vy) : 0;
      if (moving > 0.5) {
        const noise = s.hearing * (moving > 5 ? 1.5 : 1);
        if (d + blockersBetween(model, t.x, t.y, ot.x, ot.y, t.h + 0.5) * s.muffle <= noise) {
          st.heard = true;
          st.last = { x: ot.x, y: ot.y };
        }
      }
      if (d > s.range) continue;
      const close = d <= s.closeRange;
      if (!close && d > 0.001 && (dx * f.x + dy * f.y) / d < half) continue;
      if (!lineClear(model, t.x, t.y, ot.x, ot.y, t.h + 0.5)) continue;
      if (!close && lightLevel(model, ot.x, ot.y, ot.h) < s.darkThreshold) continue;
      if (!best || d < best.d) best = { e: o, d };
    }
    if (best) {
      st.seen = best.e.id;
      const bt = transform(best.e);
      st.last = { x: bt.x, y: bt.y };
    }
    setOutput(e, 'seen', st.seen !== null);
    setOutput(e, 'heard', st.heard);
  },
});

// ---------- chase ----------

export interface Chase {
  speed: number;
  /** Seconds it looks around where it lost you. */
  searchSeconds: number;
  /** Stops this close to its target (cells). */
  stopDistance: number;
  /** Walks back to where it started when it gives up. */
  returnHome: boolean;
}

type ChaseMode = 'idle' | 'chase' | 'search' | 'return';

interface ChaseState {
  mode: ChaseMode;
  timer: number;
  home: Cell2 | null;
  nav: NavState;
  lookTimer: number;
}

export const chase = defineBehavior<Chase>({
  id: 'chase',
  timing: 'realtime',
  name: 'Chase',
  category: 'AI',
  description:
    'When its Vision Cone sees or hears the target it chases it (around walls and over stairs), then searches where it was last seen, then returns to where it started. Combine with Patrol for a guard and with Damage on Touch so it can hurt.',
  phase: 'control',
  defaults: { speed: 3.2, searchSeconds: 3, stopDistance: 0.7, returnHome: true },
  fields: [
    { key: 'speed', label: 'Chase speed (cells per second)', type: 'number', min: 0.5, max: 15, step: 0.1 },
    { key: 'searchSeconds', label: 'Looks around for (seconds)', type: 'number', min: 0, max: 30, step: 0.5 },
    { key: 'stopDistance', label: 'Stops this close to its target (cells)', type: 'number', min: 0, max: 5, step: 0.1 },
    { key: 'returnHome', label: 'Goes back to where it started afterwards', type: 'boolean' },
  ],
  inputs: [],
  outputs: [
    { name: 'alert', label: 'Is chasing or searching' },
    { name: 'chasing', label: 'Is chasing' },
  ],
  requires: { vision: { range: 6, angle: 100, hearing: 3, muffle: 3, target: 'player', closeRange: 1.3, darkThreshold: 0.3 } },
  summary: (s) => `Chases at ${s.speed} cells per second, searches ${s.searchSeconds} s${s.returnHome ? ', then goes back' : ''}.`,
  update(ctx, e, s) {
    const st = stateOf<ChaseState>(e, 'chase', () => ({ mode: 'idle', timer: 0, home: null, nav: newNav(), lookTimer: 0 }));
    const flags = aiFlags(e);
    const t = transform(e);
    const b = body(e);
    if (!st.home) st.home = { x: t.x, y: t.y };
    const dead = e.get<{ dead: boolean }>('state:health')?.dead ?? false;
    if (!b || flags.disabled || dead) {
      st.mode = 'idle';
      flags.busy = false;
      setOutput(e, 'alert', false);
      setOutput(e, 'chasing', false);
      if (b && (flags.disabled || dead)) b.vx = b.vy = 0;
      return;
    }
    const vis = e.get<VisionState>('state:vision');
    const noticed = vis !== undefined && (vis.seen !== null || vis.heard);
    const speed = s.speed * flags.speedScale;

    if (noticed && st.mode !== 'chase') {
      st.mode = 'chase';
      ctx.events.emit('noticed', { entity: e.id, target: vis!.seen ?? undefined });
    } else if (noticed) st.mode = 'chase';

    switch (st.mode) {
      case 'chase': {
        const goal = vis?.last;
        if (!goal) {
          st.mode = 'search';
          st.timer = s.searchSeconds;
          break;
        }
        const target = vis!.seen !== null ? ctx.world.get(vis!.seen) : undefined;
        const near = target ? Math.hypot(transform(target).x - t.x, transform(target).y - t.y) <= s.stopDistance : false;
        if (near) {
          b.vx = b.vy = 0;
          if (target) {
            const tt = transform(target);
            t.facing = facingOfGridDir(tt.x - t.x, tt.y - t.y);
          }
          break;
        }
        const r = steerTo(ctx, e, goal, speed, st.nav);
        if (r !== 'moving' && vis!.seen === null) {
          st.mode = 'search';
          st.timer = s.searchSeconds;
          st.lookTimer = 0;
          b.vx = b.vy = 0;
        }
        break;
      }
      case 'search': {
        b.vx = b.vy = 0;
        st.timer -= ctx.dt;
        st.lookTimer -= ctx.dt;
        if (st.lookTimer <= 0) {
          st.lookTimer = 0.6;
          t.facing = (t.facing + 1) % 8; // turn on the spot, scanning
        }
        if (st.timer <= 0) {
          st.mode = s.returnHome ? 'return' : 'idle';
          ctx.events.emit('lost', { entity: e.id });
        }
        break;
      }
      case 'return': {
        const r = steerTo(ctx, e, st.home, speed * 0.7, st.nav);
        if (r !== 'moving') st.mode = 'idle';
        break;
      }
      default:
        break;
    }
    flags.busy = st.mode !== 'idle';
    setOutput(e, 'alert', st.mode === 'chase' || st.mode === 'search');
    setOutput(e, 'chasing', st.mode === 'chase');
    if (st.mode === 'idle' && !e.has('patrol')) b.vx = b.vy = 0;
  },
});

// ---------- patrol ----------

export interface Patrol {
  /** Waypoints as "x,y; x,y" in cells (x.5 is the middle of a cell). Use the Patrol path tool to draw them. */
  points: string;
  mode: 'loop' | 'pingpong';
  speed: number;
  waitSeconds: number;
}

interface PatrolState {
  i: number;
  dir: 1 | -1;
  wait: number;
  nav: NavState;
}

export const patrol = defineBehavior<Patrol>({
  id: 'patrol',
  timing: 'realtime',
  name: 'Patrol',
  category: 'AI',
  description: 'Walks between waypoints, pausing at each. Draw the route with the Patrol path tool. It stays out of the way while Chase is steering.',
  phase: 'control',
  defaults: { points: '', mode: 'loop', speed: 1.8, waitSeconds: 0.8 },
  fields: [
    { key: 'points', label: 'Route (x,y; x,y; ...)', type: 'text', help: 'Easier: pick this object and use the Patrol path tool to click the route on the map.' },
    {
      key: 'mode',
      label: 'At the end of the route',
      type: 'select',
      options: [
        { value: 'loop', label: 'Go back to the first point' },
        { value: 'pingpong', label: 'Walk back the way it came' },
      ],
    },
    { key: 'speed', label: 'Speed (cells per second)', type: 'number', min: 0.2, max: 10, step: 0.1 },
    { key: 'waitSeconds', label: 'Pause at each point (seconds)', type: 'number', min: 0, max: 30, step: 0.1 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => {
    const n = parsePoints(s.points).length;
    return n < 2 ? 'Needs at least two points to walk between.' : `Walks ${n} points, ${s.mode === 'loop' ? 'looping' : 'back and forth'}.`;
  },
  update(ctx, e, s) {
    const flags = aiFlags(e);
    const b = body(e);
    if (!b || flags.busy || flags.disabled) return;
    if (e.get<{ dead: boolean }>('state:health')?.dead) return;
    const pts = parsePoints(s.points);
    if (pts.length < 2) return;
    const st = stateOf<PatrolState>(e, 'patrol', () => ({ i: 0, dir: 1, wait: 0, nav: newNav() }));
    if (st.wait > 0) {
      st.wait -= ctx.dt;
      b.vx = b.vy = 0;
      return;
    }
    const target = pts[Math.min(st.i, pts.length - 1)]!;
    const r = steerTo(ctx, e, target, s.speed * flags.speedScale, st.nav, 0.15);
    if (r === 'arrived' || r === 'stuck') {
      st.wait = r === 'stuck' ? 1 : s.waitSeconds;
      if (s.mode === 'loop') st.i = (st.i + 1) % pts.length;
      else {
        if (st.i + st.dir >= pts.length || st.i + st.dir < 0) st.dir = st.dir === 1 ? -1 : 1;
        st.i += st.dir;
      }
      st.nav = newNav();
    }
  },
});

// ---------- boss phases ----------

export interface BossPhases {
  /** Phase 2 starts when health falls to this percentage. */
  phase2At: number;
  phase3At: number;
  /** Each new phase moves this many times faster. */
  speedUp: number;
  /** ... and hits this many times harder. */
  damageUp: number;
  /** Only acts while the player is inside the region that contains it and is marked "Bosses here only act while the player is inside". */
  onlyInRoom: boolean;
  /** Prefab created next to the boss at the start of each new phase (optional). */
  summonPrefab: string;
  summonCount: number;
}

interface BossState {
  phase: number;
  defeated: boolean;
}

export const bossPhases = defineBehavior<BossPhases>({
  id: 'bossPhases',
  timing: 'realtime',
  name: 'Boss Phases',
  category: 'AI',
  description:
    'Turns an enemy into a boss: it gets faster and harder-hitting as its health runs down, can call in helpers at each phase, and only fights while the player is in its room. Wire its signals to doors: "Phase 2", "Phase 3", "Defeated".',
  phase: 'control',
  defaults: { phase2At: 60, phase3At: 25, speedUp: 1.3, damageUp: 1.25, onlyInRoom: true, summonPrefab: '', summonCount: 1 },
  fields: [
    { key: 'phase2At', label: 'Phase 2 starts at health (%)', type: 'number', min: 1, max: 99, step: 1 },
    { key: 'phase3At', label: 'Phase 3 starts at health (%)', type: 'number', min: 1, max: 98, step: 1 },
    { key: 'speedUp', label: 'Faster each phase (times)', type: 'number', min: 1, max: 3, step: 0.05 },
    { key: 'damageUp', label: 'Stronger each phase (times)', type: 'number', min: 1, max: 5, step: 0.05 },
    { key: 'onlyInRoom', label: 'Only fights while the player is in its room', type: 'boolean' },
    { key: 'summonPrefab', label: 'Calls in helpers each phase (prefab)', type: 'prefab' },
    { key: 'summonCount', label: 'How many helpers', type: 'number', min: 1, max: 6, step: 1 },
  ],
  inputs: [],
  outputs: [
    { name: 'active', label: 'Is fighting' },
    { name: 'phase2', label: 'Phase 2 or later' },
    { name: 'phase3', label: 'Phase 3' },
    { name: 'defeated', label: 'Defeated' },
  ],
  requires: { health: { max: 12, invulnerableSeconds: 0.5, onDeath: 'stay', fallDamage: 0, team: 'enemy', showBar: true } },
  summary: (s) => `Phase 2 at ${s.phase2At}% health, phase 3 at ${s.phase3At}%.`,
  update(ctx, e, s) {
    const st = stateOf<BossState>(e, 'boss', () => ({ phase: 1, defeated: false }));
    const flags = aiFlags(e);
    const t = transform(e);
    const h = healthOf(e);

    // only acts in its room
    let active = true;
    if (s.onlyInRoom) {
      const room = ctx.runtime.regions.find((r) => r.bossActive && t.x >= r.x && t.x < r.x + r.w && t.y >= r.y && t.y < r.y + r.h);
      if (room) {
        const p = ctx.world.withTag('player')[0]?.get<TransformIso>(C.Transform);
        active = !!p && p.x >= room.x && p.x < room.x + room.w && p.y >= room.y && p.y < room.y + room.h;
      }
    }
    if (h?.dead) active = false;
    flags.disabled = !active;

    if (h && !h.dead) {
      const pct = (h.hp / h.max) * 100;
      const phase = pct <= s.phase3At ? 3 : pct <= s.phase2At ? 2 : 1;
      if (phase > st.phase) {
        st.phase = phase;
        flags.speedScale = Math.pow(s.speedUp, phase - 1);
        flags.damageScale = Math.pow(s.damageUp, phase - 1);
        ctx.events.emit('boss-phase', { entity: e.id, phase });
        ctx.events.emit('message', { text: ctx.assets.strings.fmt('{name} gets angry!', { name: e.name }) });
        if (s.summonPrefab) {
          for (let i = 0; i < s.summonCount; i++) {
            const a = (i / s.summonCount) * Math.PI * 2;
            spawnPrefabAt(ctx, e, s.summonPrefab, t.x + Math.cos(a) * 1.5, t.y + Math.sin(a) * 1.5, t.h, `boss${phase}-${i}`);
          }
        }
      }
    }
    if (h?.dead && !st.defeated) {
      st.defeated = true;
      ctx.events.emit('boss-defeated', { entity: e.id });
      ctx.events.emit('message', { text: ctx.assets.strings.fmt('{name} is defeated!', { name: e.name }) });
    }
    setOutput(e, 'active', active);
    setOutput(e, 'phase2', st.phase >= 2);
    setOutput(e, 'phase3', st.phase >= 3);
    setOutput(e, 'defeated', st.defeated);
  },
});
