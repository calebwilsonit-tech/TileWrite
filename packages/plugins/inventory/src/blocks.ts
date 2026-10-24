import { addItem, autoSlot, itemCount, num, str, type ActionDef, type ConditionDef } from '@tilewright/plugin-sdk';

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
    id: 'giveItem',
    label: 'Give the player an item',
    category: 'Story',
    params: [{ key: 'item', label: 'Item (id)', type: 'text', default: '' }, { key: 'amount', label: 'How many', type: 'number', default: 1, min: 1, step: 1 }],
    describe: (p) => `give the player ${num(p, 'amount', 1)} of "${str(p, 'item') || '(item)'}"`,
    run(ctx, p) {
      const got = addItem(ctx.runtime.vars, str(p, 'item'), num(p, 'amount', 1), ctx.assets.items.get(str(p, 'item')));
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
