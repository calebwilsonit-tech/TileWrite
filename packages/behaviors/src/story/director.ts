import {
  C,
  addItem,
  advanceDialogue,
  autoSlot,
  chooseDialogue,
  facingOfGridDir,
  startDialogue,
  teleportBody,
  type CutsceneEffect,
  type CutsceneState,
  type CutsceneStep,
  type DialogueHost,
  type Entity,
  type SimContext,
  type TransformIso,
} from '@tilewright/runtime';
import { newNav, steerTo, type NavState } from '../builtins/ai';
import { resolveRef } from '../events/sheet';

/** What conversations can read and change in a running game. */
function hostOf(ctx: SimContext): DialogueHost {
  return { vars: ctx.runtime.vars, items: ctx.assets.items, emit: (type, data) => void ctx.events.emit(type, data) };
}

// ---------- dialogue ----------

/** Open a conversation. Returns false when there is nothing to show (unknown name, or a dialogue that ends at once). */
export function beginDialogue(ctx: SimContext, name: string): boolean {
  const d = ctx.assets.dialogues.get(name);
  if (!d) {
    ctx.events.emit('problem', { text: `A conversation wants the dialogue "${name}", which does not exist.` });
    return false;
  }
  if (ctx.runtime.dialogue) return false;
  const s = startDialogue(d, hostOf(ctx));
  if (!s) {
    ctx.events.emit('dialogue-ended', { name });
    return false;
  }
  ctx.runtime.dialogue = s;
  ctx.events.emit('dialogue-started', { name });
  return true;
}

/** One line of speech with nothing around it (cutscenes use this). */
export function sayLine(ctx: SimContext, speaker: string, text: string): void {
  ctx.runtime.dialogue = { dialogue: '', node: '', selected: 0, view: { kind: 'line', speaker, text } };
}

function endDialogue(ctx: SimContext, name: string): void {
  ctx.runtime.dialogue = null;
  ctx.events.emit('dialogue-ended', { name });
}

/** The player pressed Continue / picked the highlighted option. */
export function confirmDialogue(ctx: SimContext): void {
  const st = ctx.runtime.dialogue;
  if (!st) return;
  if (st.dialogue === '') return endDialogue(ctx, '');
  const d = ctx.assets.dialogues.get(st.dialogue);
  if (!d) return endDialogue(ctx, st.dialogue);
  const host = hostOf(ctx);
  const next = st.view.kind === 'line' ? advanceDialogue(d, st, host) : chooseDialogue(d, st, st.view.options[st.selected]?.index ?? -1, host);
  if (next === null) endDialogue(ctx, st.dialogue);
  else ctx.runtime.dialogue = next === st ? st : next;
}

/** Move the highlight in a list of choices (-1 up, +1 down), or pick one directly. */
export function selectChoice(ctx: SimContext, delta: number, absolute?: number): void {
  const st = ctx.runtime.dialogue;
  if (!st || st.view.kind !== 'choice') return;
  const n = st.view.options.length;
  st.selected = absolute !== undefined ? Math.max(0, Math.min(n - 1, absolute)) : (st.selected + delta + n) % n;
}

/** Runs first each tick: the conversation on screen listens to the real buttons (the world is frozen under it). */
export function dialogueSystem(ctx: SimContext): void {
  const st = ctx.runtime.dialogue;
  if (!st) return;
  const ui = ctx.uiInput;
  if (st.view.kind === 'choice') {
    if (ui.pressed('move_up')) selectChoice(ctx, -1);
    if (ui.pressed('move_down')) selectChoice(ctx, 1);
  }
  if (ui.pressed('interact') || ui.pressed('ui_confirm')) confirmDialogue(ctx);
}

// ---------- cutscenes ----------

/** A reference ("player", "id:e3", "tag:guard", "name:Keeper") or a point "x,y", as a place on the map. */
export function resolvePoint(ctx: SimContext, ref: string): { x: number; y: number } | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(ref);
  if (m) return { x: Number(m[1]), y: Number(m[2]) };
  const e = resolveRef(ctx, ref)[0];
  const t = e?.get<TransformIso>(C.Transform);
  return t ? { x: t.x, y: t.y } : undefined;
}

/** Begin a cutscene. Returns false if there is none by that name or one is already playing. */
export function playCutscene(ctx: SimContext, name: string): boolean {
  const data = ctx.assets.cutscenes.get(name);
  if (!data) {
    ctx.events.emit('problem', { text: `Something wants to play the cutscene "${name}", which does not exist.` });
    return false;
  }
  if (ctx.runtime.cutscene) return false;
  ctx.runtime.cutscene = { name, index: 0, waitLeft: 0, blocking: 'none', effects: [] };
  ctx.events.emit('cutscene-started', { name });
  return true;
}

function cameraNow(ctx: SimContext): { x: number; y: number } {
  const v = ctx.runtime.view;
  if (v.cameraTarget) return { ...v.cameraTarget };
  const p = ctx.world.withTag('player')[0]?.get<TransformIso>(C.Transform);
  return p ? { x: p.x, y: p.y } : { x: 0, y: 0 };
}

function startStep(ctx: SimContext, cs: CutsceneState, step: CutsceneStep, instant = false): void {
  const v = ctx.runtime.view;
  const effect = (e: CutsceneEffect): void => void cs.effects.push(e);
  const wait = (seconds: number): void => {
    if (!step.async && seconds > 0 && !instant) {
      cs.blocking = 'time';
      cs.waitLeft = seconds;
    }
  };
  switch (step.type) {
    case 'wait':
      wait(step.seconds);
      break;
    case 'waitInput':
      if (!step.async && !instant) cs.blocking = 'input';
      break;
    case 'say':
      if (!instant) {
        sayLine(ctx, step.speaker, step.text);
        if (!step.async) cs.blocking = 'dialogue';
      }
      break;
    case 'dialogue':
      if (!instant && beginDialogue(ctx, step.dialogue) && !step.async) cs.blocking = 'dialogue';
      break;
    case 'cameraTo': {
      const to = resolvePoint(ctx, step.target);
      if (!to) break;
      if (instant || step.seconds === 0) {
        v.cameraTarget = to;
        v.cameraZoom = step.zoom;
      } else {
        effect({ kind: 'camera', from: cameraNow(ctx), to, t: 0, seconds: step.seconds, zoomFrom: v.cameraZoom ?? 1, zoomTo: step.zoom, release: false });
        wait(step.seconds);
      }
      break;
    }
    case 'cameraReset': {
      if (instant || step.seconds === 0) {
        v.cameraTarget = null;
        v.cameraZoom = null;
        break;
      }
      const p = ctx.world.withTag('player')[0]?.get<TransformIso>(C.Transform);
      if (v.cameraTarget && p) effect({ kind: 'camera', from: cameraNow(ctx), to: { x: p.x, y: p.y }, t: 0, seconds: step.seconds, zoomFrom: v.cameraZoom ?? 1, zoomTo: 1, release: true });
      else {
        v.cameraTarget = null;
        v.cameraZoom = null;
      }
      wait(step.seconds);
      break;
    }
    case 'move': {
      const who = resolveRef(ctx, step.who)[0];
      const to = resolvePoint(ctx, step.to);
      if (!who || !to) break;
      const t = who.get<TransformIso>(C.Transform);
      if (instant && t) {
        t.x = to.x;
        t.y = to.y;
        break;
      }
      effect({ kind: 'move', entity: who.id, goal: to, speed: step.speed, blocking: !step.async, nav: newNav() });
      if (!step.async) cs.blocking = 'move';
      break;
    }
    case 'face': {
      const who = resolveRef(ctx, step.who)[0];
      const to = resolvePoint(ctx, step.toward);
      const t = who?.get<TransformIso>(C.Transform);
      if (t && to) t.facing = facingOfGridDir(to.x - t.x, to.y - t.y);
      break;
    }
    case 'fade':
      v.fade.color = step.color;
      if (instant || step.seconds === 0) v.fade.alpha = step.to;
      else {
        effect({ kind: 'fade', from: v.fade.alpha, to: step.to, t: 0, seconds: step.seconds });
        wait(step.seconds);
      }
      break;
    case 'animation': {
      const a = resolveRef(ctx, step.who)[0]?.get<{ clip: string; time: number; playing: boolean; state: string; controller?: { states: Record<string, unknown> } | null }>('animator');
      if (a) {
        a.clip = step.clip;
        a.time = 0;
        a.playing = true;
        if (a.controller?.states[step.clip]) a.state = step.clip;
      }
      break;
    }
    case 'shake':
      if (!instant) effect({ kind: 'shake', amount: step.amount, t: 0, seconds: step.seconds });
      wait(step.seconds);
      break;
    case 'sound':
      if (!instant) ctx.events.emit('sound', { name: step.name });
      break;
    case 'setVariable':
      ctx.runtime.vars[step.name] = step.value;
      break;
    case 'give': {
      const got = addItem(ctx.runtime.vars, step.item, step.amount, ctx.assets.items.get(step.item));
      if (got > 0) autoSlot(ctx.runtime.vars, step.item);
      break;
    }
    case 'message':
      ctx.events.emit('message', { text: step.text });
      break;
  }
}

function stepEffects(ctx: SimContext, cs: CutsceneState): void {
  const v = ctx.runtime.view;
  let shake = 0;
  for (const e of [...cs.effects]) {
    const done = ((): boolean => {
      switch (e.kind) {
        case 'camera': {
          e.t += ctx.dt;
          const k = e.seconds <= 0 ? 1 : Math.min(1, e.t / e.seconds);
          const s = k * k * (3 - 2 * k); // ease in and out
          v.cameraTarget = { x: e.from.x + (e.to.x - e.from.x) * s, y: e.from.y + (e.to.y - e.from.y) * s };
          v.cameraZoom = e.zoomFrom + (e.zoomTo - e.zoomFrom) * s;
          if (k >= 1) {
            if (e.release) {
              v.cameraTarget = null;
              v.cameraZoom = null;
            }
            return true;
          }
          return false;
        }
        case 'fade': {
          e.t += ctx.dt;
          const k = e.seconds <= 0 ? 1 : Math.min(1, e.t / e.seconds);
          v.fade.alpha = e.from + (e.to - e.from) * k;
          return k >= 1;
        }
        case 'shake': {
          e.t += ctx.dt;
          shake = Math.max(shake, e.amount * (1 - Math.min(1, e.t / Math.max(1e-6, e.seconds))));
          return e.t >= e.seconds;
        }
        case 'move': {
          const who = ctx.world.get(e.entity);
          if (!who) return true;
          const t = who.get<TransformIso>(C.Transform);
          if (!t) return true;
          if (!who.has(C.Body)) {
            // scenery without a body just slides to the spot
            const dx = e.goal.x - t.x;
            const dy = e.goal.y - t.y;
            const dist = Math.hypot(dx, dy);
            const step = e.speed * ctx.dt;
            if (dist <= step) {
              t.x = e.goal.x;
              t.y = e.goal.y;
              return true;
            }
            t.x += (dx / dist) * step;
            t.y += (dy / dist) * step;
            t.facing = facingOfGridDir(dx, dy);
            return false;
          }
          const nav = (e.nav ?? (e.nav = newNav())) as NavState;
          const r = steerTo(ctx, who, e.goal, e.speed, nav, 0.12);
          return r !== 'moving';
        }
      }
    })();
    if (done) cs.effects.splice(cs.effects.indexOf(e), 1);
  }
  v.shake = shake;
}

/** Finish everything that is left: variables set, items given, people where they should be, the screen as it ends up. */
function skipRest(ctx: SimContext, cs: CutsceneState, steps: CutsceneStep[]): void {
  ctx.runtime.dialogue = null;
  cs.blocking = 'none';
  for (; cs.index < steps.length; cs.index++) startStep(ctx, cs, steps[cs.index]!, true);
  for (const e of cs.effects) {
    if (e.kind === 'fade') ctx.runtime.view.fade.alpha = e.to;
    if (e.kind === 'move') {
      const t = ctx.world.get(e.entity)?.get<TransformIso>(C.Transform);
      const b = ctx.world.get(e.entity)?.get<{ vx: number; vy: number }>(C.Body);
      if (t) {
        t.x = e.goal.x;
        t.y = e.goal.y;
      }
      if (b) b.vx = b.vy = 0;
    }
  }
  cs.effects = [];
}

/** Plays the timeline one tick at a time. */
export function cutsceneSystem(ctx: SimContext): void {
  const cs = ctx.runtime.cutscene;
  if (!cs) return;
  const data = ctx.assets.cutscenes.get(cs.name);
  if (!data) {
    ctx.runtime.cutscene = null;
    return;
  }
  if (data.skippable && ctx.uiInput.pressed('pause')) {
    skipRest(ctx, cs, data.steps);
  } else {
    stepEffects(ctx, cs);
    switch (cs.blocking) {
      case 'time':
        cs.waitLeft -= ctx.dt;
        if (cs.waitLeft <= 0) cs.blocking = 'none';
        break;
      case 'input':
        if (ctx.uiInput.pressed('interact') || ctx.uiInput.pressed('ui_confirm')) cs.blocking = 'none';
        break;
      case 'dialogue':
        if (!ctx.runtime.dialogue) cs.blocking = 'none';
        break;
      case 'move':
        if (!cs.effects.some((e) => e.kind === 'move' && e.blocking)) cs.blocking = 'none';
        break;
      default:
        break;
    }
    for (let guard = 0; guard < 200 && cs.blocking === 'none' && cs.index < data.steps.length; guard++) startStep(ctx, cs, data.steps[cs.index++]!);
  }
  if (cs.index >= data.steps.length && cs.blocking === 'none' && !cs.effects.some((e) => e.kind === 'move' || e.kind === 'camera')) {
    ctx.runtime.cutscene = null;
    ctx.runtime.view.cameraTarget = null;
    ctx.runtime.view.cameraZoom = null;
    ctx.runtime.view.shake = 0;
    ctx.events.emit('cutscene-ended', { name: cs.name });
  }
}

/** Put the player (or anyone) at a spawn: a named object, or a point "x,y". Returns false if there is no such place. */
export function placeAtSpawn(ctx: SimContext, who: Entity, spawn: string): boolean {
  if (!who.has(C.Transform) || spawn === '') return false;
  const at = resolvePoint(ctx, /^(player|id:|tag:|name:)/.test(spawn) || /^[-\d.]+\s*,/.test(spawn) ? spawn : `name:${spawn}`);
  if (!at) return false;
  teleportBody(ctx, who, at.x, at.y);
  return true;
}