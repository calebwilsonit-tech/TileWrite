import { C, emitFx, type Entity, type TransformIso } from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { input, setOutput } from '../signals';
import { occupants } from './puzzle';

const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

// ---------- sound source ----------

export interface SoundSource {
  /** The sound to play (a file in Assets -> Sounds). */
  sound: string;
  /** Loops for as long as the player is within hearing (a waterfall, a campfire). */
  ambient: boolean;
  /** Within this many cells it is at full volume. */
  near: number;
  /** Farther than this many cells it cannot be heard. */
  far: number;
  volume: number;
  /** A one-shot sound repeated every this many seconds (0 = only when the Play input arrives). */
  every: number;
}

export const soundSource = defineBehavior<SoundSource>({
  id: 'soundSource',
  name: 'Sound Source',
  category: 'Story',
  description: 'A sound that comes from this object. It gets quieter and moves to one side as the player walks away from it. Ambient: a loop that plays while the player is in range (a waterfall). Otherwise it plays once when its Play input arrives, or every few seconds (a dripping pipe). A wire into Silence turns it off.',
  phase: 'source',
  defaults: { sound: '', ambient: true, near: 2, far: 14, volume: 1, every: 0 },
  fields: [
    { key: 'sound', label: 'Sound (a file in Assets -> Sounds)', type: 'text', help: 'The name of a sound file in Assets -> Sounds, without its ending.' },
    { key: 'ambient', label: 'Loops while the player is in range', type: 'boolean' },
    { key: 'near', label: 'Full volume within (cells)', type: 'number', min: 0, max: 40, step: 0.5 },
    { key: 'far', label: 'Cannot be heard beyond (cells)', type: 'number', min: 1, max: 80, step: 0.5 },
    { key: 'volume', label: 'Volume (0 to 1)', type: 'number', min: 0, max: 1, step: 0.1 },
    { key: 'every', label: 'Repeat a one-shot every (seconds, 0 = off)', type: 'number', min: 0, max: 120, step: 0.5 },
  ],
  inputs: [
    { name: 'play', label: 'Play once' },
    { name: 'silence', label: 'Silence (while on)' },
  ],
  outputs: [{ name: 'audible', label: 'Is making sound' }],
  requires: {},
  summary: (s) => (s.sound ? `${s.ambient ? 'Loops' : 'Plays'} "${s.sound}" from here, heard up to ${s.far} cells away.` : 'Choose a sound.'),
  update(ctx, e, s) {
    const st = stateOf(e, 'soundSource', () => ({ prevPlay: false, timer: 0, audible: false }));
    const silenced = input(e, 'silence');
    const play = input(e, 'play');
    st.audible = s.sound !== '' && s.ambient && !silenced;
    let now = play && !st.prevPlay && !silenced;
    st.prevPlay = play;
    if (!s.ambient && s.every > 0 && !silenced) {
      st.timer += ctx.dt;
      if (st.timer >= s.every) {
        st.timer = 0;
        now = true;
      }
    }
    if (now && s.sound !== '') {
      const t = transform(e);
      emitFx(ctx.runtime, { kind: 'sound', name: s.sound, volume: s.volume, at: { x: t.x, y: t.y, near: s.near, far: s.far } });
    }
    setOutput(e, 'audible', st.audible || now);
  },
});

// ---------- portal ----------

export interface Portal {
  /** Scene file to go to (empty = this scene). */
  scene: string;
  /** Name of the object to appear at in that scene (or a point "x,y"). */
  spawn: string;
}

export const portal = defineBehavior<Portal>({
  id: 'portal',
  name: 'Scene Portal',
  category: 'Story',
  description: 'A doorway: when the player steps into it they are taken to another scene (or another spot in this one), appearing at the named object there. Flags, items and lanterns come along.',
  phase: 'actuator',
  defaults: { scene: '', spawn: '' },
  fields: [
    { key: 'scene', label: 'Go to scene (file, e.g. scenes/cave.scene.json; empty = this one)', type: 'text' },
    { key: 'spawn', label: 'Appear at (name of an object in that scene, or "x,y")', type: 'text' },
  ],
  inputs: [],
  outputs: [],
  requires: { collider: { w: 1, d: 1, height: 1.5, solid: false, trigger: true, layer: 1, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `Leads to ${s.scene || 'this scene'}${s.spawn ? ` at "${s.spawn}"` : ''}.`,
  update(ctx, e, s) {
    if (ctx.runtime.travel || ctx.modal !== 'none') return;
    if (occupants(ctx, e, 'player').length === 0) return;
    ctx.runtime.travel = { scene: s.scene || ctx.runtime.scene, spawn: s.spawn };
    ctx.events.emit('portal', { entity: e.id, scene: ctx.runtime.travel.scene, spawn: s.spawn });
  },
});
