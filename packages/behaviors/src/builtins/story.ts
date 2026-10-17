import { C, emitFx, type Entity, type TransformIso, type SimContext, facingOfGridDir, minigameWon, type VariableValue } from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { input, setOutput } from '../signals';
import { beginDialogue, beginMinigame, playCutscene } from '../story/director';
import { heal } from './combat';
import { interactedBy } from './text';
import { occupants } from './puzzle';

const transform = (e: Entity): TransformIso => e.require<TransformIso>(C.Transform);

function nearestPlayer(ctx: SimContext, e: Entity, reach: number): Entity | undefined {
  const t = transform(e);
  return ctx.world.withTag('player').find((p) => {
    const pt = p.get<TransformIso>(C.Transform);
    return !!pt && Math.hypot(pt.x - t.x, pt.y - t.y) <= reach;
  });
}

function hint(e: Entity, text: string | null): void {
  const cur = e.get<{ text: string; color: number }>('label');
  if (text === null) {
    if (cur && cur.color === 0xbfe3ff) e.remove('label');
    return;
  }
  if (!cur || cur.text !== text) e.set('label', { text, color: 0xbfe3ff, size: 12, bold: false, italic: false, underline: false, lift: 0.35 });
}

// ---------- NPC ----------

export interface NpcTalk {
  /** Name of the dialogue to start (see the Dialogues panel). */
  dialogue: string;
  reach: number;
  /** Turn to look at the player when talking. */
  facePlayer: boolean;
  /** Only talks once (afterwards it just stands there). */
  once: boolean;
  /** Show "E: talk" when the player is close. */
  hint: boolean;
}

export const npcTalk = defineBehavior<NpcTalk>({
  id: 'npcTalk',
  name: 'NPC Talk',
  category: 'Story',
  description: 'The player presses Interact (E) next to it to start a conversation. Write the conversation in the Dialogues panel and choose it here.',
  phase: 'control',
  defaults: { dialogue: '', reach: 1.7, facePlayer: true, once: false, hint: true },
  fields: [
    { key: 'dialogue', label: 'Conversation (name of a dialogue)', type: 'text', help: 'Create it in the Dialogues panel; the name must match.' },
    { key: 'reach', label: 'How close the player must be (cells)', type: 'number', min: 0.5, max: 6, step: 0.1 },
    { key: 'facePlayer', label: 'Turns to face the player', type: 'boolean' },
    { key: 'once', label: 'Only talks once', type: 'boolean' },
    { key: 'hint', label: 'Show "E: talk" when the player is close', type: 'boolean' },
  ],
  inputs: [],
  outputs: [
    { name: 'talking', label: 'Is in a conversation' },
    { name: 'talked', label: 'Has talked (stays on)' },
  ],
  requires: {
    collider: { w: 0.7, d: 0.7, height: 1.2, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] },
  },
  summary: (s) => (s.dialogue ? `Says "${s.dialogue}" when talked to.` : 'Choose which conversation it has.'),
  update(ctx, e, s) {
    const st = stateOf(e, 'npcTalk', () => ({ talking: false, talked: false }));
    const near = nearestPlayer(ctx, e, s.reach);
    if (st.talking && !ctx.runtime.dialogue) {
      st.talking = false;
      st.talked = true;
    }
    const canTalk = s.dialogue !== '' && !(s.once && st.talked);
    if (s.hint && canTalk && near && !ctx.runtime.dialogue) hint(e, 'E: talk');
    else hint(e, null);
    if (canTalk && !st.talking && interactedBy(ctx, e, s.reach, 'npcTalk') && beginDialogue(ctx, s.dialogue)) {
      st.talking = true;
      if (s.facePlayer && near) {
        const pt = transform(near);
        const t = transform(e);
        t.facing = facingOfGridDir(pt.x - t.x, pt.y - t.y);
      }
    }
    setOutput(e, 'talking', st.talking);
    setOutput(e, 'talked', st.talked);
  },
});

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

// ---------- minigame station ----------

export interface MinigameStation {
  /** Name of the minigame to play (see Story -> Minigames). */
  minigame: string;
  reach: number;
  /** Once the player has won, it cannot be played again. */
  onlyUntilWon: boolean;
  /** Show "E: play" when the player is close. */
  hint: boolean;
}

export const minigameStation = defineBehavior<MinigameStation>({
  id: 'minigameStation',
  name: 'Minigame',
  category: 'Story',
  description: 'The player presses Interact (E) next to it to play a small game: a timing bar, a pattern to repeat or a card-matching game. Make the minigame in Story -> Minigames and choose it here. Winning can open a gate, give an item or set a flag.',
  phase: 'control',
  defaults: { minigame: '', reach: 1.7, onlyUntilWon: false, hint: true },
  fields: [
    { key: 'minigame', label: 'Minigame (name)', type: 'text', help: 'Create it in Story -> Minigames; the name must match.' },
    { key: 'reach', label: 'How close the player must be (cells)', type: 'number', min: 0.5, max: 6, step: 0.1 },
    { key: 'onlyUntilWon', label: 'Cannot be played again after winning', type: 'boolean' },
    { key: 'hint', label: 'Show "E: play" when the player is close', type: 'boolean' },
  ],
  inputs: [],
  outputs: [
    { name: 'playing', label: 'Is being played' },
    { name: 'won', label: 'Has been won (stays on)' },
    { name: 'played', label: 'Has been played (stays on)' },
  ],
  requires: {
    collider: { w: 0.7, d: 0.7, height: 1.0, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] },
  },
  summary: (s) => (s.minigame ? `Plays the minigame "${s.minigame}" when used.` : 'Choose which minigame it plays.'),
  update(ctx, e, s) {
    const st = stateOf(e, 'minigameStation', () => ({ playing: false, played: false }));
    if (st.playing && !ctx.runtime.minigame) {
      st.playing = false;
      st.played = true;
    }
    const won = s.minigame !== '' && minigameWon(ctx.runtime.vars, s.minigame);
    const canPlay = s.minigame !== '' && !(s.onlyUntilWon && won);
    const near = nearestPlayer(ctx, e, s.reach);
    if (s.hint && canPlay && near && !ctx.runtime.minigame) hint(e, 'E: play');
    else hint(e, null);
    if (canPlay && !st.playing && interactedBy(ctx, e, s.reach, 'minigameStation') && beginMinigame(ctx, s.minigame)) st.playing = true;
    setOutput(e, 'playing', st.playing);
    setOutput(e, 'won', won);
    setOutput(e, 'played', st.played);
  },
});

// ---------- lantern post (checkpoint) ----------

export interface Checkpoint {
  /** Shown in the travel list. */
  name: string;
  reach: number;
  /** How far a lit lantern shines. */
  lightRadius: number;
  /** Resting restores all health. */
  heals: boolean;
}

const litKey = (scene: string, id: string): string => `lit:${scene}:${id}`;

export interface LitPost {
  scene: string;
  id: string;
  name: string;
  x: number;
  y: number;
  h: number;
}

/** Every lantern the player has lit, in any scene (read from the saved variables). */
export function litPosts(vars: Record<string, VariableValue>): LitPost[] {
  const out: LitPost[] = [];
  for (const [k, v] of Object.entries(vars)) {
    if (!k.startsWith('lit:') || typeof v !== 'string') continue;
    const rest = k.slice(4);
    const split = rest.lastIndexOf(':');
    const [name = '', x = '0', y = '0', h = '0'] = v.split('|');
    out.push({ scene: rest.slice(0, split), id: rest.slice(split + 1), name, x: Number(x), y: Number(y), h: Number(h) });
  }
  return out.sort((a, b) => a.scene.localeCompare(b.scene) || a.name.localeCompare(b.name));
}

export const checkpoint = defineBehavior<Checkpoint>({
  id: 'checkpoint',
  name: 'Lantern Post (checkpoint)',
  category: 'Story',
  description:
    'The player presses Interact (E) next to it to light it and rest. Resting heals, and if the player is defeated they return to the last post they rested at. Lit posts are listed in the Travel menu so the player can fast travel between them.',
  phase: 'control',
  defaults: { name: 'Lantern', reach: 1.6, lightRadius: 5, heals: true },
  fields: [
    { key: 'name', label: 'Name (shown in the travel list)', type: 'text' },
    { key: 'reach', label: 'How close the player must be (cells)', type: 'number', min: 0.5, max: 6, step: 0.1 },
    { key: 'lightRadius', label: 'How far it shines when lit (cells)', type: 'number', min: 1, max: 15, step: 0.5 },
    { key: 'heals', label: 'Resting heals the player fully', type: 'boolean' },
  ],
  inputs: [],
  outputs: [{ name: 'lit', label: 'Is lit' }],
  requires: { collider: { w: 0.5, d: 0.5, height: 1.4, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => `"${s.name}": rest here, and come back here when defeated.`,
  update(ctx, e, s) {
    const id = e.get<{ sceneId: string }>('meta')?.sceneId ?? String(e.id);
    const key = litKey(ctx.runtime.scene, id);
    const t = transform(e);
    const lit = typeof ctx.runtime.vars[key] === 'string';
    const near = nearestPlayer(ctx, e, s.reach);
    if (lit && !e.has('light')) e.set('light', { radius: s.lightRadius, intensity: 1, color: 'warm', shadows: true, flicker: 0.2, mode: 'always' });
    const sp = e.get<{ color: number }>(C.Sprite);
    if (sp) sp.color = lit ? 0xffc866 : 0x6b6f7a;
    if (near && !ctx.runtime.dialogue) hint(e, lit ? 'E: rest' : 'E: light the lantern');
    else hint(e, null);
    if (interactedBy(ctx, e, s.reach, 'checkpoint') && near) {
      const spot = { x: t.x, y: t.y + 1, h: t.h };
      if (!lit) {
        ctx.runtime.vars[key] = `${s.name}|${spot.x}|${spot.y}|${spot.h}`;
        ctx.events.emit('message', { text: ctx.assets.strings.fmt('{name} is lit.', { name: s.name }) });
        ctx.events.emit('lantern-lit', { entity: e.id, name: s.name });
      } else ctx.events.emit('message', { text: ctx.assets.strings.fmt('Rested at {name}.', { name: s.name }) });
      ctx.runtime.checkpoint = { scene: ctx.runtime.scene, x: spot.x, y: spot.y, h: spot.h, name: s.name };
      if (s.heals) {
        const hs = near.get<{ max?: number }>('health');
        if (hs) heal(ctx, near, hs.max ?? 99);
      }
      ctx.events.emit('rested', { entity: e.id, name: s.name });
    }
    setOutput(e, 'lit', typeof ctx.runtime.vars[key] === 'string');
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

// ---------- cutscene trigger ----------

export interface CutsceneTrigger {
  cutscene: string;
  /** Plays only the first time. */
  once: boolean;
}

export const cutsceneTrigger = defineBehavior<CutsceneTrigger>({
  id: 'cutsceneTrigger',
  name: 'Cutscene Trigger',
  category: 'Story',
  description: 'Plays a cutscene when the player walks into its area (the first time only, if you like). Write cutscenes in the Cutscenes panel.',
  phase: 'actuator',
  defaults: { cutscene: '', once: true },
  fields: [
    { key: 'cutscene', label: 'Cutscene (name)', type: 'text' },
    { key: 'once', label: 'Only the first time', type: 'boolean' },
  ],
  inputs: [{ name: 'play', label: 'Play now', help: 'A rising signal plays the cutscene.' }],
  outputs: [{ name: 'played', label: 'Has played (stays on)' }],
  requires: { collider: { w: 2, d: 2, height: 1.5, solid: false, trigger: true, layer: 1, mask: 65535, enabled: true, inside: [] } },
  summary: (s) => (s.cutscene ? `Plays "${s.cutscene}" when the player walks in.` : 'Choose which cutscene to play.'),
  update(ctx, e, s) {
    const st = stateOf(e, 'cutsceneTrigger', () => ({ played: false, prevSignal: false }));
    const sig = input(e, 'play');
    const fire = sig && !st.prevSignal;
    st.prevSignal = sig;
    const inside = occupants(ctx, e, 'player').length > 0;
    if ((inside || fire) && s.cutscene && !(s.once && st.played) && !ctx.runtime.cutscene && !ctx.runtime.dialogue && playCutscene(ctx, s.cutscene)) st.played = true;
    setOutput(e, 'played', st.played);
  },
});
