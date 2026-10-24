import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json';
import { bossPhases, chase, patrol, vision } from './ai';
import { stateMachine } from './brain';
import { behaviorTree } from './tree';

export * from './ai';
export * from './brain';
export * from './tree';

export const aiPlugin = definePlugin(manifest, {
  install(api) {
    api.behaviors(vision, chase, patrol, bossPhases, behaviorTree, stateMachine);
  },
});
