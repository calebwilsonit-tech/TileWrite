import {
  C,
  InputPlayback,
  InputRecorder,
  InputState,
  LAYER,
  teleportBody,
  type ActionSnapshot,
  type Body,
  type Entity,
  type InputRecording,
  type SimContext,
  type Sprite,
  type TransformIso,
} from '@tilewright/runtime';
import { behaviorDef, stateOf } from '../framework';
import { driveBody, PLAYER_CONTROLLER, type PlayerController } from '../player-controller';

const ECHO_TAG = 'echo';

/** What an echo ends up doing once its recording runs out. */
export type EchoEnding = 'hold' | 'loop' | 'vanish';

export interface EchoRecorder {
  /** The longest a recording can be, in seconds. */
  seconds: number;
  /** How many echoes can exist at once. */
  capacity: number;
  /** Name of a variable that adds to the capacity (set it from a story flag to upgrade). */
  capacityVariable: string;
  ending: EchoEnding;
  /** How see-through the echoes are (1 = solid). */
  ghostAlpha: number;
}

interface RecorderState {
  recorder: InputRecorder | null;
  ticks: number;
  start: { x: number; y: number; h: number; facing: number } | null;
  echoes: number[];
  labelSecond: number;
}

export function echoEntities(ctx: SimContext): Entity[] {
  return ctx.world.withTag(ECHO_TAG).filter((e) => e.has('echoReplay'));
}

/** How many echoes this recorder may keep right now (its own setting plus whatever the story flag adds). */
export function echoCapacity(ctx: SimContext, s: EchoRecorder): number {
  const bonus = s.capacityVariable ? Number(ctx.runtime.vars[s.capacityVariable]) || 0 : 0;
  return Math.max(0, Math.floor(s.capacity + bonus));
}

export const echoRecorder = behaviorDef<EchoRecorder>({
  id: 'echoRecorder',
  name: 'Echo Recorder',
  category: 'Player',
  description:
    'Press the Echo button to start recording your movement and press it again to finish: a ghost echo then repeats it. Echoes can stand on pressure plates. Starting a new recording restarts every echo so they all play together.',
  phase: 'control',
  defaults: { seconds: 8, capacity: 1, capacityVariable: '', ending: 'hold', ghostAlpha: 0.55 },
  fields: [
    { key: 'seconds', label: 'Longest recording (seconds)', type: 'number', min: 1, max: 60, step: 0.5 },
    { key: 'capacity', label: 'How many echoes at once', type: 'number', min: 0, max: 8, step: 1 },
    { key: 'capacityVariable', label: 'Extra echoes come from this variable (optional)', type: 'text', help: 'Set that variable in the event sheet (for example when the player finds a story item) to allow more echoes.' },
    {
      key: 'ending',
      label: 'When an echo finishes',
      type: 'select',
      options: [
        { value: 'hold', label: 'Stays where it ended (keeps holding a plate)' },
        { value: 'loop', label: 'Starts again from the beginning' },
        { value: 'vanish', label: 'Disappears' },
      ],
    },
    { key: 'ghostAlpha', label: 'Ghost see-through amount', type: 'number', min: 0.1, max: 1, step: 0.05 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => `Echo button records up to ${s.seconds} s; ${s.capacity} echo${s.capacity === 1 ? '' : 'es'} at a time.`,
  update(ctx, e, s) {
    const st = stateOf<RecorderState>(e, 'echoRecorder', () => ({ recorder: null, ticks: 0, start: null, echoes: [], labelSecond: -1 }));
    st.echoes = st.echoes.filter((id) => ctx.world.get(id)?.has('echoReplay') === true);
    const t = e.require<TransformIso>(C.Transform);

    if (st.recorder) {
      const snap: ActionSnapshot = { ...ctx.input.snapshot };
      delete snap.echo;
      st.recorder.record(snap);
      st.ticks++;
      const left = Math.max(0, Math.ceil(s.seconds - st.ticks * ctx.dt));
      if (left !== st.labelSecond) {
        st.labelSecond = left;
        e.set('label', { text: `● recording ${left}s`, color: 0xff6b6b, size: 13, bold: true, italic: false, underline: false, lift: 0.5 });
      }
      if ((ctx.input.pressed('echo') && st.ticks > 1) || st.ticks * ctx.dt >= s.seconds) {
        const rec = st.recorder.finish();
        st.recorder = null;
        e.remove('label');
        const cfg = e.get<PlayerController>(PLAYER_CONTROLLER) ?? { speed: 4, runMultiplier: 1.6, jumpSpeed: 11 };
        const made = spawnEcho(ctx, e, st.start!, rec, cfg, s);
        st.echoes.push(made.id);
        restartEchoes(ctx);
        ctx.events.emit('echo-made', { entity: made.id, seconds: rec.length * ctx.dt });
        ctx.events.emit('message', { text: 'Echo made.' });
      }
      return;
    }

    if (!ctx.input.pressed('echo')) return;
    const cap = echoCapacity(ctx, s);
    if (cap <= 0) {
      ctx.events.emit('message', { text: 'You cannot make echoes yet.' });
      return;
    }
    while (st.echoes.length >= cap) {
      const oldest = st.echoes.shift()!;
      const old = ctx.world.get(oldest);
      if (old) ctx.world.destroy(old);
    }
    st.recorder = new InputRecorder();
    st.ticks = 0;
    st.labelSecond = -1;
    st.start = { x: t.x, y: t.y, h: t.h, facing: t.facing };
    restartEchoes(ctx);
    ctx.events.emit('echo-started', {});
    ctx.events.emit('message', { text: 'Recording... press Echo again to finish.' });
  },
});

function spawnEcho(ctx: SimContext, player: Entity, start: NonNullable<RecorderState['start']>, rec: InputRecording, cfg: PlayerController, s: EchoRecorder): Entity {
  const sprite = structuredClone(player.get<Sprite>(C.Sprite)) ?? undefined;
  const body = structuredClone(player.require<Body>(C.Body));
  body.layer = LAYER.ECHO;
  body.vx = body.vy = body.vz = 0;
  body.blockedBy = [];
  const components: Record<string, unknown> = {
    transform: { ...start },
    body,
    echoReplay: { ...structuredClone(cfg), ending: s.ending, start: { ...start }, rec },
  };
  if (sprite) components.sprite = { ...sprite, alpha: s.ghostAlpha, ...(sprite.asset ? {} : { color: 0x9fd8ff }) };
  const anim = player.get('animator');
  if (anim) components.animator = structuredClone(anim);
  return ctx.world.spawn({ name: 'Echo', tags: [ECHO_TAG], components });
}

/** Put every echo back at its starting spot, ready to replay from the beginning together. */
export function restartEchoes(ctx: SimContext): void {
  for (const e of echoEntities(ctx)) restartEcho(ctx, e);
}

function restartEcho(ctx: SimContext, e: Entity): void {
  const r = e.require<EchoReplay>('echoReplay');
  const st = replayState(e, r);
  st.pb = new InputPlayback(r.rec);
  st.input = new InputState();
  const t = e.require<TransformIso>(C.Transform);
  teleportBody(ctx, e, r.start.x, r.start.y, r.start.h);
  t.facing = r.start.facing;
}

// ---------- the ghost itself ----------

export interface EchoReplay extends PlayerController {
  ending: EchoEnding;
  start: { x: number; y: number; h: number; facing: number };
  rec: InputRecording;
}

interface ReplayState {
  pb: InputPlayback;
  input: InputState;
}

function replayState(e: Entity, r: EchoReplay): ReplayState {
  return stateOf<ReplayState>(e, 'echoReplay', () => ({ pb: new InputPlayback(r.rec), input: new InputState() }));
}

export const echoReplay = behaviorDef<EchoReplay>({
  id: 'echoReplay',
  name: 'Echo (replay)',
  category: 'Player',
  hidden: true,
  description: 'A recorded movement played back by a ghost. Made by the Echo Recorder.',
  phase: 'control',
  defaults: { speed: 4, runMultiplier: 1.6, jumpSpeed: 11, ending: 'hold', start: { x: 0, y: 0, h: 0, facing: 2 }, rec: { startTick: 0, length: 0, events: [] } },
  fields: [],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const st = replayState(e, s);
    const b = e.get<Body>(C.Body);
    const t = e.get<TransformIso>(C.Transform);
    if (!b || !t) return;
    if (st.pb.done) {
      if (s.ending === 'vanish') {
        ctx.world.destroy(e);
        return;
      }
      if (s.ending === 'loop') {
        restartEcho(ctx, e);
        return;
      }
    }
    st.input.update(st.pb.next());
    driveBody(s, b, t, st.input);
  },
});
