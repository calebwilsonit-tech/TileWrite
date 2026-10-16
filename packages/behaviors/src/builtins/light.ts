import {
  C,
  isLit,
  lightLevel,
  makeOccluder,
  type Collider,
  type Entity,
  type LightSource,
  type LightingModel,
  type SimContext,
  type Sprite,
  type TransformIso,
} from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { input, setOutput } from '../signals';

const collider = (e: Entity): Collider | undefined => e.get<Collider>(C.Collider);
const sprite = (e: Entity): Sprite | undefined => e.get<Sprite>(C.Sprite);
const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

export const LIGHT_COLORS: Record<string, number> = {
  warm: 0xffd9a0,
  white: 0xffffff,
  cool: 0xa9c8ff,
  green: 0xb4ffb0,
  red: 0xff9a9a,
};

// ---------- light ----------

export type LightMode = 'always' | 'whenOn' | 'whenOff';

export interface Light {
  radius: number;
  intensity: number;
  color: string;
  shadows: boolean;
  /** 0..1 gentle flicker. */
  flicker: number;
  mode: LightMode;
}

export const light = defineBehavior<Light>({
  id: 'light',
  name: 'Light',
  category: 'Light',
  description: 'Lights up the area around it so dark rooms are visible. Walls and tall objects cast shadows. Lights can be turned on and off with a wire. Put it on the player for a lantern.',
  phase: 'actuator',
  defaults: { radius: 5, intensity: 1, color: 'warm', shadows: true, flicker: 0.15, mode: 'always' },
  fields: [
    { key: 'radius', label: 'How far it reaches (cells)', type: 'number', min: 1, max: 20, step: 0.5 },
    { key: 'intensity', label: 'Brightness', type: 'number', min: 0.1, max: 1, step: 0.05 },
    { key: 'color', label: 'Colour', type: 'select', options: Object.keys(LIGHT_COLORS).map((k) => ({ value: k, label: k[0]!.toUpperCase() + k.slice(1) })) },
    { key: 'shadows', label: 'Walls and tall objects cast shadows', type: 'boolean' },
    { key: 'flicker', label: 'Flicker', type: 'number', min: 0, max: 1, step: 0.05 },
    {
      key: 'mode',
      label: 'When it shines',
      type: 'select',
      options: [
        { value: 'always', label: 'Always' },
        { value: 'whenOn', label: 'While its Switch signal is on' },
        { value: 'whenOff', label: 'While its Switch signal is off' },
      ],
    },
  ],
  inputs: [{ name: 'switch', label: 'Switch', help: 'Turns the light on or off, depending on the "When it shines" setting.' }],
  outputs: [],
  requires: {},
  summary: (s) => `A ${s.color} light reaching ${s.radius} cells${s.mode === 'always' ? '' : s.mode === 'whenOn' ? ' while switched on' : ' while its signal is off'}.`,
  update(ctx, e, s) {
    const on = s.mode === 'always' || (s.mode === 'whenOn' ? input(e, 'switch') : !input(e, 'switch'));
    stateOf(e, 'light', () => ({ on })).on = on;
  },
});

/** The lights that are shining right now, with the flicker applied (deterministically, from the tick). */
function activeLights(ctx: SimContext): LightSource[] {
  const out: LightSource[] = [];
  for (const e of ctx.world.query('light', C.Transform)) {
    const s = e.require<Light>('light');
    if (stateOf<{ on: boolean }>(e, 'light', () => ({ on: true })).on === false) continue;
    const t = transform(e);
    const wobble = s.flicker > 0 ? 1 + s.flicker * 0.06 * Math.sin(ctx.tick * 0.21 + e.id) * Math.sin(ctx.tick * 0.07 + e.id * 3) : 1;
    out.push({
      x: t.x,
      y: t.y,
      h: t.h + Math.min(1, (sprite(e)?.height ?? 1) * 0.8),
      radius: s.radius * wobble,
      color: LIGHT_COLORS[s.color] ?? LIGHT_COLORS.warm!,
      intensity: Math.min(1, Math.max(0, s.intensity)),
      shadows: s.shadows,
    });
  }
  return out;
}

/** Builds `runtime.lighting` for this tick: regions and the "darkness" variable, the shining lights, and what blocks them. */
export function lightingSystem(ctx: SimContext): void {
  const tall: { x: number; y: number; w: number; d: number; top: number }[] = [];
  for (const e of ctx.world.query(C.Transform, C.Collider)) {
    const c = collider(e)!;
    if (!c.solid || !c.enabled || c.trigger || e.has('body')) continue;
    const t = transform(e);
    tall.push({ x: t.x, y: t.y, w: c.w, d: c.d, top: t.h + c.height });
  }
  const d = Number(ctx.runtime.vars.darkness);
  const model: LightingModel = {
    regions: ctx.runtime.regions,
    sceneDarkness: Number.isFinite(d) ? Math.min(1, Math.max(0, d)) : 0,
    lights: activeLights(ctx),
    blocked: makeOccluder(ctx.map, tall),
  };
  ctx.runtime.lighting = model;
}

// ---------- light sensor ----------

export interface LightSensor {
  mode: 'lit' | 'dark';
  /** Brightness (0..1) that counts as lit. */
  threshold: number;
}

export const lightSensor = defineBehavior<LightSensor>({
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

export const growing = defineBehavior<Growing>({
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
