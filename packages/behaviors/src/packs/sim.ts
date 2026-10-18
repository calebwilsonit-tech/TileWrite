import { automaton, calendar, canAfford, earn, pathFollower, producer, spend, utilityAgent, waveSpawner } from '../builtins/sim';
import type { ActionDef, ConditionDef } from '../events/sheet';
import { registerPack, type Pack } from '../packs';

const conditions: ConditionDef[] = [
  {
    id: 'canAfford',
    label: 'The player can afford something',
    category: 'Simulation',
    params: [{ key: 'costs', label: 'Costs (name:amount, ...)', type: 'text', default: 'gold:10' }],
    describe: (p) => `there is enough to pay ${String(p.costs ?? '')}`,
    test: (ctx, p) => canAfford(ctx.runtime.vars, String(p.costs ?? '')),
  },
  {
    id: 'timeIs',
    label: 'The time of day or season is',
    category: 'Simulation',
    params: [
      { key: 'when', label: 'It is', type: 'select', default: 'night', options: [{ value: 'night', label: 'night' }, { value: 'day', label: 'day' }, { value: 'morning', label: 'morning (6-12)' }, { value: 'afternoon', label: 'afternoon (12-18)' }, { value: 'spring', label: 'spring' }, { value: 'summer', label: 'summer' }, { value: 'autumn', label: 'autumn' }, { value: 'winter', label: 'winter' }] },
    ],
    describe: (p) => `it is ${String(p.when ?? 'night')}`,
    test: (ctx, p) => {
      const v = ctx.runtime.vars;
      const hour = Number(v['time.hour'] ?? 0);
      switch (String(p.when)) {
        case 'night':
          return v['time.night'] === true;
        case 'day':
          return v['time.night'] !== true;
        case 'morning':
          return hour >= 6 && hour < 12;
        case 'afternoon':
          return hour >= 12 && hour < 18;
        default:
          return v['time.seasonName'] === String(p.when);
      }
    },
  },
  {
    id: 'waveIs',
    label: 'The wave of enemies is',
    category: 'Simulation',
    params: [{ key: 'state', label: 'State', type: 'select', default: 'fighting', options: [{ value: 'resting', label: 'resting before the next wave' }, { value: 'spawning', label: 'arriving' }, { value: 'fighting', label: 'being fought' }, { value: 'done', label: 'all done' }] }],
    describe: (p) => `the wave is ${String(p.state ?? 'fighting')}`,
    test: (ctx, p) => ctx.runtime.vars['wave.state'] === String(p.state),
  },
];

const actions: ActionDef[] = [
  {
    id: 'spend',
    label: 'Pay a cost (if it can be afforded)',
    category: 'Simulation',
    params: [{ key: 'costs', label: 'Costs (name:amount, ...)', type: 'text', default: 'gold:10' }],
    describe: (p) => `pay ${String(p.costs ?? '')} (if there is enough)`,
    run: (ctx, p) => void (ctx.runtime.vars['spend.ok'] = spend(ctx.runtime.vars, String(p.costs ?? ''))),
  },
  {
    id: 'earn',
    label: 'Receive resources',
    category: 'Simulation',
    params: [{ key: 'gains', label: 'Gains (name:amount, ...)', type: 'text', default: 'gold:10' }],
    describe: (p) => `receive ${String(p.gains ?? '')}`,
    run: (ctx, p) => earn(ctx.runtime.vars, String(p.gains ?? '')),
  },
  {
    id: 'nextWave',
    label: 'Start the next wave of enemies',
    category: 'Simulation',
    params: [],
    describe: () => 'start the next wave',
    run(ctx) {
      // the event log is cleared every tick, so the request waits here until the spawner takes it
      ctx.runtime.scratch.set('wave-next', true);
      ctx.events.emit('wave-next', {});
    },
  },
];

/** Resources and production, a calendar, waves, routes, needs and cellular automata. */
export const simPack: Pack = {
  id: 'sim',
  name: 'Simulation helpers',
  version: '1.0.0',
  description: 'Resources and production chains, a calendar with day and night and seasons, waves of enemies from a table, units that follow a route, villagers that choose by their needs, and cellular automata (fire, growth, spreading water).',
  builtin: true,
  install(api) {
    for (const b of [producer, calendar, waveSpawner, pathFollower, utilityAgent, automaton]) api.behavior(b as never);
    for (const c of conditions) api.condition(c);
    for (const a of actions) api.action(a);
  },
};

registerPack(simPack);
