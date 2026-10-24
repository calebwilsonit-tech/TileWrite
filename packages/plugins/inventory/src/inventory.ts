import { QUICK_SLOTS, addItem, itemCount, quickSlots, type SimContext } from '@tilewright/plugin-sdk';
import { heal } from '@tilewright/plugin-combat';


/**
 * Use an item the player carries (from a quick slot or the inventory screen): heal, set a variable, show a
 * message, and use it up. Returns false if the player does not have it or it cannot be used.
 */
export function useItem(ctx: SimContext, id: string): boolean {
  const def = ctx.assets.items.get(id);
  if (!def?.use || itemCount(ctx.runtime.vars, id) <= 0) return false;
  const u = def.use;
  const player = ctx.world.withTag('player')[0];
  if (u.heal > 0 && player) {
    const hs = player.get<{ hp: number }>('state:health');
    const max = player.get<{ max: number }>('health')?.max;
    if (!hs || max === undefined) return false;
    if (hs.hp >= max && u.setVariable === '') return false; // nothing to gain: do not waste it
    heal(ctx, player, u.heal);
  }
  if (u.setVariable) ctx.runtime.vars[u.setVariable] = u.setValue;
  if (u.message) ctx.events.emit('message', { text: ctx.assets.strings.t(u.message) });
  if (u.consume) addItem(ctx.runtime.vars, id, -1);
  ctx.events.emit('item-used', { item: id });
  return true;
}

/** Quick slot buttons (1-4 on the keyboard) use the item in that slot. Runs only while the player has the controls. */
export function quickSlotSystem(ctx: SimContext): void {
  const slots = quickSlots(ctx.runtime.vars);
  for (let i = 0; i < QUICK_SLOTS; i++) {
    if (ctx.input.pressed(`quick_${i + 1}`) && slots[i]) useItem(ctx, slots[i]!);
  }
}
