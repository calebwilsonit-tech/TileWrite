import type { Entity } from '@tilewright/runtime';

/**
 * Who counts for a pressure plate or a trigger zone, and which collision layers a gate lets through when it is set to let
 * ghosts pass. The core knows a few; plugins add more (a kind of helper, a recorded copy of the player) through the plugin host.
 */

/** A group of objects, by the name saved in the scene file ('anyone', 'player', 'crates', or one a plugin added). */
export type Who = string;

export const WHO_OPTIONS: { value: string; label: string }[] = [
  { value: 'anyone', label: 'Anything' },
  { value: 'player', label: 'The player' },
  { value: 'crates', label: 'Crates' },
];

const added = new Map<string, (e: Entity) => boolean>();

/** Add a group the pickers offer. Called by the plugin host. */
export function addWhoFilter(id: string, label: string, match: (e: Entity) => boolean): void {
  added.set(id, match);
  const at = WHO_OPTIONS.findIndex((o) => o.value === id);
  if (at >= 0) WHO_OPTIONS[at] = { value: id, label };
  else WHO_OPTIONS.push({ value: id, label });
}

export function removeWhoFilter(id: string): void {
  added.delete(id);
  const at = WHO_OPTIONS.findIndex((o) => o.value === id);
  if (at >= 3) WHO_OPTIONS.splice(at, 1);
}

export function matchesWho(e: Entity, who: Who): boolean {
  switch (who) {
    case 'anyone':
      return true;
    case 'player':
      return e.tags.has('player');
    case 'crates':
      return e.has('pushable');
    default:
      return added.get(who)?.(e) ?? false;
  }
}

const ghostBits = new Map<string, number>();

/** Layers whose bodies a gate set to "let ghosts pass" lets through. Called by the plugin host. */
export function setGhostLayer(name: string, bit: number | null): void {
  if (bit === null) ghostBits.delete(name);
  else ghostBits.set(name, bit);
}

export function ghostLayerMask(): number {
  let m = 0;
  for (const b of ghostBits.values()) m |= 1 << b;
  return m;
}
