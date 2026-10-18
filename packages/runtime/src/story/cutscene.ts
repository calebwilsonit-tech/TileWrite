import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION, VariableValueSchema } from '../project/schema';

/**
 * Cutscenes: a timeline of steps that run one after another. A step marked "keep going" (async) starts and
 * the next one begins at once, so a camera move or a fade can run alongside a character walking and talking.
 * Plain data in `assets/cutscenes/<name>.cutscene.json`.
 *
 * Who/what a step talks about is a reference: "player", "id:e3" (an object by its id), "tag:guard",
 * "name:Keeper", or a point written "x,y" in cells.
 */

const common = { id: z.string().min(1), async: z.boolean().default(false) };

export const CutsceneStepSchema = z.discriminatedUnion('type', [
  z.object({ ...common, type: z.literal('wait'), seconds: z.number().min(0).default(1) }),
  z.object({ ...common, type: z.literal('waitInput') }),
  z.object({ ...common, type: z.literal('say'), speaker: z.string().default(''), text: z.string().default('') }),
  z.object({ ...common, type: z.literal('dialogue'), dialogue: z.string().default('') }),
  z.object({ ...common, type: z.literal('cameraTo'), target: z.string().default('player'), seconds: z.number().min(0).default(1), zoom: z.number().min(0.25).max(4).default(1) }),
  z.object({ ...common, type: z.literal('cameraReset'), seconds: z.number().min(0).default(0.5) }),
  z.object({ ...common, type: z.literal('move'), who: z.string().default('player'), to: z.string().default(''), speed: z.number().min(0.1).default(3) }),
  z.object({ ...common, type: z.literal('face'), who: z.string().default('player'), toward: z.string().default('') }),
  z.object({ ...common, type: z.literal('fade'), to: z.number().min(0).max(1).default(1), seconds: z.number().min(0).default(1), color: z.number().int().min(0).max(0xffffff).default(0) }),
  z.object({ ...common, type: z.literal('animation'), who: z.string().default('player'), clip: z.string().default('') }),
  z.object({ ...common, type: z.literal('shake'), amount: z.number().min(0).default(6), seconds: z.number().min(0).default(0.4) }),
  z.object({ ...common, type: z.literal('sound'), name: z.string().default('') }),
  z.object({ ...common, type: z.literal('music'), name: z.string().default('') }),
  z.object({ ...common, type: z.literal('setVariable'), name: z.string().default(''), value: VariableValueSchema.default(1) }),
  z.object({ ...common, type: z.literal('give'), item: z.string().default(''), amount: z.number().default(1) }),
  z.object({ ...common, type: z.literal('message'), text: z.string().default('') }),
]);
export type CutsceneStep = z.infer<typeof CutsceneStepSchema>;

export const CutsceneSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  name: z.string().min(1),
  /** Can the player skip it (a button press jumps to the end)? */
  skippable: z.boolean().default(true),
  steps: z.array(CutsceneStepSchema).default([]),
});
export type CutsceneData = z.infer<typeof CutsceneSchema>;

export function newCutscene(name: string): CutsceneData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, skippable: true, steps: [] };
}

export const CUTSCENE_STEP_LABELS: Record<CutsceneStep['type'], string> = {
  wait: 'Wait',
  waitInput: 'Wait for a button press',
  say: 'Say a line',
  dialogue: 'Start a dialogue',
  cameraTo: 'Move the camera',
  cameraReset: 'Camera back to the player',
  move: 'Walk somebody',
  face: 'Turn somebody',
  fade: 'Fade the screen',
  animation: 'Play an animation',
  shake: 'Shake the screen',
  sound: 'Play a sound',
  music: 'Change the music',
  setVariable: 'Set a variable',
  give: 'Give an item',
  message: 'Show a message',
};

/** What the screen is doing because of a cutscene (or a hit): the host applies it each frame. */
export interface ViewState {
  /** Where the camera should look, in grid cells, or null to follow the player. */
  cameraTarget: { x: number; y: number } | null;
  cameraZoom: number | null;
  /** Pixels of screen shake. */
  shake: number;
  /** Pixels of quick shake from hits and bangs; fades by itself (see `Simulation.step`). */
  impact: number;
  fade: { alpha: number; color: number };
  /** Which way the world is turned on screen (0 = usual; each step is a quarter turn). The game host draws it; controls follow it. */
  rotation: 0 | 1 | 2 | 3;
  /** Cells the game wants lit up on the ground (a move range, a building's footprint). Cosmetic: rebuilt by whoever wants them every tick. */
  cells: CellMark[];
  /** A selection rectangle being dragged, in picture pixels. */
  selectBox: { x0: number; y0: number; x1: number; y1: number } | null;
  /** A colour laid over the whole picture (night, dusk), or null. Cosmetic. */
  tint: { color: number; alpha: number } | null;
}

/** A cell tinted on the ground. */
export interface CellMark {
  x: number;
  y: number;
  /** Height of the surface it sits on (levels). */
  h: number;
  color: number;
  alpha?: number;
  /** Draw only the outline. */
  outline?: boolean;
}

export const newView = (): ViewState => ({ rotation: 0, cells: [], selectBox: null, tint: null, cameraTarget: null, cameraZoom: null, shake: 0, impact: 0, fade: { alpha: 0, color: 0 } });

/** A cutscene that is playing right now. */
export interface CutsceneState {
  name: string;
  /** Index of the next step to start. */
  index: number;
  /** Seconds left in a "wait" or camera move that the timeline is waiting on. */
  waitLeft: number;
  /** What the timeline is waiting for before starting the next step. */
  blocking: 'none' | 'time' | 'input' | 'dialogue' | 'move';
  /** Background effects (camera moves, fades, shakes, walks) still in progress. */
  effects: CutsceneEffect[];
}

export type CutsceneEffect =
  | { kind: 'camera'; from: { x: number; y: number }; to: { x: number; y: number }; t: number; seconds: number; zoomFrom: number; zoomTo: number; release: boolean }
  | { kind: 'fade'; from: number; to: number; t: number; seconds: number }
  | { kind: 'shake'; amount: number; t: number; seconds: number }
  | { kind: 'move'; entity: number; goal: { x: number; y: number }; speed: number; blocking: boolean; nav?: unknown };

export interface CutsceneProblem {
  step?: string;
  text: string;
}

/** Plain-English problems in a cutscene. */
export function checkCutscene(c: CutsceneData, known: { dialogues: ReadonlySet<string>; items: ReadonlySet<string>; sounds?: ReadonlySet<string> }): CutsceneProblem[] {
  const out: CutsceneProblem[] = [];
  if (c.steps.length === 0) out.push({ text: `The cutscene "${c.name}" has no steps yet.` });
  const seen = new Set<string>();
  c.steps.forEach((s, i) => {
    const label = `Step ${i + 1} (${CUTSCENE_STEP_LABELS[s.type]})`;
    if (seen.has(s.id)) out.push({ step: s.id, text: `${label} shares its id "${s.id}" with another step.` });
    seen.add(s.id);
    if (s.type === 'dialogue') {
      if (s.dialogue === '') out.push({ step: s.id, text: `${label} has no dialogue chosen.` });
      else if (!known.dialogues.has(s.dialogue)) out.push({ step: s.id, text: `${label} uses the dialogue "${s.dialogue}", which does not exist.` });
    }
    if ((s.type === 'sound' || s.type === 'music') && s.name !== '' && known.sounds && !known.sounds.has(s.name)) out.push({ step: s.id, text: `${label} uses the sound "${s.name}", which is not in Assets -> Sounds.` });
    if (s.type === 'sound' && s.name === '') out.push({ step: s.id, text: `${label} has no sound chosen.` });
    if (s.type === 'give' && !known.items.has(s.item)) out.push({ step: s.id, text: `${label} gives "${s.item}", which is not in your items list.` });
    if (s.type === 'move' && s.to === '') out.push({ step: s.id, text: `${label} does not say where to walk.` });
    if (s.type === 'face' && s.toward === '') out.push({ step: s.id, text: `${label} does not say what to turn towards.` });
    if (s.type === 'say' && s.text.trim() === '') out.push({ step: s.id, text: `${label} has no text.` });
    if (s.type === 'setVariable' && s.name === '') out.push({ step: s.id, text: `${label} has no variable name.` });
    if (s.type === 'animation' && s.clip === '') out.push({ step: s.id, text: `${label} has no animation name.` });
  });
  return out;
}
