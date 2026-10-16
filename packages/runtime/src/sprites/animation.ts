import { FACING_NAMES } from '../iso/math';
import type { ClipData, FacingKey, SpriteData } from './format';

const MIRROR_OF: Partial<Record<FacingKey, FacingKey>> = { W: 'E', SW: 'SE', NW: 'NE' };

export interface ClipFrames {
  /** Frame indices to play, in order. */
  frames: number[];
  /** Draw mirrored left-to-right (the clip only has the opposite side drawn). */
  flip: boolean;
}

export function facingKey(facing: number): FacingKey {
  return FACING_NAMES[((Math.round(facing) % 8) + 8) % 8]!;
}

/**
 * Which frames play for a facing (0..7 clockwise from East, see FACING_NAMES).
 * Order of preference: frames drawn for that direction, the mirrored opposite side (if the clip allows),
 * the clip's all-direction frames, then anything at all so a half-finished clip still shows something.
 */
export function framesForFacing(clip: ClipData, facing: number): ClipFrames {
  const key = facingKey(facing);
  const own = clip.dirs[key];
  if (own && own.length > 0) return { frames: own, flip: false };
  if (clip.mirror) {
    const partner = MIRROR_OF[key];
    const pf = partner ? clip.dirs[partner] : undefined;
    if (pf && pf.length > 0) return { frames: pf, flip: true };
  }
  if (clip.all.length > 0) return { frames: clip.all, flip: false };
  for (const k of FACING_NAMES) {
    const l = clip.dirs[k];
    if (l && l.length > 0) return { frames: l, flip: false };
  }
  return { frames: [0], flip: false };
}

export function totalDuration(sprite: SpriteData, frames: readonly number[]): number {
  return frames.reduce((t, f) => t + (sprite.frames[f]?.duration ?? 100), 0);
}

export interface ClipSample {
  /** Index into the sprite's frame list. */
  frame: number;
  /** Position within the clip's frame list. */
  pos: number;
  flip: boolean;
  /** A non-looping clip has played to its end. */
  done: boolean;
}

/** The frame to show `timeMs` into a clip. */
export function sampleClip(sprite: SpriteData, clip: ClipData, facing: number, timeMs: number): ClipSample {
  const { frames, flip } = framesForFacing(clip, facing);
  const total = totalDuration(sprite, frames);
  if (frames.length === 0 || total <= 0) return { frame: 0, pos: 0, flip, done: true };
  let t = Math.max(0, timeMs);
  let done = false;
  if (clip.loop) t %= total;
  else if (t >= total) {
    t = total - 1;
    done = true;
  }
  for (let pos = 0; pos < frames.length; pos++) {
    const d = sprite.frames[frames[pos]!]?.duration ?? 100;
    if (t < d) return { frame: frames[pos]!, pos, flip, done };
    t -= d;
  }
  const last = frames.length - 1;
  return { frame: frames[last]!, pos: last, flip, done };
}

/** Names of clip events passed when moving from position `fromPos` to `toPos` (wrapping if the clip looped). */
export function crossedEvents(clip: ClipData, fromPos: number, toPos: number, wrapped: boolean): string[] {
  const out: string[] = [];
  for (const e of clip.events) {
    const hit = wrapped ? e.at > fromPos || e.at <= toPos : e.at > fromPos && e.at <= toPos;
    if (hit) out.push(e.name);
  }
  return out;
}

export function findClip(sprite: SpriteData, name: string): ClipData | undefined {
  return sprite.clips.find((c) => c.name === name);
}
