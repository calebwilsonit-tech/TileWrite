import { describe, expect, it } from 'vitest';
import { C, setClockSpeed, type TransformIso } from '@tilewright/runtime';
import { ctxOf, flatScene, player, rig, thing, type Rig } from './testing';
import { attackTargets, beginTurns, commandAttack, commandMove, currentUnit, endTurn, healthOf, moveRange, newAction, newCondition, newRow, setActivePacks } from './index';

setActivePacks(undefined);

const unit = (id: string, name: string, x: number, y: number, team: string, extra: Record<string, unknown> = {}, ai = false) =>
  thing(id, name, x, y, { turnTaker: { team, apMax: 4, initiative: 5, attackRange: 1, attackDamage: 3, attackCost: 2, ...extra }, gridMover: { speed: 12 }, health: { max: 6, onDeath: 'stay' }, ...(ai ? { unitAi: { style: 'rush' } } : {}) });

function battle(units: ReturnType<typeof unit>[]): Rig {
  const { scene } = flatScene(16, 16);
  scene.entities.push(...units);
  return rig(scene);
}
const cell = (r: Rig, id: string): { x: number; y: number } => {
  const t = r.get(id).get<TransformIso>(C.Transform)!;
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
};

describe('the scene clock', () => {
  it('counts game time only while the world moves, and pauses everything on request', () => {
    const r = battle([unit('a', 'A', 4.5, 4.5, 'red')]);
    r.run(30);
    expect(r.sim.runtime.clock.elapsed).toBe(30);
    r.sim.runtime.clock.mode = 'paused';
    r.run(30);
    expect(r.sim.runtime.clock.elapsed).toBe(30);
    expect(r.sim.modal).toBe('freeze');
    r.sim.runtime.clock.mode = 'realtime';
    r.run(10);
    expect(r.sim.runtime.clock.elapsed).toBe(40);
    setClockSpeed(r.sim.runtime.clock, 3);
    expect(r.sim.runtime.clock.speed).toBe(2);
    setClockSpeed(r.sim.runtime.clock, 100);
    expect(r.sim.runtime.clock.speed).toBe(8);
  });

  it('turn mode stops real-time behaviours (a patrol) but not the turn system', () => {
    const { scene } = flatScene(16, 16);
    scene.entities.push(thing('p', 'Walker', 3.5, 3.5, { patrol: { points: '10.5,3.5; 3.5,3.5', speed: 3 } }, { body: player('x', 0, 0).components.body }));
    const r = rig(scene);
    r.run(20);
    const moved = r.get('p').get<TransformIso>(C.Transform)!.x;
    expect(moved).toBeGreaterThan(3.6);
    r.sim.runtime.clock.mode = 'turns';
    r.run(30);
    expect(r.get('p').get<TransformIso>(C.Transform)!.x).toBeCloseTo(moved, 3);
  });
});

describe('turns', () => {
  it('order the queue by speed, refill action points each turn and announce each turn', () => {
    const r = battle([unit('a', 'Slow', 3.5, 3.5, 'red', { initiative: 2 }), unit('b', 'Fast', 8.5, 8.5, 'blue', { initiative: 9 }), unit('c', 'Mid', 12.5, 3.5, 'blue', { initiative: 5 })]);
    const starts: string[] = [];
    r.sim.events.on('turn-start', (e) => starts.push(r.sim.world.get(Number(e.entity))!.name));
    beginTurns(ctxOf(r));
    expect(r.sim.runtime.clock.mode).toBe('turns');
    expect(r.sim.runtime.turns.order.map((id) => r.sim.world.get(id)!.name)).toEqual(['Fast', 'Mid', 'Slow']);
    r.run(2);
    expect(currentUnit(ctxOf(r))!.name).toBe('Fast');
    expect(r.sim.runtime.turns.ap[currentUnit(ctxOf(r))!.id]).toBe(4);
    expect(r.sim.runtime.vars['turn.unit']).toBe('Fast');
    endTurn(ctxOf(r));
    r.run(40);
    expect(currentUnit(ctxOf(r))!.name).toBe('Mid');
    endTurn(ctxOf(r));
    r.run(40);
    endTurn(ctxOf(r));
    r.run(40);
    expect(starts).toEqual(['Fast', 'Mid', 'Slow', 'Fast']);
    expect(r.sim.runtime.turns.round).toBe(2);
  });

  it('let only the unit whose turn it is move, within its action points, cell by cell', () => {
    const r = battle([unit('a', 'A', 3.5, 3.5, 'red', { initiative: 9 }), unit('b', 'B', 12.5, 12.5, 'blue', { initiative: 1 })]);
    beginTurns(ctxOf(r));
    r.run(2);
    const ctx = ctxOf(r);
    expect(commandMove(ctx, r.get('b'), 11, 12)).toMatchObject({ ok: false, reason: expect.stringContaining('not B') });
    expect(commandMove(ctx, r.get('a'), 9, 3)).toMatchObject({ ok: false, reason: expect.stringContaining('action points') });
    expect(moveRange(ctx, r.get('a')).size).toBe(39);
    expect(commandMove(ctx, r.get('a'), 5, 4)).toEqual({ ok: true });
    expect(r.sim.runtime.turns.ap[r.get('a').id]).toBe(1);
    r.run(40);
    expect(cell(r, 'a')).toEqual({ x: 5, y: 4 });
    expect(r.get('a').get('state:gridMove')).toBeUndefined();
  });

  it('cannot be walked through: units, crates and walls block the way', () => {
    const { scene } = flatScene(16, 16);
    scene.entities.push(unit('a', 'A', 3.5, 3.5, 'red'), unit('b', 'B', 5.5, 3.5, 'blue'));
    scene.entities.push(thing('c', 'Crate', 4.5, 3.5, {}, { collider: { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } }));
    const r = rig(scene);
    const range = moveRange(ctxOf(r), r.get('a'), 6);
    expect(range.has('4,3')).toBe(false); // the crate
    expect(range.has('5,3')).toBe(false); // the other unit
    expect(range.has('4,4')).toBe(true);
    expect([...(range.get('6,3')?.path ?? [])].length).toBe(5); // around both
  });

  it('attack with a range, an action point cost and a height bonus', () => {
    const r = battle([unit('a', 'A', 3.5, 3.5, 'red', { initiative: 9, heightBonus: 1 }), unit('b', 'B', 4.5, 3.5, 'blue', { initiative: 1 }), unit('f', 'Far', 9.5, 9.5, 'blue', { initiative: 1 })]);
    beginTurns(ctxOf(r));
    r.run(2);
    const ctx = ctxOf(r);
    expect(attackTargets(ctx, r.get('a')).map((e) => e.name)).toEqual(['B']);
    expect(commandAttack(ctx, r.get('a'), r.get('f'))).toMatchObject({ ok: false, reason: expect.stringContaining('out of range') });
    // standing one level higher adds one damage
    r.get('a').get<TransformIso>(C.Transform)!.h = 1;
    expect(commandAttack(ctx, r.get('a'), r.get('b'))).toEqual({ ok: true });
    expect(healthOf(r.get('b'))!.hp).toBe(2);
    expect(r.sim.runtime.turns.ap[r.get('a').id]).toBe(2);
    expect(commandAttack(ctx, r.get('a'), r.get('b'))).toEqual({ ok: true });
    expect(commandAttack(ctx, r.get('a'), r.get('b'))).toMatchObject({ ok: false });
  });

  it('let enemy units play their own turns, and end the battle when one team is left', () => {
    const r = battle([unit('p', 'Hero', 3.5, 3.5, 'blue', { initiative: 9, attackDamage: 6 }), unit('e', 'Orc', 9.5, 3.5, 'red', { initiative: 1, attackDamage: 1 }, true)]);
    const events: string[] = [];
    for (const t of ['battle-started', 'turn-start', 'unit-moved', 'unit-attacked', 'battle-won']) r.sim.events.on(t, (e) => events.push(`${t}${e.team ? ':' + String(e.team) : ''}`));
    beginTurns(ctxOf(r));
    r.run(2);
    // the hero walks next to the orc; with no action points left its turn ends by itself
    expect(commandMove(ctxOf(r), r.get('p'), 7, 3)).toEqual({ ok: true });
    r.run(40);
    // the orc's turn: it walks up and hits the hero; then it is the hero's turn again
    for (let i = 0; i < 600 && !(currentUnit(ctxOf(r))?.name === 'Hero' && r.sim.runtime.turns.round >= 2); i++) r.run(1);
    expect(healthOf(r.get('p'))!.hp).toBeLessThan(6);
    commandAttack(ctxOf(r), r.get('p'), r.get('e'));
    r.run(60);
    expect(r.sim.runtime.turns.active).toBe(false);
    expect(r.sim.runtime.turns.winner).toBe('blue');
    expect(r.sim.runtime.clock.mode).toBe('realtime');
    expect(r.sim.runtime.vars['battle.winner']).toBe('blue');
    expect(events).toContain('battle-won:blue');
    expect(events.filter((e) => e === 'unit-attacked').length).toBeGreaterThanOrEqual(2);
  });

  it('are driven by event rows (start the battle, attack, react to a win) and replay the same every time', () => {
    const make = (): Rig => {
      const { scene } = flatScene(16, 16);
      scene.entities.push(unit('p', 'Hero', 3.5, 3.5, 'blue', { initiative: 9, attackDamage: 9, attackRange: 12 }), unit('e', 'Orc', 5.5, 3.5, 'red', { initiative: 1 }, true));
      scene.events = [
        { ...newRow('r1'), conditions: [newCondition('start')], actions: [newAction('startBattle')], once: true },
        { ...newRow('r2'), conditions: [{ ...newCondition('teamTurn'), params: { team: 'blue' } }], actions: [newAction('attackNearest')] },
        { ...newRow('r3'), conditions: [newCondition('battleWon')], actions: [{ ...newAction('setVariable'), params: { name: 'won', op: 'set', value: '1' } }] },
      ];
      return rig(scene);
    };
    const a = make();
    const b = make();
    a.run(300);
    b.run(300);
    expect(a.sim.runtime.vars.won).toBe(1);
    expect(a.sim.runtime.turns.winner).toBe('blue');
    expect(a.sim.stateHash()).toBe(b.sim.stateHash());
  });
});
