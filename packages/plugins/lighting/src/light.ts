import { C, makeOccluder, type Collider, type Entity, type LightSource, type LightingModel, type SimContext, type Sprite, type TransformIso, stateOf, input, behaviorDef } from '@tilewright/plugin-sdk';


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

export const light = behaviorDef<Light>({
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
    blocked: makeOccluder(ctx.map, tall, ctx.assets.tileset ? (t) => ctx.assets.tileset![t]?.props?.blocksLight === true : undefined),
  };
  ctx.runtime.lighting = model;
}
