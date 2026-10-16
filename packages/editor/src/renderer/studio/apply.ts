import { locomotionController, makeAnimator, type Animator, type EntityData, type SpriteData } from '@tilewright/runtime';

const IDLE = /idle|stand|rest|still/i;
const WALK = /walk|run|move|step/i;
const AIR = /jump|fall|air|hop/i;

export interface LocomotionClips {
  idle: string;
  walk: string;
  air: string;
}

function guess(clips: readonly string[], re: RegExp, fallback: string): string {
  return clips.find((c) => re.test(c)) ?? fallback;
}

/** Best guess at which of a sprite's animations are "standing", "walking" and "in the air". */
export function guessLocomotion(data: SpriteData): LocomotionClips | null {
  const names = data.clips.map((c) => c.name);
  if (names.length === 0) return null;
  const idle = guess(names, IDLE, '');
  const walk = guess(names, WALK, '');
  if (idle && walk && idle !== walk) return { idle, walk, air: guess(names, AIR, '') };
  if (names.length >= 2 && !idle && !walk) return { idle: names[0]!, walk: names[1]!, air: '' };
  return null;
}

export function locomotionAnimator(data: SpriteData, clips: LocomotionClips): Animator {
  return makeAnimator({
    asset: data.name,
    clip: clips.idle,
    controller: locomotionController({ idle: clips.idle, walk: clips.walk, air: clips.air || undefined }),
  });
}

/**
 * Use a drawn sprite on an object (or clear it). Things that move (they have a body) get an idle / walk
 * controller when the sprite has matching animations; everything else just plays its first animation.
 */
export function applySprite(e: EntityData, data: SpriteData | undefined): void {
  const sprite = e.components.sprite as Record<string, unknown> | undefined;
  if (!data) {
    if (sprite) delete sprite.asset;
    delete e.components.animator;
    return;
  }
  if (!sprite) {
    e.components.sprite = { shape: 'box', color: 0xffffff, w: 0.6, d: 0.6, height: 1, sortOffset: 0, visible: true, asset: data.name };
  } else {
    sprite.asset = data.name;
  }
  const moves = !!e.components.body;
  const loco = moves ? guessLocomotion(data) : null;
  e.components.animator = loco ? locomotionAnimator(data, loco) : makeAnimator({ asset: data.name, clip: data.clips[0]?.name ?? '' });
}

/** Change which animations the object uses for standing, walking and being airborne. */
export function setLocomotionClips(e: EntityData, data: SpriteData, clips: LocomotionClips): void {
  e.components.animator = locomotionAnimator(data, clips);
}

/** Make a non-moving object play one animation (or none). */
export function setPlainClip(e: EntityData, data: SpriteData, clip: string): void {
  e.components.animator = makeAnimator({ asset: data.name, clip });
}
