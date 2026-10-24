import { canAfford, earn, spend } from './sim';
import { type ActionDef, type ConditionDef } from '@tilewright/plugin-sdk';

export const conditions: ConditionDef[] = [
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

export const actions: ActionDef[] = [
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
