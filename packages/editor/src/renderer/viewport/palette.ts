import type { CollisionKind } from '../tools/algorithms';

/**
 * The colours of the editor's overlays (collision, walk test, solid footprints). The default uses green and red as
 * most people expect; the colour-blind-safe set is the Okabe-Ito palette, whose colours stay apart for people with
 * red-green or blue-yellow colour blindness. Both are plain data so a test can check them.
 */
export interface Palette extends Record<CollisionKind, number> {
  /** The walk test's "you can get here" fill. */
  reach: number;
  /** A solid object's footprint. */
  solid: number;
}

export const NORMAL_PALETTE: Palette = {
  void: 0x000000,
  walkable: 0x2ec27e,
  blocked: 0xe5484d,
  overhead: 0xc9577a,
  pit: 0x1b1b1f,
  water: 0x3b82f6,
  stair: 0xf5d90a,
  trigger: 0xb18cff,
  deck: 0xff9f43,
  reach: 0x40e08a,
  solid: 0xe5484d,
};

export const SAFE_PALETTE: Palette = {
  void: 0x000000,
  walkable: 0x56b4e9,
  blocked: 0xd55e00,
  overhead: 0x9a5aa0,
  pit: 0x1b1b1f,
  water: 0x0072b2,
  stair: 0xf0e442,
  trigger: 0xcc79a7,
  deck: 0x009e73,
  reach: 0x56b4e9,
  solid: 0xd55e00,
};

/** What is drawn right now. Changed in place by `setColourBlindSafe`. */
export const PALETTE: Palette = { ...NORMAL_PALETTE };

export function setColourBlindSafe(on: boolean): void {
  Object.assign(PALETTE, on ? SAFE_PALETTE : NORMAL_PALETTE);
}

/** What the collision colours mean, in words that match the colours now in use. */
export function collisionLegend(): string {
  return PALETTE.walkable === SAFE_PALETTE.walkable ? 'light blue walk, red-orange blocked, purple blocks other heights only, dark blue water, yellow stairs, green bridge' : 'green walk, red blocked, pink blocks other heights only, blue water, yellow stairs, orange bridge';
}
