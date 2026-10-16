import { z } from 'zod';
import { CURRENT_SCHEMA_VERSION, InputPlayback, VariableValueSchema, type InputRecording } from '@tilewright/runtime';
import type { Game } from './game';

/**
 * A playthrough: the buttons someone pressed from the start of a scene, plus what should be true at the end.
 * Record it by playing (or by letting the bot play), replay it any time to check the level still works.
 */
export const PlaythroughSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  name: z.string().min(1),
  /** Scene file it was recorded in. */
  scene: z.string().default(''),
  seed: z.number().int().default(1),
  recording: z.object({
    startTick: z.number().int().default(0),
    length: z.number().int().min(0),
    events: z.array(z.tuple([z.number().int(), z.record(z.string(), z.number())])),
  }),
  /** What must hold at the end (all optional). */
  expect: z
    .object({
      /** Variables that must have these values (flags, counters, `item:key`...). */
      vars: z.record(z.string(), VariableValueSchema).default({}),
      /** An object (reference like "tag:goal") the player must be standing near. */
      near: z.string().default(''),
      /** How near, in cells. */
      within: z.number().default(1.5),
    })
    .default({ vars: {}, near: '', within: 1.5 }),
});
export type Playthrough = z.infer<typeof PlaythroughSchema>;

export function newPlaythrough(name: string, scene: string, recording: InputRecording, seed = 1, expect: Partial<Playthrough['expect']> = {}): Playthrough {
  return PlaythroughSchema.parse({ name, scene, seed, recording, expect });
}

export interface ReplayReport {
  ok: boolean;
  seconds: number;
  problems: string[];
}

/** Play the recorded buttons into a fresh game and check the ending. */
export function replayPlaythrough(game: Game, p: Playthrough): ReplayReport {
  const pb = new InputPlayback(p.recording as InputRecording);
  while (!pb.done) game.step(pb.next());
  const problems: string[] = [];
  const vars = game.sim.runtime.vars;
  for (const [k, want] of Object.entries(p.expect.vars)) {
    if (vars[k] !== want) problems.push(`Expected ${k} to be ${String(want)} at the end, but it is ${vars[k] === undefined ? 'not set' : String(vars[k])}.`);
  }
  if (p.expect.near) {
    const target = game.find(p.expect.near);
    if (!target) problems.push(`Nothing matches "${p.expect.near}" at the end of the playthrough.`);
    else {
      const t = target.get<{ x: number; y: number }>('transform');
      const me = game.position;
      if (t && Math.hypot(t.x - me.x, t.y - me.y) > p.expect.within) problems.push(`The player ended ${Math.hypot(t.x - me.x, t.y - me.y).toFixed(1)} cells from "${target.name}" (wanted within ${p.expect.within}).`);
    }
  }
  return { ok: problems.length === 0, seconds: game.seconds, problems };
}