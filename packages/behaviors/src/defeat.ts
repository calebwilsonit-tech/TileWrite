import type { Entity } from '@tilewright/runtime';

/** Has this object been defeated? (Whatever keeps health on objects writes the state this reads; with nothing like that, nothing is ever defeated.) */
export function isDefeated(e: Entity): boolean {
  return e.get<{ dead: boolean }>('state:health')?.dead ?? false;
}
