import { describe, expect, it } from 'vitest';
import { TableSchema, type PrefabData } from '@tilewright/runtime';
import { checkSheet, newAction, newCondition, newRow } from '@tilewright/behaviors';
import { madeVariables } from './story-vars';

const facts = { entityIds: new Set<string>(), tags: new Set<string>(), variables: new Set<string>(), prefabs: new Set<string>() };
const checkPop = (made: ReadonlySet<string>, assignedBy?: ReturnType<typeof newAction>) => {
  const row = { ...newRow('r1'), conditions: [{ ...newCondition('variable'), params: { name: 'pop', op: '>=', value: '20' } }], actions: [] };
  const rows = assignedBy ? [row, { ...newRow('r2'), actions: [assignedBy] }] : [row];
  return checkSheet(rows, { ...facts, storyVariables: made }).map((p) => p.text);
};

describe('variables the game makes by itself', () => {
  it('producers on objects and inside prefabs, and table "makes" columns, count as setting a variable', () => {
    const prefab = { schemaVersion: 1, name: 'House', root: { name: 'House', tags: [], children: [{ name: 'Inner', tags: [], children: [], components: { producer: { makes: 'pop:1', uses: 'food:1' } } }], components: {} } } as unknown as PrefabData;
    const table = TableSchema.parse({ name: 'Activities', columns: [{ id: 'makes', type: 'text' }], rows: [{ id: 'a', makes: 'wood:2, stone:1' }] });
    const made = madeVariables([{ components: { producer: { makes: 'gold:6', uses: '' }, pickup: { variable: 'coins' } } }], [prefab], [table]);
    expect([...made].sort()).toEqual(['coins', 'food', 'gold', 'pop', 'stone', 'wood']);
  });

  it('a row may check what a producer makes, and what another row pays or receives', () => {
    expect(checkPop(new Set())).toHaveLength(1);
    expect(checkPop(new Set(['pop']))).toEqual([]);
    expect(checkPop(new Set(), { ...newAction('earn'), params: { gains: 'pop:1, gold:2' } })).toEqual([]);
    expect(checkPop(new Set(), { ...newAction('spend'), params: { costs: 'gold:2' } })).toHaveLength(1);
  });
});
