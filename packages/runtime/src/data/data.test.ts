import { describe, expect, it } from 'vitest';
import { World } from '../scene/world';
import { checkTable, coerceCell, csvIntoTable, freshRowId, newRow, newTable, readCell, selectRows, tableToCsv, TableSchema, type TableData } from './tables';
import { evalExpression, evalValue } from './expr';
import { fillValues, resolveValue, type ValueSource } from './values';

const units = (): TableData =>
  TableSchema.parse({
    name: 'Units',
    columns: [
      { id: 'name', type: 'text' },
      { id: 'hp', type: 'number' },
      { id: 'kind', type: 'select', options: ['melee', 'ranged'] },
      { id: 'boss', type: 'boolean' },
    ],
    rows: [
      { id: 'knight', name: 'Knight', hp: 10, kind: 'melee', boss: false },
      { id: 'archer', name: 'Archer', hp: 6, kind: 'ranged', boss: false },
    ],
  });

const source = (extra: Record<string, number | string | boolean> = {}): ValueSource => {
  const world = new World();
  world.spawn({ name: 'Hero', components: { health: { hp: 7, nested: { deep: 3 } } } });
  return { vars: { gold: 12, ...extra }, tables: new Map([['Units', units()]]), world };
};

describe('data tables', () => {
  it('read a cell as Table.row.column', () => {
    const tables = new Map([['Units', units()]]);
    expect(readCell(tables, 'Units.knight.hp')).toBe(10);
    expect(readCell(tables, 'Units.archer.kind')).toBe('ranged');
    expect(readCell(tables, 'Units.knight.id')).toBe('knight');
    expect(readCell(tables, 'Units.ghost.hp')).toBeUndefined();
    expect(readCell(tables, 'Nope.knight.hp')).toBeUndefined();
    expect(readCell(tables, 'Units.knight')).toBeUndefined();
  });

  it('selects rows and starts new rows from the column defaults', () => {
    const t = units();
    expect(selectRows(t, { kind: 'ranged' }).map((r) => r.id)).toEqual(['archer']);
    expect(newRow(t, 'new')).toEqual({ id: 'new', name: '', hp: 0, kind: 'melee', boss: false });
    expect(freshRowId(t, 'unit')).toBe('unit3');
    expect(coerceCell(t.columns[1]!, '12')).toBe(12);
    expect(coerceCell(t.columns[3]!, 'yes')).toBe(true);
  });

  it('explain what is wrong in plain English', () => {
    const t = TableSchema.parse({
      name: 'Loot',
      columns: [{ id: 'kind', type: 'select' }, { id: 'drop', type: 'ref', table: 'Missing' }, { id: 'kind', type: 'text' }, { id: 'id', type: 'text' }],
      rows: [{ id: 'a', kind: 'x' }, { id: 'a' }],
    });
    const p = checkTable(t, new Map()).join('\n');
    expect(p).toContain('is a list but has no choices');
    expect(p).toContain('points at the table "Missing"');
    expect(p).toContain('Two columns of "Loot" are both called "kind"');
    expect(p).toContain('is called "id"');
    expect(p).toContain('Two rows of "Loot" are both called "a"');
    expect(checkTable(units(), new Map())).toEqual([]);
    const bad = units();
    bad.rows[0]!.kind = 'magic';
    expect(checkTable(bad, new Map()).join('\n')).toContain('"magic", which is not one of melee, ranged');
  });

  it('go to CSV and back, adding columns the table did not have', () => {
    const t = units();
    const csv = tableToCsv(t);
    expect(csv.split('\n')[0]).toBe('id,name,hp,kind,boss');
    const back = csvIntoTable(newTable('Units'), csv);
    expect(back.rows).toHaveLength(2);
    expect(back.columns.map((c) => c.id)).toEqual(['name', 'hp', 'kind', 'boss']);
    const more = csvIntoTable(units(), 'id,name,cost\nmage,"Mage, the ""Wise""",30\n');
    expect(more.columns.map((c) => c.id)).toContain('cost');
    expect(more.rows).toEqual([{ id: 'mage', name: 'Mage, the "Wise"', cost: '30' }]);
  });
});

describe('values', () => {
  it('one name works for variables, table cells and object fields', () => {
    const s = source();
    expect(resolveValue(s, 'gold')).toBe(12);
    expect(resolveValue(s, 'Units.knight.hp')).toBe(10);
    expect(resolveValue(s, '@Hero.health.hp')).toBe(7);
    expect(resolveValue(s, '@Hero.health.nested.deep')).toBe(3);
    expect(resolveValue(s, '@Nobody.health.hp')).toBeUndefined();
    expect(resolveValue(s, 'nothing')).toBeUndefined();
  });

  it('fills names into text and leaves unknown ones alone', () => {
    expect(fillValues('{gold} coins, a {Units.archer.name} has {Units.archer.hp} hp {nope}', source())).toBe('12 coins, a Archer has 6 hp {nope}');
  });
});

describe('arithmetic', () => {
  it('works out sums without running code', () => {
    expect(evalExpression('1 + 2 * 3')).toBe(7);
    expect(evalExpression('(1 + 2) * 3')).toBe(9);
    expect(evalExpression('-4 + 10 / 4')).toBe(-1.5);
    expect(evalExpression('min(3, 8) + max(1, 2)')).toBe(5);
    expect(evalExpression('floor(7 / 2)')).toBe(3);
    expect(evalExpression('10 % 4')).toBe(2);
    expect(evalExpression('1 / 0')).toBe(0);
    expect(evalExpression('process.exit()')).toBeNull();
    expect(evalExpression('2 +')).toBeNull();
    expect(evalExpression('foo(2)')).toBeNull();
    expect(evalExpression('')).toBeNull();
  });

  it('typed values may name data and do arithmetic on it', () => {
    const s = source();
    expect(evalValue(s, '5')).toBe(5);
    expect(evalValue(s, 'true')).toBe(true);
    expect(evalValue(s, 'hello')).toBe('hello');
    expect(evalValue(s, '{gold}')).toBe(12);
    expect(evalValue(s, '{Units.knight.name}')).toBe('Knight');
    expect(evalValue(s, '{gold} - {Units.knight.hp}')).toBe(2);
    expect(evalValue(s, '({gold} + 3) * 2')).toBe(30);
    expect(evalValue(s, 'a-b')).toBe('a-b');
    expect(evalValue(s, '{missing} + 1')).toBe('{missing} + 1');
  });
});
