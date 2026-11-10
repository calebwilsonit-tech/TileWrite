import { C, type TransformIso } from '@tilewright/runtime';
import type { Game } from '@tilewright/playbot';
import { BLOOM_HEIGHT, type Room } from './model';
import { replay, type ReplayResult, type RoomBot } from './replay';
import { Rules, describe, solve, type Action, type State } from './solver';

export interface RoomReport {
  id: string;
  name: string;
  ok: boolean;
  /** Plain words about every problem found. */
  problems: string[];
  /** Moves of the shortest way out, and of the shortest way that also catches the firefly (0 = no firefly). */
  steps: number;
  fireflySteps: number;
  /** Lamps lit or doused and crates pushed on the shortest way out. */
  toggles: number;
  pushes: number;
  /** Seconds the bot needed in the real game. */
  seconds: number;
  states: number;
  solution: string;
  fireflySolution: string;
  replays: { name: string; result: ReplayResult }[];
}

/** After each action of a replay: does the real game agree with what the rules said would happen? */
function agreement(rules: Rules, states: State[]): (bot: RoomBot, step: number) => string {
  return (bot, step) => {
    const want = states[step + 1]!;
    const g = bot.game;
    const t = g.player.require<TransformIso>(C.Transform);
    const cx = Math.floor(t.x);
    const cy = Math.floor(t.y);
    if (cx !== want.px || cy !== want.py) return `the gardener is in cell (${cx}, ${cy}), the plan says (${want.px}, ${want.py})`;
    const h = rules.playerHeight(want);
    if (Math.abs(t.h - h) > 0.3) return `the gardener stands at height ${t.h.toFixed(2)}, the plan says ${h}`;
    const world = g.sim.world.all();
    const cells = world
      .filter((e) => e.has('pushable'))
      .map((e) => {
        const p = e.require<TransformIso>(C.Transform);
        return Math.floor(p.y) * rules.w + Math.floor(p.x);
      })
      .sort((a, b) => a - b);
    const wantCells = want.push.slice().sort((a, b) => a - b);
    if (cells.join() !== wantCells.join()) return `the crates are in cells ${cells.join(' ')}, the plan says ${wantCells.join(' ')}`;
    for (let i = 0; i < rules.blooms.length; i++) {
      const b = rules.blooms[i]!;
      const e = world.find((o) => o.tags.has('bloom') && Math.floor(o.require<TransformIso>(C.Transform).x) === b.x && Math.floor(o.require<TransformIso>(C.Transform).y) === b.y);
      const up = (e?.get<{ height: number }>(C.Collider)?.height ?? 0) >= BLOOM_HEIGHT - 0.01;
      if (up !== want.grown[i]) return `the ${b.bloom} at (${b.x}, ${b.y}) is ${up ? 'up' : 'down'}, the plan says ${want.grown[i] ? 'up' : 'down'}`;
    }
    for (let i = 0; i < rules.gates.length; i++) {
      const gt = rules.gates[i]!;
      const e = world.find((o) => o.tags.has('gate') && Math.floor(o.require<TransformIso>(C.Transform).x) === gt.x && Math.floor(o.require<TransformIso>(C.Transform).y) === gt.y);
      const shut = e?.get<{ enabled: boolean }>(C.Collider)?.enabled === true;
      if (shut !== want.shut[i]) return `the gate at (${gt.x}, ${gt.y}) is ${shut ? 'shut' : 'open'}, the plan says ${want.shut[i] ? 'shut' : 'open'}`;
    }
    return '';
  };
}

function statesAlong(rules: Rules, actions: Action[]): State[] {
  const out = [rules.initial()];
  for (const a of actions) {
    const next = rules.apply(out.at(-1)!, a);
    if (!next) throw new Error('the plan cannot be followed by the rules that made it');
    out.push(next);
  }
  return out;
}

/** Solve a room by the rules and play both of its solutions in the real game. `start` makes a fresh game on the room. */
export function verifyRoom(room: Room, start: () => Game): RoomReport {
  const rules = new Rules(room);
  const report: RoomReport = { id: room.id, name: room.name, ok: false, problems: [], steps: 0, fireflySteps: 0, toggles: 0, pushes: 0, seconds: 0, states: 0, solution: '', fireflySolution: '', replays: [] };
  let out: ReturnType<typeof solve>;
  try {
    out = solve(rules);
  } catch (e) {
    report.problems.push((e as Error).message);
    return report;
  }
  if (!out) {
    report.problems.push('There is no way to reach the way out.');
    return report;
  }
  report.steps = out.actions.length;
  report.states = out.states;
  report.toggles = out.actions.filter((a) => a.kind === 'toggle').length;
  report.pushes = out.actions.filter((a) => a.kind === 'push').length;
  report.solution = describe(out.actions);
  if (out.actions.length === 0) report.problems.push('The room starts on the way out.');
  const plans: { name: string; actions: Action[] }[] = [{ name: 'the way out', actions: out.actions }];
  if (rules.firefly) {
    const fly = solve(rules, { firefly: true });
    if (!fly) report.problems.push('The firefly cannot be caught on any way that still reaches the way out.');
    else {
      report.fireflySteps = fly.actions.length;
      report.fireflySolution = describe(fly.actions);
      plans.push({ name: 'the way out with the firefly', actions: fly.actions });
    }
  }
  for (const plan of plans) {
    const game = start();
    const result = replay(game, plan.actions, agreement(rules, statesAlong(rules, plan.actions)));
    report.replays.push({ name: plan.name, result });
    if (!result.ok) report.problems.push(`Playing ${plan.name} in the game: ${result.message}`);
    else if (game.problems.length > 0) report.problems.push(`Playing ${plan.name}: ${game.problems.join(' ')}`);
    if (plan.name === 'the way out') report.seconds = result.seconds;
  }
  report.ok = report.problems.length === 0;
  return report;
}
