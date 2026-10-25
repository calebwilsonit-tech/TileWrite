import { filled, num, str, type ActionDef, type ConditionDef } from '@tilewright/plugin-sdk';
import { QUICK_SLOTS, addItem, autoSlot, itemCount, itemsOf, quickSlots } from './items';
import { useItem } from './inventory';

export const conditions: ConditionDef[] = [
  {
    id: 'hasItem',
    label: 'The player carries an item',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'atLeast', label: 'At least how many', type: 'number', default: 1, min: 1, step: 1 }],
    describe: (p) => `the player has at least ${num(p, 'atLeast', 1)} of "${str(p, 'item') || '(item)'}"`,
    test: (ctx, p) => itemCount(ctx.runtime.vars, str(p, 'item')) >= num(p, 'atLeast', 1),
  },
];

export const actions: ActionDef[] = [
  {
    id: 'useItem',
    label: 'Use an item',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }],
    describe: (p) => `use "${str(p, 'item') || '(item)'}"`,
    run: (ctx, p) => void useItem(ctx, filled(ctx, p, 'item')),
  },
  {
    id: 'quickSlot',
    label: 'Move an item to another quick slot',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'step', label: 'Slots to move (1 or -1)', type: 'text', default: '1' }],
    describe: (p) => `move "${str(p, 'item') || '(item)'}" ${str(p, 'step') === '-1' ? 'to the slot before' : 'to the next slot'}`,
    run(ctx, p) {
      const id = filled(ctx, p, 'item');
      const vars = ctx.runtime.vars;
      const step = Number(filled(ctx, p, 'step')) || 0;
      const at = quickSlots(vars).indexOf(id);
      // none, then each slot in turn
      const next = ((at + step + 1 + QUICK_SLOTS + 1) % (QUICK_SLOTS + 1)) - 1;
      for (let i = 1; i <= QUICK_SLOTS; i++) if (vars[`slot:${i}`] === id) vars[`slot:${i}`] = '';
      if (next >= 0) vars[`slot:${next + 1}`] = id;
    },
  },
  {
    id: 'giveItem',
    label: 'Give the player an item',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'amount', label: 'How many', type: 'number', default: 1, min: 1, step: 1 }],
    describe: (p) => `give the player ${num(p, 'amount', 1)} of "${str(p, 'item') || '(item)'}"`,
    run(ctx, p) {
      const got = addItem(ctx.runtime.vars, str(p, 'item'), num(p, 'amount', 1), itemsOf(ctx.assets).get(str(p, 'item')));
      if (got > 0) autoSlot(ctx.runtime.vars, str(p, 'item'));
      ctx.events.emit('item-given', { item: str(p, 'item'), amount: got });
    },
  },
  {
    id: 'takeItem',
    label: 'Take an item from the player',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'amount', label: 'How many', type: 'number', default: 1, min: 1, step: 1 }],
    describe: (p) => `take ${num(p, 'amount', 1)} of "${str(p, 'item') || '(item)'}" from the player`,
    run(ctx, p) {
      addItem(ctx.runtime.vars, str(p, 'item'), -num(p, 'amount', 1));
      ctx.events.emit('item-taken', { item: str(p, 'item') });
    },
  },
];
