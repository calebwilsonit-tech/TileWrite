import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { events } from './events';
import { actions, conditions } from './blocks';
import { quickSlotSystem } from './inventory';
import { pickup } from './pickup';
import { quickSlotsWidget } from './hud';

export * from './pickup';
export * from './inventory';
export * from './hud';

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
  },
});
