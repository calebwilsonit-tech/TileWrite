import { newMachineCondition, newMachineState, type MachineCondition, type MachineState, type MachineTransition, type StateMachine } from '@tilewright/behaviors';


export const STATE_W = 150;
export const STATE_H = 70;
/** A pseudo-state in the graph: transitions "from any state" start here. */
export const ANY = '*';

/** Where each state sits: stored positions, else a ring around the middle. */
export function positions(m: StateMachine): Map<string, { x: number; y: number }> {
  const out = new Map<string, { x: number; y: number }>();
  const n = m.states.length;
  m.states.forEach((s, i) => {
    if (s.x !== undefined && s.y !== undefined) out.set(s.id, { x: s.x, y: s.y });
    else {
      const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      out.set(s.id, { x: Math.round(220 + Math.cos(a) * 200), y: Math.round(170 + Math.sin(a) * 120) });
    }
  });
  return out;
}

/** Where the "from any state" pseudo-state sits (top left, clear of the ring). */
export const ANY_POS = { x: 10, y: -90 };

function freshId(prefix: string, taken: readonly string[]): string {
  let n = taken.length + 1;
  while (taken.includes(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function addState(m: StateMachine, name = 'New state'): { machine: StateMachine; id: string } {
  const id = freshId('s', m.states.map((s) => s.id));
  const pos = positions(m);
  const right = Math.max(0, ...[...pos.values()].map((p) => p.x));
  const s: MachineState = { ...newMachineState(id, name), x: right + STATE_W + 40, y: 40 };
  return { machine: { ...m, states: [...m.states, s], start: m.start || id }, id };
}

export function removeState(m: StateMachine, id: string): StateMachine {
  const states = m.states.filter((s) => s.id !== id);
  return { ...m, states, transitions: m.transitions.filter((t) => t.from !== id && t.to !== id), start: m.start === id ? (states[0]?.id ?? '') : m.start };
}

export function moveState(m: StateMachine, id: string, x: number, y: number): StateMachine {
  return { ...m, states: m.states.map((s) => (s.id === id ? { ...s, x: Math.round(x), y: Math.round(y) } : s)) };
}

export function updateState(m: StateMachine, id: string, patch: Partial<MachineState>): StateMachine {
  return { ...m, states: m.states.map((s) => (s.id === id ? { ...s, ...patch } : s)) };
}

/** A new arrow between two states (a second arrow between the same two is allowed: it is a different condition). */
export function addTransition(m: StateMachine, from: string, to: string, when: MachineCondition = newMachineCondition('sees')): { machine: StateMachine; id: string } {
  const id = freshId('t', m.transitions.map((t) => t.id));
  return { machine: { ...m, transitions: [...m.transitions, { id, from, to, when }] }, id };
}

export function updateTransition(m: StateMachine, id: string, patch: Partial<MachineTransition>): StateMachine {
  return { ...m, transitions: m.transitions.map((t) => (t.id === id ? { ...t, ...patch } : t)) };
}

export function removeTransition(m: StateMachine, id: string): StateMachine {
  return { ...m, transitions: m.transitions.filter((t) => t.id !== id) };
}

/** Transitions are tried in order, so the order is part of the design: move one earlier (-1) or later (+1) among the arrows leaving the same state. */
export function reorderTransition(m: StateMachine, id: string, by: -1 | 1): StateMachine {
  const i = m.transitions.findIndex((t) => t.id === id);
  if (i < 0) return m;
  const from = m.transitions[i]!.from;
  let j = i + by;
  while (j >= 0 && j < m.transitions.length && m.transitions[j]!.from !== from) j += by;
  if (j < 0 || j >= m.transitions.length) return m;
  const next = [...m.transitions];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return { ...m, transitions: next };
}

/** Turn a behaviour on or off in a state. */
export function toggleBehaviour(m: StateMachine, id: string, behaviour: string, on: boolean): StateMachine {
  return {
    ...m,
    states: m.states.map((s) => (s.id === id ? { ...s, behaviours: on ? [...new Set([...s.behaviours, behaviour])] : s.behaviours.filter((b) => b !== behaviour) } : s)),
  };
}

/** The curve of an arrow between two cards, and where its label sits. */
export function arrowPath(a: { x: number; y: number }, b: { x: number; y: number }, offset = 0): { d: string; label: { x: number; y: number } } {
  const ax = a.x + STATE_W / 2;
  const ay = a.y + STATE_H / 2;
  const bx = b.x + STATE_W / 2;
  const by = b.y + STATE_H / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // leave and enter through the card edges
  const edge = (cx: number, cy: number, ux: number, uy: number): { x: number; y: number } => {
    const k = Math.min(Math.abs(ux) > 1e-6 ? STATE_W / 2 / Math.abs(ux) : Infinity, Math.abs(uy) > 1e-6 ? STATE_H / 2 / Math.abs(uy) : Infinity);
    return { x: cx + ux * k, y: cy + uy * k };
  };
  const ux = dx / len;
  const uy = dy / len;
  const p1 = edge(ax, ay, ux, uy);
  const p2 = edge(bx, by, -ux, -uy);
  // bend the line sideways so two arrows between the same cards do not lie on each other
  const nx = -uy;
  const ny = ux;
  const bend = 28 + offset * 26;
  const cx = (p1.x + p2.x) / 2 + nx * bend;
  const cy = (p1.y + p2.y) / 2 + ny * bend;
  return { d: `M${p1.x},${p1.y} Q${cx},${cy} ${p2.x},${p2.y}`, label: { x: (p1.x + 2 * cx + p2.x) / 4, y: (p1.y + 2 * cy + p2.y) / 4 } };
}

