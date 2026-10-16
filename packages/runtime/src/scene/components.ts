/** Standard component names and shapes. Components are plain data so they save, diff and replay cleanly. */

export const C = {
  Transform: 'transform',
  Sprite: 'sprite',
  Body: 'body',
  Collider: 'collider',
} as const;

/** Position in grid units; h is height in levels (feet position). Facing is 0..7 (see FACING_NAMES). */
export interface TransformIso {
  x: number;
  y: number;
  h: number;
  facing: number;
}

export type SpriteShape = 'box' | 'diamond';

/**
 * Something drawable. Until the sprite studio (M4) exists, entities are drawn as procedural shapes.
 * A box occupies a footprint of w x d cells (from the transform, centred) and rises `height` levels.
 */
export interface Sprite {
  shape: SpriteShape;
  /** 0xRRGGBB */
  color: number;
  /** Footprint width/depth in cells (x and y). */
  w: number;
  d: number;
  /** Height in levels. */
  height: number;
  /** Added to the depth ordering tie-break; push a sprite in front of / behind equals. */
  sortOffset: number;
  visible: boolean;
}

export function makeTransform(x = 0, y = 0, h = 0, facing = 2): TransformIso {
  return { x, y, h, facing };
}

export function makeSprite(partial: Partial<Sprite> = {}): Sprite {
  return {
    shape: 'box',
    color: 0xffffff,
    w: 0.6,
    d: 0.6,
    height: 1,
    sortOffset: 0,
    visible: true,
    ...partial,
  };
}
