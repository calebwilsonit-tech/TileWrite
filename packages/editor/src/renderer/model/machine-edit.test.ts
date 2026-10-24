import { describe, expect, it } from 'vitest';
import { ANY, STATE_H, STATE_W, addState, addTransition, arrowPath, moveState, positions, removeState, removeTransition, reorderTransition, toggleBehaviour, updateState, updateTransition } from './machine-edit';
import { guardMachine, type StateMachine } from '@tilewright/plugin-ai';

const empty = (): StateMachine => ({ target: 'player', start: '', states: [], transitions: [] });

describe('state machine editing', () => {
  it('the first state added is the start, later ones go to the right, and ids are never reused', () => {
    const a = addState(empty(), 'Idle');
    expect(a.machine.start).toBe(a.id);
    const b = addState(a.machine, 'Alert');
    expect(b.id).not.toBe(a.id);
    expect(b.machine.start).toBe(a.id);
    const pa = positions(b.machine);
    expect(pa.get(b.id)!.x).toBeGreaterThan(pa.get(a.id)!.x + STATE_W);
    const gone = removeState(b.machine, a.id);
    const c = addState(gone, 'Third');
    expect([...gone.states, ...c.machine.states].filter((s) => s.id === c.id)).toHaveLength(1);
  });

  it('removing a state removes its arrows and moves the start if needed', () => {
    const g = guardMachine();
    const r = removeState(g, 'chase');
    expect(r.states.map((s) => s.id)).toEqual(['patrol', 'search', 'back']);
    expect(r.transitions.every((t) => t.from !== 'chase' && t.to !== 'chase')).toBe(true);
    const s = removeState(g, 'patrol');
    expect(s.start).toBe('chase');
  });

  it('moves and edits a state without touching the original', () => {
    const g = guardMachine();
    const m = moveState(g, 'chase', 100.4, 50.6);
    expect(positions(m).get('chase')).toEqual({ x: 100, y: 51 });
    expect(positions(g).get('chase')).toEqual({ x: 300, y: 40 });
    expect(updateState(g, 'chase', { name: 'Hunt' }).states.find((s) => s.id === 'chase')!.name).toBe('Hunt');
    expect(g.states.find((s) => s.id === 'chase')!.name).toBe('Chase');
  });

  it('places states without a stored position on a ring, apart from each other', () => {
    const m: StateMachine = { ...empty(), states: ['a', 'b', 'c', 'd'].map((id) => ({ id, name: id, behaviours: [], move: 'none', speed: 3, anim: '', message: '', sound: '' })) };
    const p = [...positions(m).values()];
    expect(new Set(p.map((q) => `${q.x},${q.y}`)).size).toBe(4);
  });

  it('adds, edits, removes and orders arrows', () => {
    const a = addTransition(guardMachine(), 'patrol', 'search');
    expect(a.machine.transitions).toHaveLength(7);
    expect(a.machine.transitions.at(-1)).toMatchObject({ from: 'patrol', to: 'search', when: { type: 'sees' } });
    const e = updateTransition(a.machine, a.id, { when: { type: 'near', cells: 2 } });
    expect(e.transitions.at(-1)!.when).toEqual({ type: 'near', cells: 2 });
    expect(removeTransition(e, a.id).transitions).toHaveLength(6);
    const any = addTransition(guardMachine(), ANY, 'back');
    expect(any.machine.transitions.at(-1)!.from).toBe('*');
  });

  it('reordering swaps with the nearest arrow that leaves the same state', () => {
    const g = guardMachine(); // search has t3 (to chase) and t4 (to back)
    const down = reorderTransition(g, 't3', 1);
    const ids = down.transitions.map((t) => t.id);
    expect(ids.indexOf('t4')).toBeLessThan(ids.indexOf('t3'));
    expect(ids).toHaveLength(g.transitions.length);
    expect(reorderTransition(g, 't1', -1)).toEqual(g); // already first for its state
    expect(reorderTransition(g, 'nope', 1)).toEqual(g);
  });

  it('switches behaviours on and off in a state, once each', () => {
    const g = guardMachine();
    const on = toggleBehaviour(g, 'chase', 'patrol', true);
    expect(on.states.find((s) => s.id === 'chase')!.behaviours).toEqual(['vision', 'patrol']);
    expect(toggleBehaviour(on, 'chase', 'patrol', true).states.find((s) => s.id === 'chase')!.behaviours).toEqual(['vision', 'patrol']);
    expect(toggleBehaviour(on, 'chase', 'patrol', false).states.find((s) => s.id === 'chase')!.behaviours).toEqual(['vision']);
  });

  it('draws an arrow from one card edge to the other, with its label between', () => {
    const a = { x: 0, y: 0 };
    const b = { x: 300, y: 0 };
    const { d, label } = arrowPath(a, b);
    expect(d.startsWith(`M${STATE_W},`)).toBe(true); // leaves a's right edge
    expect(d).toContain(` ${300},`); // arrives at b's left edge
    expect(label.x).toBeGreaterThan(STATE_W);
    expect(label.x).toBeLessThan(300);
    expect(arrowPath(a, b, 1).label.y).not.toBe(arrowPath(a, b, 0).label.y); // a second arrow bends differently
    expect(STATE_H).toBeGreaterThan(0);
  });
});
