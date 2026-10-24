import { C, describeRef, entityParam, lightLevel, num, resolveRef, str, type ActionDef, type ConditionDef, type TransformIso } from '@tilewright/plugin-sdk';

export const conditions: ConditionDef[] = [
  {
    id: 'litAt',
    label: 'A spot is lit (or dark)',
    category: 'Puzzles',
    params: [
      entityParam('where', 'Where', 'player'),
      { key: 'state', label: 'It is', type: 'select', default: 'lit', options: [{ value: 'lit', label: 'lit' }, { value: 'dark', label: 'dark' }] },
      { key: 'threshold', label: 'Brightness that counts as lit (0 to 1)', type: 'number', default: 0.5, min: 0.05, max: 1, step: 0.05 },
    ],
    describe: (p, n) => `the place of ${describeRef(str(p, 'where'), n)} is ${str(p, 'state') === 'dark' ? 'dark' : 'lit'}`,
    test: (ctx, p, row) => {
      const model = ctx.runtime.lighting;
      const e = resolveRef(ctx, str(p, 'where'), row.picked)[0];
      const t = e?.get<TransformIso>(C.Transform);
      if (!model || !t) return false;
      const lit = lightLevel(model, t.x, t.y, t.h) >= num(p, 'threshold', 0.5);
      return str(p, 'state') === 'dark' ? !lit : lit;
    },
  },
];

export const actions: ActionDef[] = [
  {
    id: 'addLight',
    label: 'Add to (or take from) the lantern\'s light',
    category: 'Variables',
    params: [{ key: 'amount', label: 'Amount (negative takes light away; 0 fills it up)', type: 'number', default: 0, step: 5 }],
    describe: (p) => (num(p, 'amount') === 0 ? 'fill the lantern with light' : `${num(p, 'amount') > 0 ? 'add' : 'take'} ${Math.abs(num(p, 'amount'))} ${num(p, 'amount') > 0 ? 'to' : 'from'} the lantern's light`),
    run(ctx, p) {
      const max = typeof ctx.runtime.vars.lightMax === 'number' ? ctx.runtime.vars.lightMax : 100;
      const now = typeof ctx.runtime.vars.light === 'number' ? ctx.runtime.vars.light : max;
      const amount = num(p, 'amount');
      ctx.runtime.vars.light = amount === 0 ? max : Math.max(0, Math.min(max, now + amount));
    },
  },
];
