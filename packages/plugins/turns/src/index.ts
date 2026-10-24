import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json';
import { events } from './events';
import { actions, conditions } from './blocks';
import { gridMover, turnSystem, turnTaker, unitAi } from './turns';

export * from './turns';

/** By-turns play: units with action points and a queue, walking on the grid, enemies that play their own turns. */
export const turnsPlugin = definePlugin(manifest, {
  install(api) {
    for (const e of events) api.event(e);
    api.behaviors(turnTaker, gridMover, unitAi);
    api.conditions(...conditions);
    api.actions(...actions);
    api.system('turns', turnSystem, 'gameplay');
    api.inputAction('end_turn', { label: 'End the turn', bindings: ['key:Space', 'pad:button3'] });
  },
});
