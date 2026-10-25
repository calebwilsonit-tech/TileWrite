import { describe, expect, it } from 'vitest';
import { Simulation, UiDocSchema, newWidget, type UiNode } from '@tilewright/runtime';
import { host, rowsOf, putRecord, setActivePacks } from '@tilewright/plugin-sdk';
import '@tilewright/bundled-plugins';
import { ItemSchema } from './items';

const list = (source: string): UiNode => ({ ...newWidget('list', 'w1'), source, children: [{ ...newWidget('text', 'w2'), text: '{index}' }] });

describe('the lists the inventory gives screens', () => {
  it('the items carried, and the four quick slots', () => {
    setActivePacks(['inventory']);
    try {
      expect([...host.ext.listSources.keys()].sort()).toEqual(['items', 'quickslots']);
      const sim = new Simulation(1);
      sim.assets.ui = UiDocSchema.parse({ screens: [] });
      putRecord(sim.assets, 'items', 'key', ItemSchema.parse({ id: 'key', name: 'Brass key', description: 'Opens a door.' }));
      sim.runtime.vars['item:key'] = 3;
      sim.runtime.vars['slot:2'] = 'key';
      const items = rowsOf(sim, list('items'));
      expect(items.map((r) => [r.id, r.scope['item.count'], r.scope['item.name'], r.scope['item.slot']])).toEqual([['key', 3, 'Brass key', 2]]);
      const quick = rowsOf(sim, list('quickslots'));
      expect(quick).toHaveLength(4);
      expect(quick[1]!.scope).toMatchObject({ 'slot.number': 2, 'slot.item': 'key', 'slot.count': 3, 'slot.name': 'Brass key' });
      expect(quick[0]!.scope['slot.item']).toBe('');
    } finally {
      setActivePacks([]);
    }
  });

  it('are gone with the plugin: a screen listing items then shows nothing', () => {
    setActivePacks([]);
    const sim = new Simulation(1);
    sim.assets.ui = UiDocSchema.parse({ screens: [] });
    sim.runtime.vars['item:key'] = 3;
    expect(rowsOf(sim, list('items'))).toEqual([]);
  });
});
