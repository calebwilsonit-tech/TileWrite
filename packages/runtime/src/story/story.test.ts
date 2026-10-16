import { describe, expect, it } from 'vitest';
import type { VariableValue } from '../project/schema';
import {
  DialogueSchema,
  advanceDialogue,
  checkDialogue,
  chooseDialogue,
  evalCondition,
  fillText,
  newDialogue,
  startDialogue,
  type DialogueData,
  type DialogueHost,
} from './dialogue';
import { ItemSchema, ItemsFileSchema, addItem, assignSlot, autoSlot, carried, itemCount, quickSlots, type ItemData } from './items';

const items = new Map<string, ItemData>([
  ['key', ItemSchema.parse({ id: 'key', name: 'Brass key', max: 3 })],
  ['bread', ItemSchema.parse({ id: 'bread', name: 'Bread', use: { heal: 2 } })],
]);

function host(vars: Record<string, VariableValue> = {}): DialogueHost & { events: string[] } {
  const events: string[] = [];
  return { vars, items, events, emit: (t) => void events.push(t) };
}

const talk: DialogueData = DialogueSchema.parse({
  name: 'Keeper',
  start: 'hello',
  nodes: [
    { id: 'hello', type: 'line', speaker: 'Keeper', text: 'Welcome, {player}.', next: 'ask' },
    {
      id: 'ask',
      type: 'choice',
      speaker: 'Keeper',
      prompt: 'Need a key?',
      options: [
        { text: 'Yes please', next: 'giveKey' },
        { text: 'I have one already', if: { kind: 'item', item: 'key', atLeast: 1 }, next: 'bye' },
        { text: 'No thanks', next: 'bye' },
      ],
    },
    { id: 'giveKey', type: 'give', item: 'key', amount: 1, next: 'flag' },
    { id: 'flag', type: 'set', variable: 'metKeeper', value: true, next: 'check' },
    { id: 'check', type: 'branch', if: { kind: 'item', item: 'key', atLeast: 1 }, then: 'thanks', else: 'bye' },
    { id: 'thanks', type: 'line', speaker: 'Keeper', text: 'Take care.', next: 'bye' },
    { id: 'bye', type: 'end' },
  ],
});

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
    expect(ItemsFileSchema.safeParse({ items: [{ id: 'ok-1', name: 'Fine' }] }).success).toBe(true);
    expect(ItemSchema.safeParse({ id: 'has space', name: 'Bad' }).success).toBe(false);
    expect(ItemSchema.safeParse({ id: 'x', name: '' }).success).toBe(false);
  });
});

describe('dialogue', () => {
  it('runs lines, choices and silent steps, filling in variables', () => {
    const h = host({ player: 'Ada' });
    let s = startDialogue(talk, h)!;
    expect(s.view).toEqual({ kind: 'line', speaker: 'Keeper', text: 'Welcome, Ada.' });
    s = advanceDialogue(talk, s, h)!;
    expect(s.view.kind).toBe('choice');
    if (s.view.kind === 'choice') expect(s.view.options.map((o) => o.text)).toEqual(['Yes please', 'No thanks']); // the second needs a key
    s = chooseDialogue(talk, s, 0, h)!; // give key, set flag, branch -> "Take care."
    expect(s.view).toMatchObject({ kind: 'line', text: 'Take care.' });
    expect(itemCount(h.vars, 'key')).toBe(1);
    expect(h.vars['slot:1']).toBe('key'); // a new item goes in the first free quick slot
    expect(h.vars.metKeeper).toBe(true);
    expect(h.events).toEqual(['item-given', 'variable-set']);
    expect(advanceDialogue(talk, s, h)).toBeNull(); // to the end node
  });

  it('shows conditional options once the condition holds', () => {
    const h = host({ 'item:key': 1 });
    let s = startDialogue(talk, h)!;
    s = advanceDialogue(talk, s, h)!;
    if (s.view.kind === 'choice') expect(s.view.options.map((o) => o.text)).toEqual(['Yes please', 'I have one already', 'No thanks']);
    expect(chooseDialogue(talk, s, 1, h)).toBeNull(); // goes straight to the end
  });

  it('ignores a choice that is not on offer', () => {
    const h = host();
    let s = startDialogue(talk, h)!;
    s = advanceDialogue(talk, s, h)!;
    expect(chooseDialogue(talk, s, 1, h)).toBe(s); // option 1 needs a key
    expect(chooseDialogue(talk, s, 9, h)).toBe(s);
    expect(advanceDialogue(talk, s, h)).toBeNull(); // advance only works on a line
  });

  it('set can add and toggle; give can take; branch picks a way', () => {
    const d = DialogueSchema.parse({
      name: 'T',
      start: 'a',
      nodes: [
        { id: 'a', type: 'set', variable: 'n', op: 'add', value: 2, next: 'b' },
        { id: 'b', type: 'set', variable: 'n', op: 'add', value: 3, next: 'c' },
        { id: 'c', type: 'set', variable: 'flag', op: 'toggle', next: 'd' },
        { id: 'd', type: 'give', item: 'bread', amount: -1, next: 'e' },
        { id: 'e', type: 'branch', if: { kind: 'variable', name: 'n', op: '>=', value: 5 }, then: 'yes', else: 'no' },
        { id: 'yes', type: 'line', text: 'big' },
        { id: 'no', type: 'line', text: 'small' },
      ],
    });
    const h = host({ 'item:bread': 2 });
    const s = startDialogue(d, h)!;
    expect(s.view).toMatchObject({ text: 'big' });
    expect(h.vars.n).toBe(5);
    expect(h.vars.flag).toBe(true);
    expect(itemCount(h.vars, 'bread')).toBe(1);
  });

  it('ends cleanly on loops without text, missing nodes and empty choices', () => {
    const loop = DialogueSchema.parse({ name: 'L', start: 'a', nodes: [{ id: 'a', type: 'set', variable: 'x', value: 1, next: 'a' }] });
    expect(startDialogue(loop, host())).toBeNull();
    const missing = DialogueSchema.parse({ name: 'M', start: 'nope', nodes: [] });
    expect(startDialogue(missing, host())).toBeNull();
    const empty = DialogueSchema.parse({ name: 'E', start: 'c', nodes: [{ id: 'c', type: 'choice', options: [{ text: 'x', if: { kind: 'variable', name: 'v', op: '=', value: 1 } }] }] });
    expect(startDialogue(empty, host())).toBeNull();
  });

  it('evaluates conditions and fills text', () => {
    const vars: Record<string, VariableValue> = { gold: 5, name: 'Ada', ok: true };
    expect(evalCondition({ kind: 'variable', name: 'gold', op: '>', value: 4 }, vars)).toBe(true);
    expect(evalCondition({ kind: 'variable', name: 'gold', op: '<=', value: 4 }, vars)).toBe(false);
    expect(evalCondition({ kind: 'variable', name: 'name', op: '=', value: 'Ada' }, vars)).toBe(true);
    expect(evalCondition({ kind: 'variable', name: 'missing', op: '!=', value: 1 }, vars)).toBe(true);
    expect(evalCondition({ kind: 'variable', name: 'name', op: '>', value: 1 }, vars)).toBe(false);
    expect(fillText('{name} has {gold} gold {nothing}', vars)).toBe('Ada has 5 gold {nothing}');
  });

  it('new dialogues are valid', () => {
    expect(DialogueSchema.safeParse(JSON.parse(JSON.stringify(newDialogue('Hi')))).success).toBe(true);
  });
});

describe('checkDialogue', () => {
  const known = { items: new Set(['key', 'bread']), variables: new Set(['n']) };

  it('is clean for a good dialogue', () => {
    expect(checkDialogue(talk, known)).toEqual([]);
  });

  it('explains dangling steps, missing items, empty text and unreachable nodes in plain English', () => {
    const bad = DialogueSchema.parse({
      name: 'Bad',
      start: 'a',
      nodes: [
        { id: 'a', type: 'line', text: '', next: 'zzz' },
        { id: 'b', type: 'give', item: 'sword', amount: 1 },
        { id: 'c', type: 'choice', options: [] },
        { id: 'a', type: 'end' },
      ],
    });
    const text = checkDialogue(bad, known).map((p) => p.text).join('\n');
    expect(text).toMatch(/Two nodes are both called "a"/);
    expect(text).toMatch(/goes to "zzz", which does not exist/);
    expect(text).toMatch(/has no text/);
    expect(text).toMatch(/"sword", which is not in your items list/);
    expect(text).toMatch(/has no options/);
    expect(text).toMatch(/"b" can never be reached/);
  });

  it('says when the start is missing or there is nothing at all', () => {
    expect(checkDialogue(DialogueSchema.parse({ name: 'Empty' }), known)[0]!.text).toMatch(/no nodes yet/);
    expect(checkDialogue(DialogueSchema.parse({ name: 'X', start: 'q', nodes: [{ id: 'a', type: 'end' }] }), known).map((p) => p.text).join()).toMatch(/starts at "q"/);
  });
});
