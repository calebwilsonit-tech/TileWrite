import { screenIntentToGrid } from '@tilewright/runtime';

/** Unit vector in grid space for a facing index (0 = East, clockwise; see FACING_NAMES). */
export function facingVector(facing: number): { x: number; y: number } {
  const a = (facing * Math.PI) / 4;
  return screenIntentToGrid(Math.cos(a), Math.sin(a));
}
