/** Numbers and small helpers the two physics systems (the older height-map one and the block one) share. */

/** Gravity's pull, in levels per second per second. */
export const GRAVITY = 36;

/** Layers see each other only if each is in the other's mask. */
export function layersMatch(aLayer: number, aMask: number, bLayer: number, bMask: number): boolean {
  return (aLayer & bMask) !== 0 && (bLayer & aMask) !== 0;
}
