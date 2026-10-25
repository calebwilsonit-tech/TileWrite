import { describe, expect, it } from 'vitest';
import { DialogueSchema, startDialogue, type VariableValue } from '@tilewright/plugin-sdk';
import { ItemSchema, addItem, assignSlot, autoSlot, carried, itemCount, itemsKind, quickSlots, type ItemData } from './items';
import { parseDataFile } from '@tilewright/plugin-sdk';

const items = new Map<string, ItemData>([
  ['key', ItemSchema.parse({ id: 'key', name: 'Brass key', max: 3 })],
  ['bread', ItemSchema.parse({ id: 'bread', name: 'Bread', use: { heal: 2 } })],
]);

describe('items and inventory', () => {
  it('counts items in variables, honours limits, and never goes below zero', () => {
    const vars: Record<string, VariableValue> = {};
    expect(addItem(vars, 'key', 2, items.get('key'))).toBe(2);
    expect(addItem(vars, 'key', 5, items.get('key'))).toBe(1); // limit of 3
    expect(itemCount(vars, 'key')).toBe(3);
    expect(addItem(vars, 'key', -10)).toBe(-3);
    expect(itemCount(vars, 'key')).toBe(0);
    expect(vars['item:key']).toBeUndefined();
    expect(carried(vars)).toEqual([]);
  });

  it('lists what is carried and keeps quick slots tidy', () => {
    const vars: Record<string, VariableValue> = {};
    addItem(vars, 'bread', 2);
    addItem(vars, 'key', 1);
    expect(carried(vars)).toEqual([['bread', 2], ['key', 1]]);
    autoSlot(vars, 'bread');
    autoSlot(vars, 'key');
    autoSlot(vars, 'bread'); // already in a slot
    expect(quickSlots(vars)).toEqual(['bread', 'key', '', '']);
    assignSlot(vars, 4, 'bread'); // moving it frees its old slot
    expect(quickSlots(vars)).toEqual(['', 'key', '', 'bread']);
    addItem(vars, 'bread', -2); // used up: its slot empties
    expect(quickSlots(vars)).toEqual(['', 'key', '', '']);
  });

  it('validates item files and ids', () => {
    expect(parseDataFile(itemsKind, JSON.stringify({ items: [{ id: 'ok-1', name: 'Fine' }] })).problems).toEqual([]);
    expect(ItemSchema.safeParse({ id: 'has space', name: 'Bad' }).success).toBe(false);
    expect(ItemSchema.safeParse({ id: 'x', name: '' }).success).toBe(false);
    // one bad record and none is used (the reason is said)
    const bad = parseDataFile(itemsKind, JSON.stringify({ items: [{ id: 'ok-1', name: 'Fine' }, { id: 'no good', name: 'x' }] }));
    expect(bad.records).toEqual([]);
    expect(bad.problems[0]).toMatch(/^The items file is not valid/);
  });

  it('says what a person reads in an item, and is the kind the conversations can give', () => {
    const bread = ItemSchema.parse({ id: 'bread', name: 'Bread', description: 'Tasty.', use: { heal: 1, message: 'Mmm.' } });
    expect(itemsKind.texts!(bread)).toEqual([
      { text: 'Bread', where: 'Item Bread' },
      { text: 'Tasty.', where: 'Item Bread' },
      { text: 'Mmm.', where: 'Item Bread' },
    ]);
    expect(itemsKind.carries).toBe(true);
    expect(itemsKind.create([bread]).id).toBe('item2');
  });

  it('is what a conversation gives into: a new item goes in the first free quick slot', () => {
    const vars: Record<string, VariableValue> = {};
    const d = DialogueSchema.parse({ name: 'K', start: 'g', nodes: [{ id: 'g', type: 'give', item: 'key', amount: 1, next: 'l' }, { id: 'l', type: 'line', text: 'Take care.' }] });
    const events: string[] = [];
    const s = startDialogue(d, {
      vars,
      emit: (t) => void events.push(t),
      carrying: {
        count: (id) => itemCount(vars, id),
        give(id, amount) {
          const got = addItem(vars, id, amount, items.get(id));
          if (got > 0) autoSlot(vars, id);
          return got;
        },
      },
    })!;
    expect(s.view).toMatchObject({ text: 'Take care.' });
    expect(itemCount(vars, 'key')).toBe(1);
    expect(vars['slot:1']).toBe('key');
    expect(events).toEqual(['item-given']);
  });
});
