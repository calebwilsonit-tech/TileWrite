import { afterEach, describe, expect, it } from 'vitest';
import { CustomBehaviorSchema, CustomComponentSchema, TableSchema, type EventRow } from '@tilewright/runtime';
import { flatScene, rig, thing } from './testing';
import { customNameProblem, getBehavior, hasCustomBlock, newAction, newCondition, newRow, syncCustomBlocks } from './index';

afterEach(() => syncCustomBlocks([], []));

const stats = CustomComponentSchema.parse({
  name: 'Stats',
  description: 'Numbers for a unit',
  fields: [
    { key: 'hp', label: 'Hit points', type: 'number', default: 10, min: 0, max: 99 },
    { key: 'team', type: 'select', options: ['red', 'blue'], default: 'blue' },
    { key: 'tint', type: 'color', default: '#ff0000' },
    { key: 'kind', type: 'tableRow', table: 'Units' },
  ],
});

function row(id: string, conds: ReturnType<typeof newCondition>[], acts: ReturnType<typeof newAction>[], extra: Partial<EventRow> = {}): EventRow {
  return { ...newRow(id), conditions: conds, actions: acts, ...extra };
}

describe('custom components', () => {
  it('appear like built-in behaviours, with typed settings and their own defaults', () => {
    expect(syncCustomBlocks([stats], [])).toEqual([]);
    const def = getBehavior('Stats')!;
    expect(def.category).toBe('Custom components');
    expect(def.dataOnly).toBe(true);
    expect(def.defaults).toEqual({ hp: 10, team: 'blue', tint: '#ff0000', kind: '' });
    expect(def.fields.map((f) => f.type)).toEqual(['number', 'select', 'color', 'tableRow']);
    expect(def.fields[1]!.options).toEqual([{ value: 'red', label: 'red' }, { value: 'blue', label: 'blue' }]);
    expect(def.fields[0]).toMatchObject({ min: 0, max: 99 });
    expect(hasCustomBlock('Stats')).toBe(true);
  });

  it('leave out names that clash with the engine or each other, and say so', () => {
    const clash = CustomComponentSchema.parse({ name: 'health' });
    const sprite = CustomComponentSchema.parse({ name: 'sprite' });
    const problems = syncCustomBlocks([stats, clash, sprite, stats], []);
    expect(problems.join('\n')).toContain('"health" was left out');
    expect(problems.join('\n')).toContain('"sprite"');
    expect(problems.join('\n')).toContain('There is already something called "Stats"');
    expect(getBehavior('Stats')).toBeDefined();
    expect(customNameProblem('bad name')).toMatch(/letters and numbers/);
  });

  it('are taken out again when the project changes', () => {
    syncCustomBlocks([stats], []);
    syncCustomBlocks([], []);
    expect(getBehavior('Stats')).toBeUndefined();
  });
});

describe('custom behaviours', () => {
  const grower = CustomBehaviorSchema.parse({
    name: 'Grower',
    description: 'Counts up',
    params: [{ key: 'step', type: 'number', default: 2 }, { key: 'unit', type: 'tableRow', table: 'Units' }],
    rows: [row('a', [newCondition('always')], [{ ...newAction('setVariable'), params: { name: 'total', op: 'add', value: '{self.step}' } }, { ...newAction('setVariable'), params: { name: 'hpOf', op: 'set', value: '{Units.{self.unit}.hp}' } }])],
  });

  function game(settings: Record<string, object>) {
    const { scene } = flatScene();
    scene.entities.push(thing('a', 'A', 3, 3, settings));
    scene.entities.push(thing('b', 'B', 6, 6, { Grower: { step: 5, unit: 'archer' } }));
    const r = rig(scene);
    r.sim.assets.tables.set('Units', TableSchema.parse({ name: 'Units', columns: [{ id: 'hp', type: 'number' }], rows: [{ id: 'knight', hp: 10 }, { id: 'archer', hp: 6 }] }));
    return r;
  }

  it('run their rows for every object that has them, each with its own settings', () => {
    syncCustomBlocks([], [grower]);
    const r = game({ Grower: { step: 2, unit: 'knight' } });
    r.run(3);
    // A adds 2 and B adds 5 every tick; the row memory of each is kept apart
    expect(r.sim.runtime.vars.total).toBe(21);
    // the last object to run read its own table row
    expect(r.sim.runtime.vars.hpOf).toBe(6);
    // nothing of the object's settings is left behind in the variables
    expect(Object.keys(r.sim.runtime.vars).filter((k) => k.startsWith('self.'))).toEqual([]);
  });

  it('can use table rows in loops and "this object" in rows', () => {
    const loop = CustomBehaviorSchema.parse({
      name: 'Summer',
      rows: [row('loop', [newCondition('always')], [{ ...newAction('setVariable'), params: { name: 'sum', op: 'add', value: '{row.hp}' } }], { forEach: 'table:Units' })],
    });
    syncCustomBlocks([], [loop]);
    const { scene } = flatScene();
    scene.entities.push(thing('a', 'A', 3, 3, { Summer: {} }));
    const r = rig(scene);
    r.sim.assets.tables.set('Units', TableSchema.parse({ name: 'Units', columns: [{ id: 'hp', type: 'number' }], rows: [{ id: 'k', hp: 10 }, { id: 'a', hp: 6 }] }));
    r.run(2);
    expect(r.sim.runtime.vars.sum).toBe(32);
    expect(Object.keys(r.sim.runtime.vars).filter((k) => k.startsWith('row.'))).toEqual([]);
  });
});
