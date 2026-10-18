import { attackTargets, beginTurns, commandAttack, commandMove, currentUnit, endTurn, endTurns, gridMover, takerOf, turnSystem, turnTaker, unitAi } from '../builtins/turns';
import { resolveRef, type ActionDef, type ConditionDef } from '../events/sheet';
import { registerPack, type Pack } from '../packs';

const entity = (key: string, label: string, def: string) => ({ key, label, type: 'entity' as const, default: def });

const conditions: ConditionDef[] = [
  {
    id: 'turnOf',
    label: 'It is a unit\'s turn',
    category: 'Turn-based',
    params: [entity('who', 'Unit', 'tag:unit')],
    describe: (p) => `it is the turn of ${String(p.who ?? 'a unit')}`,
    test: (ctx, p) => {
      const cur = currentUnit(ctx);
      return !!cur && resolveRef(ctx, String(p.who ?? ''), undefined).includes(cur);
    },
  },
  {
    id: 'teamTurn',
    label: 'It is a team\'s turn',
    category: 'Turn-based',
    params: [{ key: 'team', label: 'Team', type: 'text', default: 'blue' }],
    describe: (p) => `it is the ${String(p.team ?? '')} team's turn`,
    test: (ctx, p) => {
      const cur = currentUnit(ctx);
      return !!cur && ctx.runtime.turns.phase === 'acting' && takerOf(cur).team === String(p.team ?? '');
    },
  },
  {
    id: 'battleWon',
    label: 'A battle has been won',
    category: 'Turn-based',
    params: [{ key: 'team', label: 'By team (empty for any)', type: 'text', default: '' }],
    describe: (p) => `the ${String(p.team ?? '') || 'any'} team has won the battle`,
    test: (ctx, p) => ctx.runtime.turns.winner !== '' && (String(p.team ?? '') === '' || ctx.runtime.turns.winner === String(p.team)),
  },
];

const actions: ActionDef[] = [
  { id: 'startBattle', label: 'Start a turn-based battle', category: 'Turn-based', params: [], describe: () => 'start a turn-based battle', run: (ctx) => beginTurns(ctx) },
  { id: 'endTurn', label: 'End the current turn', category: 'Turn-based', params: [], describe: () => 'end the current unit\'s turn', run: (ctx) => endTurn(ctx) },
  { id: 'endBattle', label: 'End the battle (back to real time)', category: 'Turn-based', params: [], describe: () => 'end the battle', run: (ctx) => endTurns(ctx) },
  {
    id: 'setAp',
    label: 'Change action points',
    category: 'Turn-based',
    params: [entity('who', 'Unit', 'turn'), { key: 'amount', label: 'Add (negative to take away)', type: 'number', default: 1, step: 1 }],
    describe: (p) => `give ${String(p.who ?? '')} ${Number(p.amount ?? 0)} action points`,
    run: (ctx, p, row) => {
      for (const e of resolveRef(ctx, String(p.who ?? ''), row.picked)) ctx.runtime.turns.ap[e.id] = Math.max(0, (ctx.runtime.turns.ap[e.id] ?? 0) + Number(p.amount ?? 0));
    },
  },
  {
    id: 'moveUnit',
    label: 'Move a unit to a cell',
    category: 'Turn-based',
    params: [entity('who', 'Unit', 'turn'), { key: 'x', label: 'Cell across', type: 'number', default: 0, step: 1 }, { key: 'y', label: 'Cell down', type: 'number', default: 0, step: 1 }],
    describe: (p) => `walk ${String(p.who ?? '')} to cell ${Number(p.x ?? 0)}, ${Number(p.y ?? 0)}`,
    run: (ctx, p, row) => {
      for (const e of resolveRef(ctx, String(p.who ?? ''), row.picked)) commandMove(ctx, e, Number(p.x ?? 0), Number(p.y ?? 0));
    },
  },
  {
    id: 'attackNearest',
    label: 'Make a unit attack the nearest enemy in range',
    category: 'Turn-based',
    params: [entity('who', 'Unit', 'turn')],
    describe: (p) => `${String(p.who ?? '')} attacks the nearest enemy in range`,
    run: (ctx, p, row) => {
      for (const e of resolveRef(ctx, String(p.who ?? ''), row.picked)) {
        const [target] = attackTargets(ctx, e);
        if (target) commandAttack(ctx, e, target);
      }
    },
  },
];

/** By-turns play: units with action points and a queue, walking on the grid, enemies that play their own turns. */
export const turnsPack: Pack = {
  id: 'turns',
  name: 'Turn-based play',
  version: '1.0.0',
  description: 'Units that take turns: a queue by speed, action points, cell-by-cell walking, attacks with height advantage, enemy AI turns, win and lose.',
  builtin: true,
  install(api) {
    api.behavior(turnTaker);
    api.behavior(gridMover);
    api.behavior(unitAi);
    for (const c of conditions) api.condition(c);
    for (const a of actions) api.action(a);
    api.system('turns', turnSystem, 'gameplay');
    api.inputAction('end_turn', { label: 'End the turn', bindings: ['key:Space', 'pad:button3'] });
  },
};

registerPack(turnsPack);
