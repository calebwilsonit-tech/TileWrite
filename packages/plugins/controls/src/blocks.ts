import { fillValues, resolveRef, type ActionDef, type ConditionDef } from '@tilewright/plugin-sdk';
import { giveOrder, useHotspot, type Order } from './controls';

const entity = (key: string, label: string, def: string) => ({ key, label, type: 'entity' as const, default: def });

export const conditions: ConditionDef[] = [
  {
    id: 'hotspotUsed',
    label: 'A hotspot was used',
    category: 'Control schemes',
    params: [
      { key: 'name', label: 'Hotspot name (empty for any)', type: 'text', default: '' },
      { key: 'verb', label: 'Verb', type: 'select', default: '', options: [{ value: '', label: 'any' }, { value: 'look', label: 'look at' }, { value: 'use', label: 'use' }, { value: 'talk', label: 'talk to' }] },
    ],
    describe: (p) => `${String(p.verb ?? '') || 'a verb'} was used on ${String(p.name ?? '') || 'a hotspot'}`,
    test: (ctx, p) => ctx.events.of('hotspot-used').some((d) => (String(p.name ?? '') === '' || d.name === p.name) && (String(p.verb ?? '') === '' || d.verb === p.verb)),
  },
];

export const actions: ActionDef[] = [
  {
    id: 'orderUnits',
    label: 'Order units somewhere',
    category: 'Control schemes',
    params: [
      entity('who', 'Units', 'tag:unit'),
      { key: 'order', label: 'Order', type: 'select', default: 'attackMove', options: [{ value: 'move', label: 'walk to' }, { value: 'attackMove', label: 'attack-move to (fight anything on the way)' }, { value: 'stop', label: 'stop' }] },
      { key: 'x', label: 'Cell across', type: 'number', default: 0, step: 1 },
      { key: 'y', label: 'Cell down', type: 'number', default: 0, step: 1 },
      { key: 'queue', label: 'After their current orders', type: 'boolean', default: false },
    ],
    describe: (p) => `${String(p.who ?? '')} ${String(p.order ?? 'attackMove')} ${Number(p.x ?? 0)}, ${Number(p.y ?? 0)}`,
    run(ctx, p, row) {
      const order: Order = String(p.order) === 'stop' ? { type: 'stop' } : { type: String(p.order) === 'move' ? 'move' : 'attackMove', x: Number(p.x ?? 0) + 0.5, y: Number(p.y ?? 0) + 0.5 };
      for (const e of resolveRef(ctx, String(p.who ?? ''), row.picked)) if (e.has('commandable')) giveOrder(e, order, p.queue === true);
    },
  },
  {
    id: 'selectBuilding',
    label: 'Choose a building to place',
    category: 'Control schemes',
    params: [{ key: 'row', label: 'Row of the buildings table (empty to put it away)', type: 'text', default: '' }],
    describe: (p) => (String(p.row ?? '') ? `choose the building "${String(p.row)}" to place` : 'put the building away'),
    // a list of buildings passes the row it is showing: {row.id}
    run: (ctx, p) => void (ctx.runtime.vars['build.selected'] = fillValues(String(p.row ?? ''), { vars: ctx.runtime.vars, tables: ctx.assets.tables, world: ctx.world })),
  },
  {
    id: 'setVerb',
    label: 'Choose the verb (look, use, talk)',
    category: 'Control schemes',
    params: [{ key: 'verb', label: 'Verb', type: 'select', default: 'use', options: [{ value: 'look', label: 'look at' }, { value: 'use', label: 'use' }, { value: 'talk', label: 'talk to' }] }],
    describe: (p) => `the verb is now ${String(p.verb ?? 'use')}`,
    run: (ctx, p) => void (ctx.runtime.vars.verb = String(p.verb ?? 'use')),
  },
  {
    id: 'useHotspot',
    label: 'Use a hotspot',
    category: 'Control schemes',
    params: [entity('who', 'Hotspot', 'picked'), { key: 'verb', label: 'Verb', type: 'select', default: 'use', options: [{ value: 'look', label: 'look at' }, { value: 'use', label: 'use' }, { value: 'talk', label: 'talk to' }] }],
    describe: (p) => `${String(p.verb ?? 'use')} ${String(p.who ?? '')}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, String(p.who ?? ''), row.picked)) useHotspot(ctx, e, String(p.verb ?? 'use'));
    },
  },
  {
    id: 'turnView',
    label: 'Turn the world to another view',
    category: 'Control schemes',
    params: [{ key: 'view', label: 'View', type: 'select', default: '1', options: [{ value: '0', label: 'the usual view' }, { value: '1', label: 'a quarter turn' }, { value: '2', label: 'a half turn' }, { value: '3', label: 'three quarters' }] }],
    describe: (p) => `turn the world to view ${String(p.view ?? '0')}`,
    run: (ctx, p) => void (ctx.runtime.view.rotation = (Number(p.view ?? 0) % 4) as 0 | 1 | 2 | 3),
  },
];
