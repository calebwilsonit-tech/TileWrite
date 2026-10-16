import type { SimContext } from '../core/simulation';
import { crossedEvents, findClip, sampleClip } from '../sprites/animation';
import type { Body } from '../physics/physics';
import { C, type TransformIso } from '../scene/components';

export const ANIMATOR = 'animator';

export type ParamValue = number | boolean;

export interface Condition {
  param: string;
  op: '>' | '<' | '>=' | '<=' | '==' | '!=';
  value: ParamValue;
}

export interface Transition {
  /** State name, or "*" for any state. */
  from: string;
  to: string;
  /** All conditions must hold (an empty list always holds). */
  when: Condition[];
  /** Only leave when the current clip has finished (for attack, hurt, ...). */
  waitForEnd?: boolean;
}

/** A visual state machine for animation: idle / walk / attack / hurt with transitions and conditions. */
export interface AnimatorController {
  initial: string;
  /** state name -> the clip it plays */
  states: Record<string, { clip: string }>;
  transitions: Transition[];
}

export interface Animator {
  /** Sprite asset name, e.g. "hero". */
  asset: string;
  clip: string;
  /** Milliseconds into the current clip. */
  time: number;
  /** Playback speed multiplier. */
  speed: number;
  playing: boolean;
  /** Current frame index in the sprite, mirrored flag and clip position (managed by the animation system). */
  frame: number;
  flip: boolean;
  pos: number;
  done: boolean;
  controller: AnimatorController | null;
  /** Current state of the controller. */
  state: string;
  /** Values conditions read. Behaviours set these; speed/airborne/grounded are filled from the body automatically. */
  params: Record<string, ParamValue>;
}

export function makeAnimator(partial: Partial<Animator> = {}): Animator {
  return {
    asset: '',
    clip: '',
    time: 0,
    speed: 1,
    playing: true,
    frame: 0,
    flip: false,
    pos: 0,
    done: false,
    controller: null,
    state: '',
    params: {},
    ...partial,
  };
}

/** Idle when still, walk when moving, fall when airborne: the controller most characters want. */
export function locomotionController(clips: { idle: string; walk: string; air?: string }): AnimatorController {
  const states: AnimatorController['states'] = { idle: { clip: clips.idle }, walk: { clip: clips.walk } };
  const transitions: Transition[] = [
    { from: 'idle', to: 'walk', when: [{ param: 'speed', op: '>', value: 0.2 }] },
    { from: 'walk', to: 'idle', when: [{ param: 'speed', op: '<=', value: 0.2 }] },
  ];
  if (clips.air) {
    states.air = { clip: clips.air };
    transitions.push(
      { from: '*', to: 'air', when: [{ param: 'airborne', op: '==', value: true }] },
      { from: 'air', to: 'idle', when: [{ param: 'airborne', op: '==', value: false }] },
    );
  }
  return { initial: 'idle', states, transitions };
}

export function conditionHolds(c: Condition, params: Record<string, ParamValue>): boolean {
  const raw = params[c.param];
  const a = typeof raw === 'boolean' ? Number(raw) : (raw ?? 0);
  const b = typeof c.value === 'boolean' ? Number(c.value) : c.value;
  switch (c.op) {
    case '>':
      return a > b;
    case '<':
      return a < b;
    case '>=':
      return a >= b;
    case '<=':
      return a <= b;
    case '==':
      return a === b;
    case '!=':
      return a !== b;
  }
}

/** Pick the next controller state, or undefined to stay. Pure so it can be tested and shown in the editor. */
export function nextState(ctrl: AnimatorController, current: string, params: Record<string, ParamValue>, clipDone: boolean): string | undefined {
  for (const t of ctrl.transitions) {
    if (t.from !== '*' && t.from !== current) continue;
    if (t.to === current) continue;
    if (t.waitForEnd && !clipDone) continue;
    if (t.when.every((c) => conditionHolds(c, params))) return t.to;
  }
  return undefined;
}

/**
 * Advances every Animator: updates its parameters from the body, runs its state machine, steps the clip
 * and fires `anim-event` for clip events. Needs the sprite data in `ctx.assets`.
 */
export function animationSystem(ctx: SimContext): void {
  const dtMs = ctx.dt * 1000;
  for (const e of ctx.world.query(C.Transform, ANIMATOR)) {
    const a = e.require<Animator>(ANIMATOR);
    const t = e.require<TransformIso>(C.Transform);
    const sprite = ctx.assets.sprites.get(a.asset);
    if (!sprite) continue;

    const body = e.get<Body>(C.Body);
    if (body) {
      a.params.speed = Math.hypot(body.vx, body.vy);
      a.params.airborne = body.state === 'air';
      a.params.grounded = body.state === 'ground';
      a.params.fell = body.state === 'pit';
    }

    const ctrl = a.controller;
    if (ctrl) {
      if (a.state === '' || !ctrl.states[a.state]) {
        a.state = ctrl.initial;
        a.clip = ctrl.states[a.state]?.clip ?? a.clip;
        a.time = 0;
      }
      const next = nextState(ctrl, a.state, a.params, a.done);
      if (next && ctrl.states[next]) {
        a.state = next;
        a.clip = ctrl.states[next]!.clip;
        a.time = 0;
        a.done = false;
      }
    }

    const clip = findClip(sprite, a.clip);
    if (!clip) continue;
    const before = a.pos;
    if (a.playing) a.time += dtMs * a.speed;
    const s = sampleClip(sprite, clip, t.facing, a.time);
    const wrapped = clip.loop && s.pos < before;
    if (a.playing && (s.pos !== before || wrapped)) {
      for (const name of crossedEvents(clip, before, s.pos, wrapped)) ctx.events.emit('anim-event', { entity: e.id, name });
    }
    a.frame = s.frame;
    a.pos = s.pos;
    a.flip = s.flip;
    a.done = s.done;
  }
}
