import { describe, expect, it } from 'vitest';
import { TableSchema } from '@tilewright/runtime';
import { ctxOf, flatScene, rig } from '@tilewright/plugin-sdk/testing';
import { actionDef, setActivePacks } from '@tilewright/behaviors';

setActivePacks(undefined);

const loot = TableSchema.parse({
  name: 'Loot',
  columns: [{ id: 'name', type: 'text' }, { id: 'weight', type: 'number' }, { id: 'gold', type: 'number' }],
  rows: [
    { id: 'coin', name: 'Coins', weight: 6, gold: 5 },
    { id: 'hoard', name: 'A hoard', weight: 1, gold: 50 },
    { id: 'never', name: 'Never', weight: 0, gold: 999 },
  ],
});

const roll = (seed: number, times: number, params: Record<string, unknown> = {}): string[] => {
  const r = rig(flatScene(4, 4).scene, { seed });
  r.sim.assets.tables.set('Loot', loot);
  const out: string[] = [];
  for (let i = 0; i < times; i++) {
    actionDef('rollTable')!.run(ctxOf(r), { table: 'Loot', weight: 'weight', into: 'roll', ...params }, { picked: undefined } as never);
    out.push(String(r.sim.runtime.vars['roll.id']));
  }
  return out;
};

describe('rolling a random row of a table', () => {
  it('picks rows by weight, never a row with weight zero, and puts every column in variables', () => {
    const many = roll(3, 700);
    expect(many.includes('never')).toBe(false);
    const hoards = many.filter((x) => x === 'hoard').length;
    expect(hoards).toBeGreaterThan(40); // about 1 in 7
    expect(hoards).toBeLessThan(180);
    const r = rig(flatScene(4, 4).scene, { seed: 1 });
    r.sim.assets.tables.set('Loot', loot);
    actionDef('rollTable')!.run(ctxOf(r), { table: 'Loot', weight: 'weight', into: 'drop' }, { picked: undefined } as never);
    expect(r.sim.runtime.vars['drop.name']).toBe(r.sim.runtime.vars['drop.id'] === 'coin' ? 'Coins' : 'A hoard');
    expect(r.sim.runtime.vars['drop.gold']).toBeGreaterThan(0);
  });

  it('the same seed rolls the same things, a different seed does not; an empty weight column means all rows are equal', () => {
    expect(roll(7, 30)).toEqual(roll(7, 30));
    expect(roll(7, 30)).not.toEqual(roll(8, 30));
    expect(new Set(roll(5, 200, { weight: '' })).has('never')).toBe(true);
  });

  it('a missing table rolls nothing instead of failing', () => {
    expect(roll(1, 1, { table: 'Nope' })).toEqual(['']);
  });
});
