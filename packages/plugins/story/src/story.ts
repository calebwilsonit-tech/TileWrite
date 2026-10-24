import { C, type Entity, type TransformIso, type SimContext, facingOfGridDir, minigameWon, stateOf, input, setOutput, interactedBy, occupants, behaviorDef } from '@tilewright/plugin-sdk';
import { beginDialogue, beginMinigame, playCutscene } from './director';


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

export const npcTalk = behaviorDef<NpcTalk>({
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

export const minigameStation = behaviorDef<MinigameStation>({
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

// ---------- cutscene trigger ----------

export interface CutsceneTrigger {
  cutscene: string;
  /** Plays only the first time. */
  once: boolean;
}

export const cutsceneTrigger = behaviorDef<CutsceneTrigger>({
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
