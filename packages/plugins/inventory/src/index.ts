import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json';
import { actions, conditions } from './blocks';
import { quickSlotSystem } from './inventory';
import { pickup } from './pickup';

export * from './pickup';
export * from './inventory';

export const inventoryPlugin = definePlugin(manifest, {
  install(api) {
    api.behaviors(pickup);
    api.conditions(...conditions);
    api.actions(...actions);
    api.inputAction('inventory', { label: 'Inventory', bindings: ['key:KeyI', 'pad:button8'] });
    api.inputAction('quick_1', { label: 'Quick slot 1', bindings: ['key:Digit1'] });
    api.inputAction('quick_2', { label: 'Quick slot 2', bindings: ['key:Digit2'] });
    api.inputAction('quick_3', { label: 'Quick slot 3', bindings: ['key:Digit3'] });
    api.inputAction('quick_4', { label: 'Quick slot 4', bindings: ['key:Digit4'] });
    api.system('quick-slots', quickSlotSystem, 'player', 'after-player');
  },
});
