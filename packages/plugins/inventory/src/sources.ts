import type { ListSourceDef, Simulation } from '@tilewright/plugin-sdk';
import { carried, itemsOf, quickSlots } from './items';

/** The line under an item's name: what it is, what pressing E does, which quick slot it sits in. */
function itemDetail(sim: Simulation, id: string): string {
  const def = itemsOf(sim.assets).get(id);
  const slot = quickSlots(sim.runtime.vars).indexOf(id);
  const t = sim.assets.strings;
  return [t.t(def?.description ?? ''), def?.use ? t.t('press E to use') : '', slot >= 0 ? t.fmt(t.t('slot {n}'), { n: slot + 1 }) : ''].filter(Boolean).join(' - ');
}

/** The items the player carries, one row each (for the inventory screen). */
export const itemsSource: ListSourceDef = {
  id: 'items',
  label: 'the items the player carries',
  fields: { 'item.id': 'Item id', 'item.name': 'Item name', 'item.count': 'How many carried', 'item.description': 'Its description', 'item.detail': 'Description, what E does, quick slot', 'item.usable': 'Can it be used (1 or 0)', 'item.slot': 'Its quick slot (0 for none)' },
  rows(sim) {
    const items = itemsOf(sim.assets);
    const t = sim.assets.strings;
    return carried(sim.runtime.vars).map(([id, count]) => ({
      id,
      scope: {
        'item.detail': itemDetail(sim, id),
        'item.id': id,
        'item.name': t.t(items.get(id)?.name ?? id),
        'item.count': count,
        'item.description': t.t(items.get(id)?.description ?? ''),
        'item.usable': items.get(id)?.use ? 1 : 0,
        'item.slot': quickSlots(sim.runtime.vars).indexOf(id) + 1,
        'item.color': items.get(id)?.color ?? 0,
      },
    }));
  },
};

/** The four quick slots, one row each (for the heads-up display and the inventory screen). */
export const quickSlotsSource: ListSourceDef = {
  id: 'quickslots',
  label: 'the four quick slots',
  fields: { 'slot.number': 'Slot number', 'slot.item': 'Item id in it', 'slot.name': 'Item name', 'slot.count': 'How many', 'slot.color': 'Item colour' },
  rows(sim) {
    const items = itemsOf(sim.assets);
    return quickSlots(sim.runtime.vars).map((id, i) => ({
      id: String(i + 1),
      scope: {
        'slot.number': i + 1,
        'slot.item': id,
        'slot.name': id ? sim.assets.strings.t(items.get(id)?.name ?? id) : '',
        'slot.count': id ? Number(sim.runtime.vars[`item:${id}`] ?? 0) : 0,
        'slot.color': id ? (items.get(id)?.color ?? 0) : 0,
      },
    }));
  },
};
