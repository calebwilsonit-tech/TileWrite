import { C, emitFx, facingOfGridDir, lineClear, makeOccluder, type Body, type Entity, type LightingModel, type SimContext, type TransformIso } from '@tilewright/runtime';
import { attachBehavior, defineBehavior, stateOf } from '../framework';
import { aiFlags } from './combat';
import { spawnPrefabAt } from './world';

const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

/**
 * Ranged attacks for enemies and bosses: wait for a target in range (and in sight), wind up, then shoot one or several
 * projectiles at it. The projectile is a copy of a prefab, or a plain glowing ball when none is named.
 */
export interface RangedAttack {
  /** Tag of what it shoots at. */
  target: string;
  /** Shoots at targets up to this far away (cells). */
  range: number;
  /** Does not shoot at targets closer than this (cells). */
  minRange: number;
  /** Seconds between volleys. */
  cooldown: number;
  /** Seconds it stands still taking aim before the first shot. */
  windup: number;
  /** Shots in one volley. */
  volley: number;
  /** Seconds between the shots of a volley. */
  volleyGap: number;
  speed: number;
  damage: number;
  /** Seconds a shot flies before it vanishes. */
  lifetime: number;
  /** Only shoots when no wall is in the way. */
  needSight: boolean;
  /** Prefab to shoot ('' = a plain ball). A prefab should have the Projectile behaviour. */
  prefab: string;
  /** Sound played at each shot ('' = none). */
  sound: string;
  /** Colour of the plain ball. */
  color: number;
  /** Whose side its shots hurt: the player's side (what enemies do), the enemy side (what a tower does) or anything. */
  hurts: 'player' | 'enemy' | 'anything';
}

interface RangedState {
  phase: 'idle' | 'windup' | 'volley';
  t: number;
  cool: number;
  shotsLeft: number;
  gap: number;
}

function nearestTarget(ctx: SimContext, e: Entity, tag: string): { e: Entity; d: number; x: number; y: number; h: number } | null {
  const t = transform(e);
  let best: { e: Entity; d: number; x: number; y: number; h: number } | null = null;
  for (const o of ctx.world.withTag(tag)) {
    if (o === e || !o.alive || (o.get<{ dead: boolean }>('state:health')?.dead ?? false)) continue;
    const ot = o.get<TransformIso>(C.Transform);
    if (!ot) continue;
    const d = Math.hypot(ot.x - t.x, ot.y - t.y);
    if (!best || d < best.d) best = { e: o, d, x: ot.x, y: ot.y, h: ot.h };
  }
  return best;
}

/** Make a shot flying from the shooter towards (dx, dy). */
function fire(ctx: SimContext, e: Entity, s: RangedAttack, dx: number, dy: number, dh: number): Entity | null {
  const t = transform(e);
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  const x = t.x + ux * 0.5;
  const y = t.y + uy * 0.5;
  const h = t.h + 0.6;
  // a target on another level: the shot climbs or sinks so it arrives at the target's height
  const climb = dh / Math.max(0.2, Math.hypot(dx, dy) / Math.max(0.1, s.speed));
  let shot: Entity | null;
  if (s.prefab) {
    shot = spawnPrefabAt(ctx, e, s.prefab, x, y, h, 'shot');
    if (!shot) return null;
    const p = shot.get<Record<string, unknown>>('projectile');
    if (p) Object.assign(p, { useFacing: false, dirX: ux, dirY: uy, speed: s.speed, lifetime: s.lifetime, dirZ: climb, ...(s.hurts !== 'player' ? { hurts: s.hurts } : {}), ...(s.damage > 0 && !(typeof p.damage === 'number' && p.damage > 0) ? { damage: s.damage } : {}) });
    else ctx.events.emit('problem', { entity: e.id, text: `"${e.name}" shoots the prefab "${s.prefab}", which does not have the Projectile behaviour, so it will not fly.` });
  } else {
    const components: Record<string, unknown> = {
      transform: { x, y, h, facing: facingOfGridDir(dx, dy) },
      sprite: { shape: 'ellipse', color: s.color, w: 0.3, d: 0.3, height: 0.3, sortOffset: 0, visible: true },
    };
    attachBehavior(components, 'projectile');
    Object.assign(components.projectile as object, { useFacing: false, dirX: ux, dirY: uy, dirZ: climb, speed: s.speed, lifetime: s.lifetime, damage: s.damage, hurts: s.hurts, knockback: 5 });
    shot = ctx.world.spawn({ name: 'Shot', tags: ['projectile'], components });
    shot.set('meta', { sceneId: `${e.get<{ sceneId: string }>('meta')?.sceneId ?? e.id}#shot-${ctx.tick}` });
  }
  const state = shot.get<{ age: number; owner: number | null }>('state:projectile') ?? { age: 0, owner: null };
  state.owner = e.id;
  shot.set('state:projectile', state);
  ctx.events.emit('shot', { entity: e.id, projectile: shot.id });
  if (s.sound) emitFx(ctx.runtime, { kind: 'sound', name: s.sound, at: { x, y, near: 2, far: 16 } });
  return shot;
}

export const rangedAttack = defineBehavior<RangedAttack>({
  id: 'rangedAttack',
  timing: 'realtime',
  name: 'Ranged Attack',
  category: 'Combat',
  description:
    'Shoots at its target from a distance: when the target is in range (and nothing blocks the way) it stands still for a moment taking aim, then fires one shot or a quick volley, then waits before the next. A shot is a plain glowing ball, or a copy of a prefab with the Projectile behaviour. Combine with Patrol, Chase or a State Machine; a State Machine state can switch it on and off.',
  phase: 'actuator',
  defaults: { target: 'player', range: 8, minRange: 0, cooldown: 2, windup: 0.4, volley: 1, volleyGap: 0.15, speed: 7, damage: 1, lifetime: 2.5, needSight: true, prefab: '', sound: '', color: 0xff9a3c, hurts: 'player' },
  fields: [
    { key: 'target', label: 'Shoots at things tagged', type: 'text' },
    { key: 'range', label: 'Shoots up to (cells)', type: 'number', min: 1, max: 30, step: 0.5 },
    { key: 'minRange', label: 'Does not shoot closer than (cells)', type: 'number', min: 0, max: 20, step: 0.5 },
    { key: 'cooldown', label: 'Seconds between volleys', type: 'number', min: 0.1, max: 30, step: 0.1 },
    { key: 'windup', label: 'Seconds taking aim first', type: 'number', min: 0, max: 5, step: 0.05 },
    { key: 'volley', label: 'Shots in a volley', type: 'number', min: 1, max: 8, step: 1 },
    { key: 'volleyGap', label: 'Seconds between the shots of a volley', type: 'number', min: 0.03, max: 2, step: 0.01 },
    { key: 'speed', label: 'Shot speed (cells per second)', type: 'number', min: 1, max: 30, step: 0.5 },
    { key: 'damage', label: 'Damage of a shot', type: 'number', min: 0, max: 99, step: 1 },
    { key: 'lifetime', label: 'Seconds a shot flies', type: 'number', min: 0.2, max: 20, step: 0.1 },
    { key: 'needSight', label: 'Only when no wall is in the way', type: 'boolean' },
    {
      key: 'hurts',
      label: 'Its shots hurt',
      type: 'select',
      options: [
        { value: 'player', label: 'The player side (an enemy shooting)' },
        { value: 'enemy', label: 'The enemy side (a tower shooting at enemies)' },
        { value: 'anything', label: 'Anything' },
      ],
    },
    { key: 'prefab', label: 'Shoot a prefab (empty = a plain ball)', type: 'prefab' },
    { key: 'sound', label: 'Sound at each shot (a file in Assets -> Sounds)', type: 'text' },
  ],
  inputs: [],
  outputs: [
    { name: 'aiming', label: 'Is taking aim or shooting' },
    { name: 'shot', label: 'Just fired' },
  ],
  requires: {},
  summary: (s) => `Shoots ${s.volley > 1 ? `${s.volley}-shot volleys` : 'single shots'} at "${s.target}" up to ${s.range} cells away, every ${s.cooldown} s.`,
  update(ctx, e, s) {
    const st = stateOf<RangedState>(e, 'ranged', () => ({ phase: 'idle', t: 0, cool: 0, shotsLeft: 0, gap: 0 }));
    const flags = aiFlags(e);
    const dead = e.get<{ dead: boolean }>('state:health')?.dead ?? false;
    const sigs = e.get<{ outputs: Record<string, boolean> }>('signals');
    const publish = (aiming: boolean, shot: boolean): void => {
      if (sigs) {
        sigs.outputs.aiming = aiming;
        sigs.outputs.shot = shot;
      }
    };
    if (flags.disabled || dead) {
      st.phase = 'idle';
      publish(false, false);
      return;
    }
    const b = e.get<Body>(C.Body);
    const t = transform(e);
    st.cool = Math.max(0, st.cool - ctx.dt);
    const target = nearestTarget(ctx, e, s.target);
    let fired = false;
    const canSee = (x: number, y: number): boolean => {
      if (!s.needSight) return true;
      const model: LightingModel = ctx.runtime.lighting ?? { regions: [], sceneDarkness: 0, lights: [], blocked: makeOccluder(ctx.map, []) };
      return lineClear(model, t.x, t.y, x, y, t.h + 0.5);
    };
    const inRange = target !== null && target.d <= s.range && target.d >= s.minRange && Math.abs(target.h - t.h) <= 3 && canSee(target.x, target.y);

    if (st.phase === 'idle') {
      if (inRange && st.cool <= 0) {
        st.phase = 'windup';
        st.t = 0;
      }
    }
    if (st.phase === 'windup') {
      if (!inRange || !target) {
        st.phase = 'idle'; // the target slipped away while it was taking aim
      } else {
        if (b) b.vx = b.vy = 0;
        t.facing = facingOfGridDir(target.x - t.x, target.y - t.y);
        st.t += ctx.dt;
        if (st.t >= s.windup) {
          st.phase = 'volley';
          st.shotsLeft = Math.max(1, Math.round(s.volley));
          st.gap = 0;
        }
      }
    }
    if (st.phase === 'volley') {
      if (b) b.vx = b.vy = 0;
      st.gap -= ctx.dt;
      if (st.gap <= 0) {
        // each shot is aimed at where the target is now (or straight ahead if it has gone)
        const dx = target ? target.x - t.x : Math.cos(0);
        const dy = target ? target.y - t.y : 0;
        if (target) t.facing = facingOfGridDir(dx, dy);
        fire(ctx, e, s, dx, dy, target ? target.h - t.h : 0);
        fired = true;
        st.shotsLeft--;
        st.gap = s.volleyGap;
        if (st.shotsLeft <= 0) {
          st.phase = 'idle';
          st.cool = s.cooldown;
        }
      }
    }
    publish(st.phase !== 'idle', fired);
  },
});
