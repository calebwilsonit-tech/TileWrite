import { C, type Collider, type Entity, matchesWho, WHO_OPTIONS, type Who, behaviorDef } from '@tilewright/plugin-sdk';
import { addItem, autoSlot, itemsOf } from './items';


const collider = (e: Entity): Collider | undefined => e.get<Collider>(C.Collider);

// ---------- pickup ----------

export interface Pickup {
  who: Who;
  /** Variable to add to when picked up (created if missing). */
  variable: string;
  amount: number;
  /** Text to show when picked up. */
  message: string;
  /** Item (from your items list) to put in the inventory (optional). */
  item: string;
}

export const pickup = behaviorDef<Pickup>({
  id: 'pickup',
  name: 'Pickup',
  category: 'World',
  description: 'Disappears when the player touches it and adds to a counter (coins, keys, gems...).',
  phase: 'actuator',
  defaults: { who: 'player', variable: 'coins', amount: 1, message: '', item: '' },
  fields: [
    { key: 'who', label: 'Picked up by', type: 'select', options: WHO_OPTIONS },
    { key: 'variable', label: 'Counter to add to', type: 'text' },
    { key: 'amount', label: 'Amount', type: 'number', min: -999, max: 999, step: 1 },
    { key: 'message', label: 'Message to show', type: 'text' },
    { key: 'item', label: 'Item to add to the inventory (optional)', type: 'text', help: 'The id of an item from the Items panel. Leave the counter empty if you only want the item.' },
  ],
  inputs: [],
  outputs: [],
  requires: { collider: { w: 0.8, d: 0.8, height: 0.8, solid: false, trigger: true, layer: 1, mask: 65535, enabled: true, inside: [] } },
  update(ctx, e, s) {
    const c = collider(e);
    if (!c) return;
    const hit = c.inside.map((id) => ctx.world.get(id)).find((o) => o && matchesWho(o, s.who));
    if (!hit) return;
    if (s.variable) {
      const cur = ctx.runtime.vars[s.variable];
      ctx.runtime.vars[s.variable] = (typeof cur === 'number' ? cur : 0) + s.amount;
    }
    if (s.item) {
      const got = addItem(ctx.runtime.vars, s.item, Math.max(1, s.amount), itemsOf(ctx.assets).get(s.item));
      if (got > 0) autoSlot(ctx.runtime.vars, s.item);
      ctx.events.emit('item-given', { item: s.item, amount: got });
    }
    if (s.message) ctx.events.emit('message', { text: ctx.assets.strings.t(s.message) });
    ctx.events.emit('pickup', { entity: e.id, by: hit.id, variable: s.variable, amount: s.amount });
    ctx.world.destroy(e);
  },
});
