import type { Entity } from '@tilewright/runtime';
import { host } from './plugins/host';

/**
 * Cells that can be walked over a pit or water because a plugin made them a bridge. The checks and the playbot ask here instead
 * of knowing what the bridges are made of.
 */

/** Cells that could become a bridge (for the checks that ask whether the way can be opened at all). */
export function possibleBridges(entities: readonly { id: string; components: Record<string, unknown> }[], wires: readonly { to: { entity: string; input: string } }[]): Set<string> {
  const out = new Set<string>();
  for (const s of host.ext.bridgeSources.values()) for (const c of s.possible(entities, wires)) out.add(c);
  return out;
}

/** Cells that are a bridge right now in a running game. */
export function liveBridges(world: { query(...keys: string[]): Iterable<Entity> }): Set<string> {
  const out = new Set<string>();
  for (const s of host.ext.bridgeSources.values()) for (const c of s.live?.(world) ?? []) out.add(c);
  return out;
}

/** Is this object something a plugin's puzzle changes, so it is not fixed scenery for the checks? */
export function isMovableByPuzzle(entity: { components: Record<string, unknown> }): boolean {
  for (const s of host.ext.bridgeSources.values()) if (s.movable?.(entity)) return true;
  return false;
}
