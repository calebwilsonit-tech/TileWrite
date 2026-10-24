import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { events } from './events';
import { bossPhases, chase, patrol, vision } from './ai';
import { stateMachine } from './brain';
import { behaviorTree } from './tree';

export * from './ai';
export * from './brain';
export * from './tree';

export const aiPlugin = definePlugin(manifest, {
  install(api) {
    api.assistantNote("AI: vision, chase and patrol; bossPhases turn an enemy into a boss; characters can think with a behaviorTree behaviour (a tree of sequence/selector/parallel/inverter/succeeder/repeat/cooldown nodes with condition and action leaves) or a stateMachine.");
    for (const e of events) api.event(e);
    api.behaviors(vision, chase, patrol, bossPhases, behaviorTree, stateMachine);
  },
});
