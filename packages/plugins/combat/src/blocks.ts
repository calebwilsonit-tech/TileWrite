import { COMPARISONS, compare, describeRef, entityParam, num, resolveRef, str, type ActionDef, type ConditionDef } from '@tilewright/plugin-sdk';
import { damage, heal, healthOf } from './combat';

export const conditions: ConditionDef[] = [
  {
    id: 'health',
    label: "An object's health compares",
    category: 'Objects',
    params: [entityParam('who', 'Object', 'player'), { key: 'op', label: 'Is', type: 'select', default: '<=', options: COMPARISONS }, { key: 'value', label: 'Hit points', type: 'number', default: 1, step: 1 }],
    describe: (p, n) => `${describeRef(str(p, 'who'), n)} has ${COMPARISONS.find((c) => c.value === str(p, 'op'))?.label ?? str(p, 'op')} ${num(p, 'value', 1)} hit points`,
    test: (ctx, p, row) =>
      resolveRef(ctx, str(p, 'who'), row.picked).some((e) => {
        const h = healthOf(e);
        return !!h && compare(h.hp, str(p, 'op'), num(p, 'value', 1));
      }),
  },
];

export const actions: ActionDef[] = [
  {
    id: 'damage',
    label: 'Hurt an object',
    category: 'Combat',
    params: [entityParam('who', 'Object', 'player'), { key: 'amount', label: 'Damage', type: 'number', default: 1, min: 0, step: 1 }],
    describe: (p, n) => `hurt ${describeRef(str(p, 'who'), n)} for ${num(p, 'amount', 1)}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) damage(ctx, e, num(p, 'amount', 1), { ignoreIframes: true });
    },
  },
  {
    id: 'heal',
    label: 'Heal an object',
    category: 'Combat',
    params: [entityParam('who', 'Object', 'player'), { key: 'amount', label: 'Hit points', type: 'number', default: 1, min: 0, step: 1 }],
    describe: (p, n) => `heal ${describeRef(str(p, 'who'), n)} by ${num(p, 'amount', 1)}`,
    run(ctx, p, row) {
      for (const e of resolveRef(ctx, str(p, 'who'), row.picked)) heal(ctx, e, num(p, 'amount', 1));
    },
  },
];
