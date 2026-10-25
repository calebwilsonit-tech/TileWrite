import type { Entity } from '@tilewright/runtime';
import { host } from './plugins/host';

/**
 * Has this object been defeated? Whatever plugin keeps health (or lives, or a timer) on objects says so with `api.defeatCheck`; with no
 * such plugin on, nothing is ever defeated.
 */
export function isDefeated(e: Entity): boolean {
  for (const c of host.ext.defeatChecks.values()) if (c.defeated(e)) return true;
  return false;
}
