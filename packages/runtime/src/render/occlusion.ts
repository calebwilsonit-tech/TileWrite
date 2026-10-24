import { DEFAULT_ISO, type IsoConfig } from '../iso/math';
import { isInFront, rectsOverlap, screenRect, type DepthBox } from './depth';

/**
 * Which things stand between the camera and the thing the player is following, so they can fade out.
 *
 * `legacy` is the rule the engine always had: a tile column fades when it rises above the focus' feet, its picture overlaps
 * the focus' picture, and the draw order puts it in front. It judges the focus as an upright box and orders by the
 * ground plane first, which is wrong for something standing on a wall or a ceiling (a block that is nowhere near the
 * line of sight can fade, and one that is can stay solid).
 *
 * `swept` asks the real question. The camera looks along one fixed direction; a block hides the focus exactly when the
 * focus' own box, slid toward the camera along that direction, would run into the block. It uses the box the focus
 * really has, in whatever way up it is, so it is right on floors, walls and ceilings alike.
 */
export type OcclusionMode = 'legacy' | 'swept';

export interface Occluder {
  id: number;
  box: DepthBox;
}

/**
 * The direction from the scene toward the camera, in grid units per unit of travel along x: the picture does not change
 * when something moves along it (screen x = (x - y) * tileW / 2 stays put when x and y grow together, and screen y stays
 * put when the rise in height levels balances the run along the floor).
 */
export function cameraDirection(cfg: IsoConfig = DEFAULT_ISO): { x: number; y: number; z: number } {
  // (dx + dy) * tileH / 2 = dz * heightPx with dx = dy = 1
  return { x: 1, y: 1, z: cfg.tileH / cfg.heightPx };
}

/**
 * Would `focus`, slid toward the camera, run into `block`? (Touching does not count.) This is the exact test for "the block
 * is in the way": no bounding rectangles, and nothing that depends on how the draw order breaks ties.
 *
 * A block that the focus is already inside (a body leaning a little into a wall, or a teleport that went wrong) is not in the
 * way: the part inside is hidden by nothing, and the rest is in front of the block, not behind it.
 */
export function viewOverlap(focus: DepthBox, block: DepthBox, cfg: IsoConfig = DEFAULT_ISO): number {
  const d = cameraDirection(cfg);
  // t is how far along the direction the focus has slid (t >= 0); on each axis the boxes overlap while lo < t < hi
  let lo = -Infinity;
  let hi = Infinity;
  const axes: [number, number, number, number, number][] = [
    [focus.minX, focus.maxX, block.minX, block.maxX, d.x],
    [focus.minY, focus.maxY, block.minY, block.maxY, d.y],
    [focus.minZ, focus.maxZ, block.minZ, block.maxZ, d.z],
  ];
  for (const [fa, fb, ba, bb, step] of axes) {
    lo = Math.max(lo, (ba - fb) / step);
    hi = Math.min(hi, (bb - fa) / step);
  }
  // lo < 0: the boxes already overlap where the focus stands
  return lo >= -1e-6 && hi > lo ? hi - lo : 0;
}

/** A block must cover this much of the way (in cells along the line of sight) before it starts to fade... */
export const FADE_ON = 0.12;
/** ...and stays faded until it covers less than this, so a block at the edge of the view does not flicker. */
export const FADE_OFF = 0.05;

/** Is the block in the way, with a little hysteresis: `was` says whether it was already faded on the last frame. */
export function blocksView(focus: DepthBox, block: DepthBox, cfg: IsoConfig = DEFAULT_ISO, was = false): boolean {
  return viewOverlap(focus, block, cfg) > (was ? FADE_OFF : FADE_ON);
}

/** The rule the engine used before phase 3 (see the top of this file). */
export function fadesLegacy(focus: DepthBox, block: DepthBox, cfg: IsoConfig = DEFAULT_ISO): boolean {
  if (!(block.maxZ > focus.minZ + 0.5)) return false;
  return rectsOverlap(screenRect(focus, cfg), screenRect(block, cfg)) && isInFront(focus, block);
}

/** Ids of the occluders that should fade for this focus, by the chosen rule. `boxes` are in the turned world (see `rotateBox`). */
export function fadingOccluders(focus: DepthBox, occluders: readonly Occluder[], mode: OcclusionMode, cfg: IsoConfig = DEFAULT_ISO): number[] {
  const out: number[] = [];
  for (const o of occluders) {
    if (mode === 'legacy' ? fadesLegacy(focus, o.box, cfg) : blocksView(focus, o.box, cfg)) out.push(o.id);
  }
  return out;
}
