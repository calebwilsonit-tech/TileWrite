import { definePlugin } from '@tilewright/plugin-sdk';
import manifest from '../plugin.json' with { type: 'json' };
import { events } from './events';
import { actions, conditions } from './blocks';
import { automaton, calendar, pathFollower, producer, utilityAgent, waveSpawner } from './sim';

export * from './sim';

/** Resources and production, a calendar, waves, routes, needs and cellular automata. */
export const simPlugin = definePlugin(manifest, {
  install(api) {
    for (const e of events) api.event(e);
    api.behaviors(producer, calendar, waveSpawner, pathFollower, utilityAgent, automaton);
    api.conditions(...conditions);
    api.actions(...actions);
  },
});
