import { C, teleportBody, type Entity, type SimContext } from '@tilewright/runtime';
import { resolvePoint } from './point';

/** Put the player (or anyone) at a spawn: a named object, or a point "x,y". Returns false if there is no such place. */
export function placeAtSpawn(ctx: SimContext, who: Entity, spawn: string): boolean {
  if (!who.has(C.Transform) || spawn === '') return false;
  const at = resolvePoint(ctx, /^(player|id:|tag:|name:)/.test(spawn) || /^[-\d.]+\s*,/.test(spawn) ? spawn : `name:${spawn}`);
  if (!at) return false;
  teleportBody(ctx, who, at.x, at.y);
  return true;
}
