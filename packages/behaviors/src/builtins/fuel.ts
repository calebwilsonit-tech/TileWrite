import { C, ambientDarkness, isLit, lightLevel, type Collider, type Entity, type LightingModel, type Sprite, type TransformIso } from '@tilewright/runtime';
import { behaviorDef, stateOf } from '../framework';
import { input, setOutput } from '../signals';
import { damage } from './combat';
import type { Light } from './light';

const collider = (e: Entity): Collider | undefined => e.get<Collider>(C.Collider);
const sprite = (e: Entity): Sprite | undefined => e.get<Sprite>(C.Sprite);
const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

// ---------- light resource (the lantern's fuel) ----------

export interface LightResource {
  /** The most light the lantern can hold. */
  max: number;
  /** Light used up every second (0 = it never burns down). */
  burn: number;
  /** Light regained every second while standing in the glow of another light (a lantern post, a torch). */
  refillNearLight: number;
  /** How bright another light must make this spot to count (0..1). */
  nearLightLevel: number;
  /** When empty: damage taken every two seconds while standing in the dark (0 = none). */
  hurtWhenEmpty: number;
  /** The lantern shines only this far (cells) when empty; it shines its full reach when full. */
  emptyRadius: number;
  /** Below this percentage the lantern flickers and the Low signal turns on. */
  lowPercent: number;
  /** Resting at a lantern post or being defeated fills it up again. */
  refillOnRest: boolean;
}

/**
 * Light as a resource: a meter that runs down while the lantern burns, makes the player's own Light shrink as it empties,
 * fills up near other lights and when resting at a lantern post, and can hurt in the dark when it runs out. The amount
 * is the variable `light` (and `lightMax`), so event rows, items and conversations can read and change it.
 */
export const lightResource = behaviorDef<LightResource>({
  id: 'lightResource',
  name: 'Light Resource (lantern fuel)',
  category: 'Light',
  description:
    'Makes light a resource, like health: the lantern burns down, its glow shrinks as it empties, and the player must find light to refill it (stand near a lantern post or torch, or rest at a lantern post). The amount is the variable "light" (out of "lightMax"), so event rows, items and conversations can read it and add to it; the game shows a bar under the hearts. Put it on the player, next to a Light.',
  phase: 'source',
  defaults: { max: 100, burn: 2, refillNearLight: 12, nearLightLevel: 0.45, hurtWhenEmpty: 0, emptyRadius: 1.5, lowPercent: 25, refillOnRest: true },
  fields: [
    { key: 'max', label: 'Most light it holds', type: 'number', min: 1, max: 1000, step: 5 },
    { key: 'burn', label: 'Burns down per second', type: 'number', min: 0, max: 100, step: 0.5 },
    { key: 'refillNearLight', label: 'Regained per second near another light', type: 'number', min: 0, max: 200, step: 1 },
    { key: 'nearLightLevel', label: 'How bright another light must make this spot (0 to 1)', type: 'number', min: 0.05, max: 1, step: 0.05 },
    { key: 'hurtWhenEmpty', label: 'Damage every two seconds in the dark when empty (0 = none)', type: 'number', min: 0, max: 20, step: 1 },
    { key: 'emptyRadius', label: 'Its glow reaches this far when empty (cells)', type: 'number', min: 0, max: 20, step: 0.5 },
    { key: 'lowPercent', label: 'Flickers and signals Low below (percent)', type: 'number', min: 0, max: 100, step: 5 },
    { key: 'refillOnRest', label: 'Resting at a lantern post fills it up', type: 'boolean' },
  ],
  inputs: [],
  outputs: [
    { name: 'low', label: 'Is running low' },
    { name: 'empty', label: 'Is empty' },
  ],
  requires: { light: { radius: 5, intensity: 1, color: 'warm', shadows: true, flicker: 0.15, mode: 'always' } },
  summary: (s) => `Holds ${s.max}, burns ${s.burn} a second, refills near other lights${s.refillOnRest ? ' and when resting' : ''}.`,
  update(ctx, e, s) {
    const st = stateOf<{ base: number; hurt: number }>(e, 'lightResource', () => ({ base: -1, hurt: 0 }));
    const vars = ctx.runtime.vars;
    const lamp = e.get<Light>('light');
    if (lamp && st.base < 0) st.base = lamp.radius;
    vars.lightMax = s.max;
    let amount = typeof vars.light === 'number' && Number.isFinite(vars.light) ? vars.light : s.max;
    const t = transform(e);
    // resting at a lantern post, or being defeated, fills it up
    if (s.refillOnRest && (ctx.events.of('rested').length > 0 || ctx.events.of('died').some((d) => ctx.world.get(Number(d.entity))?.tags.has('player')))) amount = s.max;
    amount -= s.burn * ctx.dt;
    const model = ctx.runtime.lighting;
    if (model && s.refillNearLight > 0 && model.lights.length > 0) {
      // the glow of every light but this one's own
      const others: LightingModel = { ...model, lights: model.lights.filter((l) => Math.hypot(l.x - t.x, l.y - t.y) > 0.05) };
      if (others.lights.length > 0 && lightLevel(others, t.x, t.y, t.h) >= s.nearLightLevel) amount += s.refillNearLight * ctx.dt;
    }
    amount = Math.min(s.max, Math.max(0, amount));
    vars.light = Math.round(amount * 1000) / 1000;
    const fraction = amount / s.max;
    if (lamp && st.base >= 0) lamp.radius = s.emptyRadius + (st.base - s.emptyRadius) * Math.min(1, fraction ** 0.8);
    const low = fraction * 100 <= s.lowPercent;
    if (lamp) lamp.flicker = low ? Math.max(0.5, lamp.flicker) : Math.min(lamp.flicker, 0.15);
    setOutput(e, 'low', low);
    setOutput(e, 'empty', amount <= 0);
    // empty and standing in the dark hurts
    if (s.hurtWhenEmpty > 0 && amount <= 0 && model && ambientDarkness(model, t.x, t.y) > 0.4) {
      st.hurt += ctx.dt;
      if (st.hurt >= 2) {
        st.hurt = 0;
        damage(ctx, e, s.hurtWhenEmpty, { ignoreIframes: false });
      }
    } else st.hurt = 0;
  },
});

// ---------- light sensor ----------

export interface LightSensor {
  mode: 'lit' | 'dark';
  /** Brightness (0..1) that counts as lit. */
  threshold: number;
}

export const lightSensor = behaviorDef<LightSensor>({
  id: 'lightSensor',
  name: 'Light Sensor',
  category: 'Light',
  description: 'Sends a signal while the spot it stands on is lit (or while it is dark). Use it for puzzles like "light the statue to open the door".',
  phase: 'source',
  defaults: { mode: 'lit', threshold: 0.5 },
  fields: [
    {
      key: 'mode',
      label: 'Sends a signal when it is',
      type: 'select',
      options: [
        { value: 'lit', label: 'Lit' },
        { value: 'dark', label: 'Dark' },
      ],
    },
    { key: 'threshold', label: 'How bright counts as lit', type: 'number', min: 0.1, max: 1, step: 0.05 },
  ],
  inputs: [],
  outputs: [{ name: 'active', label: 'Condition met' }],
  requires: {},
  summary: (s) => `Turns on while its spot is ${s.mode}.`,
  update(ctx, e, s) {
    const t = transform(e);
    const lit = isLit(ctx.runtime.lighting, t.x, t.y, t.h, s.threshold);
    setOutput(e, 'active', s.mode === 'lit' ? lit : !lit);
  },
});

// ---------- growing object ----------

export interface Growing {
  /** Seconds to grow fully in ordinary conditions. */
  growSeconds: number;
  /** How much faster it grows in full light. */
  lightBoost: number;
  maxHeight: number;
  startFull: boolean;
}

export const growing = behaviorDef<Growing>({
  id: 'growing',
  name: 'Growing Object',
  category: 'Light',
  description: 'Rises over time like proving dough, and grows faster near light. As it grows it becomes a taller solid block, so it can become a platform or a wall. Its Shrink signal makes it deflate again.',
  phase: 'actuator',
  defaults: { growSeconds: 20, lightBoost: 4, maxHeight: 2, startFull: false },
  fields: [
    { key: 'growSeconds', label: 'Seconds to grow fully (in the dark)', type: 'number', min: 1, max: 600, step: 1 },
    { key: 'lightBoost', label: 'Times faster in full light', type: 'number', min: 1, max: 20, step: 0.5 },
    { key: 'maxHeight', label: 'Full height (levels)', type: 'number', min: 0.5, max: 8, step: 0.1 },
    { key: 'startFull', label: 'Starts fully grown', type: 'boolean' },
  ],
  inputs: [{ name: 'shrink', label: 'Shrink', help: 'While on, it deflates instead of growing.' }],
  outputs: [{ name: 'full', label: 'Fully grown' }],
  requires: { collider: { w: 0.9, d: 0.9, height: 0.2, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `Takes ${s.growSeconds} s to rise to ${s.maxHeight} levels, about ${s.lightBoost} times quicker in light.`,
  update(ctx, e, s) {
    const st = stateOf(e, 'growing', () => ({ progress: s.startFull ? 1 : 0 }));
    const t = transform(e);
    const lit = ctx.runtime.lighting ? lightLevel(ctx.runtime.lighting, t.x, t.y, t.h) : 1;
    const rate = (1 + (s.lightBoost - 1) * lit) / Math.max(1, s.growSeconds);
    st.progress = Math.min(1, Math.max(0, st.progress + (input(e, 'shrink') ? -rate : rate) * ctx.dt));
    const height = Math.max(0.2, st.progress * s.maxHeight);
    const sp = sprite(e);
    if (sp) sp.height = height;
    const c = collider(e);
    if (c) c.height = height;
    setOutput(e, 'full', st.progress >= 1);
  },
});
