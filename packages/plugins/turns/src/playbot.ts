import { C, findPath, formatTime, type Cell2, type Entity, type PlayReport, type PointerBot, type TransformIso } from '@tilewright/plugin-sdk';
import { attackTargets, currentUnit, moveRange, takerOf, unitsOf } from './turns';

export interface BattleReport extends PlayReport {
  rounds: number;
  turns: number;
}

const healthLeft = (e: { get<T>(k: string): T | undefined }): number => e.get<{ hp?: number }>('health')?.hp ?? 99;

/** Who is acting in the battle right now. */
export function battle(bot: PointerBot): { active: boolean; round: number; unit: string; team: string; winner: string; ap: number } {
  const g = bot.game;
  const t = g.sim.runtime.turns;
  const u = currentUnit(g.ctx);
  return { active: t.active, round: t.round, unit: u?.name ?? '', team: u ? takerOf(u).team : '', winner: t.winner, ap: u ? (t.ap[u.id] ?? 0) : 0 };
}

function cellOfUnit(e: { require<T>(k: string): T }): Cell2 {
  const t = e.require<TransformIso>(C.Transform);
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
}

/**
 * Take one of my units' turn by clicking: select it, hit an enemy in reach, or walk toward the nearest enemy, then end the turn.
 * Returns what it did, in words.
 */
export function takeTurn(bot: PointerBot): string {
  const g = bot.game;
  const me = currentUnit(g.ctx);
  if (!me) return 'nobody is acting';
  const cell = cellOfUnit(me);
  const done: string[] = [];
  for (let guard = 0; guard < 6 && battle(bot).active && currentUnit(g.ctx) === me; guard++) {
    const targets = attackTargets(g.ctx, me);
    const ap = battle(bot).ap;
    if (targets.length > 0 && ap >= takerOf(me).attackCost) {
      const foe = targets.sort((a, b) => (healthLeft(a) - healthLeft(b)))[0]!;
      bot.click(cellOfUnit(me));
      bot.click(cellOfUnit(foe));
      done.push(`hit ${foe.name}`);
      bot.wait(0.4);
      continue;
    }
    const reach = moveRange(g.ctx, me);
    const foes = unitsOf(g.ctx).filter((u) => takerOf(u).team !== takerOf(me).team);
    if (foes.length === 0 || reach.size <= 1) break;
    const best = stepToward(bot, me, foes, reach);
    if (!best) break;
    bot.click(cellOfUnit(me));
    bot.click(best);
    done.push(`walked to ${best.x},${best.y}`);
    bot.wait(1.2);
    if (cellOfUnit(me).x === cell.x && cellOfUnit(me).y === cell.y && done.length > 3) break;
  }
  if (battle(bot).active && currentUnit(g.ctx) === me) {
    bot.press('end_turn');
    bot.wait(0.4);
    done.push('ended the turn');
  }
  return `${me.name}: ${done.join(', ') || 'waited'}`;
}

/**
 * Where to walk this turn to get nearer the closest enemy: along the shortest way round walls (not through them), as far as
 * the action points allow. Null when no cell it can reach is any nearer.
 */
function stepToward(bot: PointerBot, me: Entity, foes: Entity[], reach: ReturnType<typeof moveRange>): Cell2 | null {
  const map = bot.game.sim.map;
  const here = cellOfUnit(me);
  if (!map) return null;
  const others = new Set(unitsOf(bot.game.ctx).filter((u) => u !== me).map((u) => `${cellOfUnit(u).x},${cellOfUnit(u).y}`));
  let route: Cell2[] | null = null;
  for (const foe of foes) {
    const goal = cellOfUnit(foe);
    const path = findPath(map, here, goal, { stepUp: 1.01, maxDrop: 3, maxNodes: 40000, blocked: (x, y) => others.has(`${x},${y}`) && !(x === goal.x && y === goal.y) });
    if (path && (!route || path.length < route.length)) route = path;
  }
  if (!route) return null;
  for (let i = route.length - 2; i >= 0; i--) {
    const c = { x: Math.floor(route[i]!.x), y: Math.floor(route[i]!.y) };
    if (reach.has(`${c.x},${c.y}`) && (c.x !== here.x || c.y !== here.y)) return c;
  }
  return null;
}

/** Play my side of a battle until it is won, a side loses, or time runs out. Enemies play themselves. */
export function playBattle(bot: PointerBot, opts: { team?: string; maxSeconds?: number } = {}): BattleReport {
  const team = opts.team ?? 'blue';
  const start = bot.game.sim.tick;
  const limit = Math.round((opts.maxSeconds ?? 300) * 60);
  let turns = 0;
  let rounds = 1;
  for (let i = 0; i < 90 && !battle(bot).active; i++) bot.step(); // the battle may be about to start
  while (bot.game.sim.tick - start < limit) {
    const b = battle(bot);
    if (!b.active) break;
    rounds = Math.max(rounds, b.round);
    if (b.team === team && b.unit) {
      takeTurn(bot);
      turns++;
    } else bot.step();
  }
  const b = battle(bot);
  const seconds = (bot.game.sim.tick - start) / 60;
  if (!b.active && b.winner === team) return { ok: true, kind: 'reached', seconds, message: `The ${team} side won after ${rounds} rounds (${turns} turns, ${formatTime(seconds)}).`, rounds, turns };
  if (!b.active) return { ok: false, kind: 'died', seconds, message: b.winner ? `The ${b.winner} side won.` : 'The battle ended with no winner.', rounds, turns };
  return { ok: false, kind: 'timeout', seconds, message: `The battle was not finished after ${formatTime(seconds)}.`, rounds, turns };
}
