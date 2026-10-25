import type { Carrying, SimContext, VariableValue } from '@tilewright/runtime';
import { host } from './plugins/host';

/**
 * What the player carries is kept by a plugin (the inventory). Conversations, cutscenes, skins and scripts ask `carryingOf` and get the
 * plugin's answers; with no such plugin on, nothing is carried and nothing can be given.
 */

/** The carrier that is on (the first, if more than one), as conversations and cutscenes see it. */
export function carryingOf(ctx: SimContext): Carrying | undefined {
  const carrier = host.ext.carriers.values().next().value;
  if (!carrier) return undefined;
  return { count: (id) => carrier.count(ctx.runtime.vars as Record<string, VariableValue>, id), give: (id, amount) => carrier.give(ctx, id, amount) };
}
