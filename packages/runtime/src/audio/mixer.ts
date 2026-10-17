import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION } from '../project/schema';

/**
 * The project's mix: how loud each bus is, how voices push the music down, and how each sound and music track
 * behaves (loudness, which bus, how much its pitch and loudness drift, a list of variants to pick from, loop points).
 * Plain data in `assets/audio/mixer.json`. A project without the file plays everything at the defaults.
 */

export const BUS_NAMES = ['master', 'music', 'sfx', 'voice'] as const;
export type BusName = (typeof BUS_NAMES)[number];

export const SoundSettingsSchema = z.object({
  /** Loudness of this sound (1 = as recorded). */
  volume: z.number().min(0).max(2).default(1),
  /** Which bus the sound plays on: effects, or voice (voices push the music down). */
  bus: z.enum(['sfx', 'voice']).default('sfx'),
  /** The most the pitch drifts each time (0.05 = 5 percent), so repeats do not sound mechanical. */
  pitchVariation: z.number().min(0).max(0.5).default(0.05),
  /** The most the loudness drifts each time (0.2 = 20 percent quieter at most). */
  volumeVariation: z.number().min(0).max(0.9).default(0),
  /** Seconds before the same sound may start again (a swarm of hits is one hit). */
  cooldown: z.number().min(0).max(5).default(0.04),
  /** Other sounds to pick from at random instead of this one ("hit1", "hit2", "hit3"). */
  variants: z.array(z.string()).default([]),
});
export type SoundSettings = z.infer<typeof SoundSettingsSchema>;

export const MusicSettingsSchema = z.object({
  volume: z.number().min(0).max(1).default(1),
  /** Where the loop jumps back to, in seconds (0 = the start). */
  loopStart: z.number().min(0).default(0),
  /** Where the loop ends, in seconds (0 = the end of the file). */
  loopEnd: z.number().min(0).default(0),
  /** Seconds to fade in and out when the music changes. */
  fade: z.number().min(0.05).max(30).default(1),
});
export type MusicSettings = z.infer<typeof MusicSettingsSchema>;

export const MixerSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  /** The designer's level for each bus; the player's own volumes in Settings multiply with these. */
  buses: z
    .object({
      master: z.number().min(0).max(1.5).default(1),
      music: z.number().min(0).max(1.5).default(1),
      sfx: z.number().min(0).max(1.5).default(1),
      voice: z.number().min(0).max(1.5).default(1),
    })
    .default({ master: 1, music: 1, sfx: 1, voice: 1 }),
  /** Music gets quieter while a sound on the voice bus plays. */
  ducking: z
    .object({
      enabled: z.boolean().default(true),
      /** How much the music is lowered (0.6 = to 40 percent). */
      amount: z.number().min(0).max(1).default(0.6),
      /** Seconds to get quiet, and to come back. */
      attack: z.number().min(0.01).max(5).default(0.15),
      release: z.number().min(0.01).max(10).default(0.6),
    })
    .default({ enabled: true, amount: 0.6, attack: 0.15, release: 0.6 }),
  sounds: z.record(z.string(), SoundSettingsSchema).default({}),
  music: z.record(z.string(), MusicSettingsSchema).default({}),
});
export type MixerData = z.infer<typeof MixerSchema>;

export function newMixer(): MixerData {
  return MixerSchema.parse({});
}

export const defaultSound = (): SoundSettings => SoundSettingsSchema.parse({});
export const defaultMusic = (): MusicSettings => MusicSettingsSchema.parse({});

/** What is wrong with a mix, in plain English. `known` are the sound names that exist. */
export function checkMixer(m: MixerData, known: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const [name, s] of Object.entries(m.sounds)) {
    if (!known.has(name)) out.push(`The mixer has settings for the sound "${name}", but there is no such sound file.`);
    for (const v of s.variants) if (!known.has(v)) out.push(`The sound "${name}" picks from "${v}", which is not a sound in the project.`);
    if (s.variants.includes(name)) out.push(`The sound "${name}" lists itself among its variants; leave it out (it is always one of the choices).`);
  }
  for (const [name, t] of Object.entries(m.music)) {
    if (!known.has(name)) out.push(`The mixer has music settings for "${name}", but there is no such sound file.`);
    if (t.loopEnd > 0 && t.loopEnd <= t.loopStart) out.push(`The music "${name}" ends its loop (${t.loopEnd}s) before it starts (${t.loopStart}s).`);
  }
  return out;
}

/** The sound to play for a name: the sound itself or one of its variants, chosen by `random` (0 up to 1). */
export function pickVariant(m: MixerData | null, name: string, random: () => number): string {
  const s = m?.sounds[name];
  if (!s || s.variants.length === 0) return name;
  const all = [name, ...s.variants];
  return all[Math.min(all.length - 1, Math.floor(random() * all.length))]!;
}

// ---------- sound in space ----------

export interface Falloff {
  /** Within this many cells the sound is at full volume. */
  near: number;
  /** Beyond this many cells it cannot be heard. */
  far: number;
}

/**
 * How loud a sound is and from which side, for a listener at (lx, ly) and a source at (sx, sy), both in grid cells.
 * Volume falls smoothly from full at `near` to nothing at `far`; the pan follows where the source is on the screen
 * (the screen's left-right axis in an isometric view is x minus y), at most 0.85 to either side.
 */
export function spatialize(lx: number, ly: number, sx: number, sy: number, f: Falloff): { gain: number; pan: number } {
  const dx = sx - lx;
  const dy = sy - ly;
  const d = Math.hypot(dx, dy);
  const far = Math.max(f.far, f.near + 0.01);
  if (d >= far) return { gain: 0, pan: 0 };
  const t = d <= f.near ? 0 : (d - f.near) / (far - f.near);
  const gain = (1 - t) * (1 - t);
  const across = (dx - dy) / Math.SQRT2; // distance to the right on the screen
  const pan = d < 0.01 ? 0 : Math.max(-0.85, Math.min(0.85, (across / Math.max(far * 0.6, 1)) * 0.85));
  return { gain, pan };
}
