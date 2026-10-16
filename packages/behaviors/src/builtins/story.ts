import { C, type Entity, type TransformIso, type SimContext, facingOfGridDir, type VariableValue } from '@tilewright/runtime';
import { defineBehavior, stateOf } from '../framework';
import { input, setOutput } from '../signals';
import { beginDialogue, playCutscene } from '../story/director';
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
        ctx.events.emit('message', { text: `${s.name} is lit.` });
        ctx.events.emit('lantern-lit', { entity: e.id, name: s.name });
      } else ctx.events.emit('message', { text: `Rested at ${s.name}.` });
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
