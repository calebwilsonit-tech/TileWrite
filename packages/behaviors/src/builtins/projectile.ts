import { C, surfaceAt, type Body, type Collider, type Entity, type TransformIso } from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { damage, isHurtBy, type Hurts } from './combat';

const collider = (e: Entity): Collider | undefined => e.get<Collider>(C.Collider);
const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

// ---------- projectile ----------

export interface Projectile {
  /** How fast it climbs (+) or sinks (-) in levels per second while it flies (shots aimed at a target on another level). */
  dirZ?: number;
  /** Damage dealt to what it hits (0 = it only flies and announces the hit). */
  damage: number;
  hurts: Hurts;
  knockback: number;
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
  timing: 'realtime',
  name: 'Projectile',
  category: 'World',
  description: 'Flies in a straight line and disappears when it hits a wall or a solid object (or runs out of time), announcing the hit.',
  phase: 'control',
  defaults: { speed: 8, lifetime: 3, useFacing: true, dirX: 1, dirY: 0, damage: 0, hurts: 'player', knockback: 5 },
  fields: [
    { key: 'speed', label: 'Speed (cells per second)', type: 'number', min: 0.5, max: 40, step: 0.5 },
    { key: 'lifetime', label: 'Seconds before it vanishes', type: 'number', min: 0.1, max: 60, step: 0.1 },
    { key: 'useFacing', label: 'Fly the way the object faces', type: 'boolean' },
    { key: 'dirX', label: 'Direction X', type: 'number', min: -1, max: 1, step: 0.1 },
    { key: 'dirY', label: 'Direction Y', type: 'number', min: -1, max: 1, step: 0.1 },
    { key: 'damage', label: 'Damage to what it hits (0 = none)', type: 'number', min: 0, max: 99, step: 1 },
    {
      key: 'hurts',
      label: 'Hurts',
      type: 'select',
      options: [
        { value: 'player', label: 'The player' },
        { value: 'enemies', label: 'Enemies' },
        { value: 'anything', label: 'Anything with Health' },
      ],
    },
    { key: 'knockback', label: 'Knockback (cells per second)', type: 'number', min: 0, max: 20, step: 0.5 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const t = transform(e);
    const st = stateOf<{ age: number; owner: number | null }>(e, 'projectile', () => ({ age: 0, owner: null }));
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
    if (s.dirZ) t.h += s.dirZ * ctx.dt;
    const map = ctx.map;
    if (map) {
      const surf = surfaceAt(map, nx, ny, t.h, { stepUp: 0.6, bodyHeight: 0.5 });
      if (surf.kind === 'void' || surf.kind === 'solid' || (surf.kind !== 'pit' && surf.z - t.h > 0.6)) {
        ctx.events.emit('projectile-hit', { entity: e.id, other: null });
        ctx.world.destroy(e);
        return;
      }
    }
    if (s.damage > 0) {
      // what it can hurt stops it: the target takes the damage and the shot is spent
      for (const o of ctx.world.query('health', C.Transform)) {
        if (o === e || o.id === st.owner || !isHurtBy(o, s.hurts)) continue;
        const ot = transform(o);
        if (Math.abs(ot.h - t.h) > 1.2) continue;
        const r = 0.25 + (o.get<{ radius: number }>(C.Body)?.radius ?? 0.3);
        if (Math.hypot(ot.x - nx, ot.y - ny) <= r && damage(ctx, o, s.damage, { source: e, knockback: s.knockback })) {
          ctx.events.emit('projectile-hit', { entity: e.id, other: o.id });
          ctx.world.destroy(e);
          return;
        }
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
