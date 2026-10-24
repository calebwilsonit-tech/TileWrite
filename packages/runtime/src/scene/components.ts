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
  /** Name of a sprite asset to draw instead of the procedural shape (drawn in the sprite studio). */
  asset?: string;
  /** 0..1, for ghosts and fades (default 1). */
  alpha?: number;
  /** No contact shadow under it (decals, attachments). */
  noShadow?: boolean;
  /**
   * Pictures to use when gravity pulls this object somewhere other than down, by direction (`'-x'`, `'+z'`...). A direction that is
   * not listed uses `asset`, turned so its head points up (the automatic look until custom art exists).
   */
  byGravity?: Partial<Record<'-z' | '+z' | '-x' | '+x' | '-y' | '+y', string>>;
}

/** A picture fixed to the face of a block (a window, a torch, a poster) or lying on a top (a rug). */
export const ATTACH = 'attach';

export interface Attach {
  /** The outward direction of the face it sits on, or the top of the block. */
  face: '+x' | '-x' | '+y' | '-y' | 'top';
  /** The sprite drawn when the face is seen as the left one in the picture, and as the right one ('' = the first one mirrored). */
  left: string;
  right: string;
  /** The block it is fixed to: its cell, the level of the block, and how far along the face it is (0 to 1). Kept so it can be moved along the wall and found again if the wall is edited. */
  cell?: { x: number; y: number };
  z?: number;
  along?: number;
}

/** A line of text drawn above an object (signs, puzzle stones, text blocks). */
export const LABEL = 'label';

export interface Label {
  text: string;
  /** 0xRRGGBB */
  color: number;
  /** Pixels at zoom 1. */
  size: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  /** How high above the object's top it floats, in levels. */
  lift: number;
}

export function makeLabel(partial: Partial<Label> = {}): Label {
  return { text: '', color: 0xffffff, size: 14, bold: false, italic: false, underline: false, lift: 0.4, ...partial };
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
