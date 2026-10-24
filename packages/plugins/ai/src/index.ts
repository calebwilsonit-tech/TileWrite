import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json';
import { events } from './events';
import { bossPhases, chase, patrol, vision } from './ai';
import { stateMachine } from './brain';
import { behaviorTree } from './tree';

export * from './ai';
export * from './brain';
export * from './tree';

export const aiPlugin = definePlugin(manifest, {
  install(api) {
    for (const e of events) api.event(e);
    api.behaviors(vision, chase, patrol, bossPhases, behaviorTree, stateMachine);
  },
});
