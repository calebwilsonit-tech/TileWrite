import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { events } from './events';
import { actions, conditions } from './blocks';
import { quickSlotSystem } from './inventory';
import { pickup } from './pickup';
import { quickSlotsWidget } from './hud';
import { ITEM_PREFIX, addItem, autoSlot, itemCount, itemsKind, itemsOf } from './items';
import { itemsSource, quickSlotsSource } from './sources';

export * from './pickup';
export * from './inventory';
export * from './hud';
export * from './items';

export const inventoryPlugin = definePlugin(manifest, {
  install(api) {
    api.assistantNote("Inventory: items the player carries (pickup), the inventory screen and four quick slots.");
    for (const e of events) api.event(e);
    api.behaviors(pickup);
    api.conditions(...conditions);
    api.actions(...actions);
    api.inputAction('inventory', { label: 'Inventory', bindings: ['key:KeyI', 'pad:button8'] });
    api.inputAction('quick_1', { label: 'Quick slot 1', bindings: ['key:Digit1'] });
    api.inputAction('quick_2', { label: 'Quick slot 2', bindings: ['key:Digit2'] });
    api.inputAction('quick_3', { label: 'Quick slot 3', bindings: ['key:Digit3'] });
    api.inputAction('quick_4', { label: 'Quick slot 4', bindings: ['key:Digit4'] });
    api.system('quick-slots', quickSlotSystem, 'player', 'after-player');
    api.widget(quickSlotsWidget);
    api.listSource(itemsSource);
    api.listSource(quickSlotsSource);
    // the project's items (assets/items.json), and the keeping of them that conversations, cutscenes, skins and scripts ask for
    api.dataKind(itemsKind);
    api.scriptMethod({ id: 'itemCount', run: (ctx, _self, [item]) => itemCount(ctx.runtime.vars, String(item)) });
    api.scriptMethod({
      id: 'giveItem',
      run(ctx, _self, [item, amount]) {
        const id = String(item);
        const n = amount === undefined ? 1 : Number(amount);
        const got = addItem(ctx.runtime.vars, id, n, itemsOf(ctx.assets).get(id));
        if (got > 0) autoSlot(ctx.runtime.vars, id);
        ctx.events.emit(n >= 0 ? 'item-given' : 'item-taken', { item: id, amount: got });
        return got;
      },
    });
    api.carrier({
      id: 'inventory',
      count: itemCount,
      variable: (id) => ITEM_PREFIX + id,
      give(ctx, id, amount) {
        const got = addItem(ctx.runtime.vars, id, amount, itemsOf(ctx.assets).get(id));
        if (got > 0) autoSlot(ctx.runtime.vars, id);
        return got;
      },
    });
  },
});
