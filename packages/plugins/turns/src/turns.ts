import {
  C,
  cellWalkable,
  groundHeightAt,
  stepAllowed,
  teleportBody,
  type Entity,
  type SimContext,
  type TransformIso,
  behaviorDef,
  stateOf,
} from '@tilewright/plugin-sdk';
import { damage, healthOf } from '@tilewright/plugin-combat';


/**
 * By-turns play. A unit is an object with a Turn Taker (its team, speed in the queue, action points, how it attacks) and,
 * to walk, a Grid Mover. `beginTurns` puts the scene clock into turn mode and builds the queue; the turn system then gives
 * each unit its turn in order (fastest first), refills its action points, waits for it to act (a person through the interface,
 * or a Unit AI), and moves on until only one team is left. Real-time and turn-based use the same maps, objects and rules:
 * only whether time passes by itself differs.
 */

export interface TurnTaker {
  /** Who is on whose side ("red", "blue", "monsters"). A battle ends when one team is left. */
  team: string;
  /** Higher goes earlier in the round. */
  initiative: number;
  /** Action points at the start of each turn. */
  apMax: number;
  /** How far it can hit, in cells (counted along the grid). */
  attackRange: number;
  attackDamage: number;
  /** Action points an attack costs. */
  attackCost: number;
  /** Extra damage for each level the attacker stands above its target (and less for each level below). */
  heightBonus: number;
  /** End the turn on its own when no action points are left. */
  autoEnd: boolean;
}

export interface GridMover {
  /** Action points one cell of walking costs. */
  moveCost: number;
  /** Cells per second while walking. */
  speed: number;
  /** Highest step it can climb, in levels. */
  stepUp: number;
  /** Furthest it will step down. */
  maxDrop: number;
}

export interface UnitAi {
  /** 'rush' walks up to the nearest enemy and hits it; 'cautious' attacks from as far as it can and keeps its distance. */
  style: 'rush' | 'cautious';
}

interface GridMove {
  path: { x: number; y: number }[];
  i: number;
}

const key = (x: number, y: number): string => `${x},${y}`;
const cellOf = (e: Entity): { x: number; y: number } => {
  const t = e.require<TransformIso>(C.Transform);
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
};

export const turnTaker = behaviorDef<TurnTaker>({
  id: 'turnTaker',
  name: 'Turn Taker',
  category: 'Turn-based',
  description: 'Makes an object a unit in a turn-based battle: its team, its place in the order, its action points and how it attacks. Start the battle with the "Start a turn-based battle" action.',
  phase: 'logic',
  defaults: { team: 'blue', initiative: 5, apMax: 4, attackRange: 1, attackDamage: 3, attackCost: 2, heightBonus: 1, autoEnd: true },
  fields: [
    { key: 'team', label: 'Team', type: 'text', help: 'Units with the same team are on the same side.' },
    { key: 'initiative', label: 'Speed in the order (higher goes first)', type: 'number', step: 1 },
    { key: 'apMax', label: 'Action points each turn', type: 'number', min: 0, step: 1 },
    { key: 'attackRange', label: 'Attack range (cells)', type: 'number', min: 1, step: 1 },
    { key: 'attackDamage', label: 'Attack damage', type: 'number', min: 0, step: 1 },
    { key: 'attackCost', label: 'Action points an attack costs', type: 'number', min: 0, step: 1 },
    { key: 'heightBonus', label: 'Extra damage per level above the target', type: 'number', step: 0.5 },
    { key: 'autoEnd', label: 'End the turn when out of action points', type: 'boolean' },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  summary: (s) => `${s.team} team, ${s.apMax} action points, hits ${s.attackDamage} up to ${s.attackRange} cell${s.attackRange === 1 ? '' : 's'} away.`,
  update: () => undefined,
});

export const gridMover = behaviorDef<GridMover>({
  id: 'gridMover',
  name: 'Grid Mover',
  category: 'Movement',
  description: 'Moves an object cell by cell along a path, over stairs and heights, one step at a time (it never stops between cells). Turn-based units use it; so can a real-time game that moves on a grid. Orders come from the interface, a Unit AI, or the "Move a unit" action.',
  phase: 'actuator',
  defaults: { moveCost: 1, speed: 6, stepUp: 1, maxDrop: 2 },
  fields: [
    { key: 'moveCost', label: 'Action points per cell', type: 'number', min: 0, step: 0.5 },
    { key: 'speed', label: 'Walking speed (cells per second)', type: 'number', min: 1, step: 1 },
    { key: 'stepUp', label: 'Highest step it can climb (levels)', type: 'number', min: 0, step: 1 },
    { key: 'maxDrop', label: 'Furthest it will step down (levels)', type: 'number', min: 0, step: 1 },
  ],
  inputs: [],
  outputs: [{ name: 'moving', label: 'Moving' }],
  requires: { body: { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1.2, state: 'ground', stepUp: 1, stepDown: 2, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false } },
  summary: (s) => `Walks at ${s.speed} cells per second, ${s.moveCost} action point${s.moveCost === 1 ? '' : 's'} per cell.`,
  update(ctx, e, s) {
    const st = e.get<GridMove>('state:gridMove');
    if (!st || st.i >= st.path.length) return;
    const t = e.require<TransformIso>(C.Transform);
    const goal = st.path[st.i]!;
    const dx = goal.x - t.x;
    const dy = goal.y - t.y;
    const dist = Math.hypot(dx, dy);
    const step = s.speed * ctx.dt;
    if (dist <= step) {
      teleportBody(ctx, e, goal.x, goal.y, ctx.map ? groundHeightAt(ctx.map, goal.x, goal.y) : 0);
      st.i++;
      if (st.i >= st.path.length) {
        e.remove('state:gridMove');
        ctx.events.emit('unit-moved', { entity: e.id, x: Math.floor(goal.x), y: Math.floor(goal.y) });
      }
    } else {
      const nx = t.x + (dx / dist) * step;
      const ny = t.y + (dy / dist) * step;
      teleportBody(ctx, e, nx, ny, ctx.map ? groundHeightAt(ctx.map, nx, ny) : 0);
    }
  },
});

export const unitAi = behaviorDef<UnitAi>({
  id: 'unitAi',
  name: 'Unit AI',
  category: 'Turn-based',
  description: 'Plays the unit\'s turn by itself: it picks the best cell it can reach (close to an enemy, on higher ground, within attack range), attacks if it can, and ends its turn.',
  phase: 'brain',
  defaults: { style: 'rush' },
  fields: [
    {
      key: 'style',
      label: 'Style',
      type: 'select',
      options: [
        { value: 'rush', label: 'Rush: walk up to the nearest enemy and hit it' },
        { value: 'cautious', label: 'Cautious: attack from as far away as possible' },
      ],
    },
  ],
  inputs: [],
  outputs: [],
  requires: { turnTaker: {}, gridMover: {} },
  update(ctx, e, s) {
    const turns = ctx.runtime.turns;
    if (!turns.active || turns.phase !== 'acting' || turns.order[turns.index] !== e.id) return;
    if (isMoving(e)) return;
    const st = stateOf<{ wait: number }>(e, 'unitAi', () => ({ wait: 0 }));
    if (st.wait > 0) {
      st.wait--;
      return;
    }
    const me = takerOf(e);
    const enemies = unitsOf(ctx).filter((u) => takerOf(u).team !== me.team);
    if (enemies.length === 0) return endTurn(ctx);
    const here = cellOf(e);
    const target = nearestBy(enemies, (u) => dist(cellOf(u), here));
    const ap = turns.ap[e.id] ?? 0;
    if (inAttackRange(e, target) && ap >= me.attackCost) {
      commandAttack(ctx, e, target);
      st.wait = 20;
      return;
    }
    if (ap > 0) {
      const range = moveRange(ctx, e);
      let best: { x: number; y: number; score: number } | null = null;
      for (const [k, v] of range) {
        const [cx, cy] = k.split(',').map(Number) as [number, number];
        const d = dist({ x: cx, y: cy }, cellOf(target));
        const hasRange = d <= me.attackRange;
        const height = ctx.map ? groundHeightAt(ctx.map, cx + 0.5, cy + 0.5) : 0;
        // closer is better; being able to hit from there is much better; height is a small bonus; the cautious keep their distance
        const score = (s.style === 'cautious' ? -Math.abs(d - me.attackRange) : -d) * 10 + (hasRange ? 50 : 0) + height * 2 - v.cost * 0.1;
        if (!best || score > best.score) best = { x: cx, y: cy, score };
      }
      if (best && (best.x !== here.x || best.y !== here.y) && commandMove(ctx, e, best.x, best.y).ok) {
        st.wait = 10;
        return;
      }
    }
    endTurn(ctx);
  },
});

// ---------- units and ranges ----------

export const takerOf = (e: Entity): TurnTaker => ({ ...(turnTaker.defaults as TurnTaker), ...(e.get<Partial<TurnTaker>>('turnTaker') ?? {}) });
const moverOf = (e: Entity): GridMover => ({ ...(gridMover.defaults as GridMover), ...(e.get<Partial<GridMover>>('gridMover') ?? {}) });
export const isMoving = (e: Entity): boolean => e.get<GridMove>('state:gridMove') !== undefined;

/** Units still in the fight: turn takers that are alive and not dead from damage. */
export function unitsOf(ctx: SimContext): Entity[] {
  return ctx.world.query('turnTaker').filter((e) => e.alive && !(healthOf(e)?.dead ?? false));
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }): number => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

function nearestBy<T extends object>(items: T[], d: (x: T) => number): T {
  let best = items[0]!;
  let bd = d(best);
  for (const it of items) {
    const v = d(it);
    if (v < bd) {
      best = it;
      bd = v;
    }
  }
  return best;
}

export function inAttackRange(attacker: Entity, target: Entity): boolean {
  return dist(cellOf(attacker), cellOf(target)) <= takerOf(attacker).attackRange;
}

export interface Reach {
  cost: number;
  path: { x: number; y: number }[];
}

/**
 * Where a unit can walk with the action points it has: a flood outward over the map's cells, climbing and dropping as far as
 * its Grid Mover allows, never through another unit. Keys are "x,y"; `cost` is in action points, `path` the cell centres.
 */
export function moveRange(ctx: SimContext, e: Entity, apOverride?: number): Map<string, Reach> {
  const out = new Map<string, Reach>();
  const map = ctx.map;
  if (!map) return out;
  const mover = moverOf(e);
  const ap = apOverride ?? (ctx.runtime.turns.active ? (ctx.runtime.turns.ap[e.id] ?? 0) : Infinity);
  const start = cellOf(e);
  const taken = new Set<string>();
  for (const u of unitsOf(ctx)) if (u !== e) taken.add(key(cellOf(u).x, cellOf(u).y));
  const best = new Map<string, number>([[key(start.x, start.y), 0]]);
  const queue: { x: number; y: number; cost: number; path: { x: number; y: number }[] }[] = [{ ...start, cost: 0, path: [] }];
  out.set(key(start.x, start.y), { cost: 0, path: [] });
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const c = queue.shift()!;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!map.inBounds(nx, ny) || taken.has(key(nx, ny)) || !cellWalkable(map, nx, ny) || !stepAllowed(map, c.x, c.y, nx, ny, mover.stepUp, mover.maxDrop)) continue;
      if (blockedByObject(ctx, e, nx, ny)) continue;
      const cost = c.cost + Math.max(0, mover.moveCost);
      if (cost > ap + 1e-9 || cost >= (best.get(key(nx, ny)) ?? Infinity)) continue;
      best.set(key(nx, ny), cost);
      const path = [...c.path, { x: nx + 0.5, y: ny + 0.5 }];
      out.set(key(nx, ny), { cost, path });
      queue.push({ x: nx, y: ny, cost, path });
    }
  }
  return out;
}

/** A solid object (crate, closed gate, pillar) that is not a unit stands in the cell. */
function blockedByObject(ctx: SimContext, self: Entity, x: number, y: number): boolean {
  for (const o of ctx.world.query(C.Transform, C.Collider)) {
    if (o === self || o.has(C.Body)) continue;
    const c = o.require<{ solid: boolean; enabled: boolean; trigger: boolean; height: number; w: number; d: number }>(C.Collider);
    if (!c.solid || !c.enabled || c.trigger || c.height < 0.4) continue;
    const t = o.require<TransformIso>(C.Transform);
    if (x >= Math.floor(t.x - c.w / 2 + 0.05) && x <= Math.floor(t.x + c.w / 2 - 0.05) && y >= Math.floor(t.y - c.d / 2 + 0.05) && y <= Math.floor(t.y + c.d / 2 - 0.05)) return true;
  }
  return false;
}

/** Enemies (units of other teams) this unit could hit from where it stands. */
export function attackTargets(ctx: SimContext, e: Entity): Entity[] {
  const me = takerOf(e);
  return unitsOf(ctx).filter((u) => u !== e && takerOf(u).team !== me.team && inAttackRange(e, u));
}

// ---------- commands ----------

export interface CommandResult {
  ok: boolean;
  /** Plain English when it is not ok. */
  reason?: string;
}

const myTurn = (ctx: SimContext, e: Entity): boolean => {
  const t = ctx.runtime.turns;
  return !t.active || (t.phase === 'acting' && t.order[t.index] === e.id);
};

/** Order a unit to walk to a cell. In a battle it must be the unit's turn and the cell within its action points. */
export function commandMove(ctx: SimContext, e: Entity, x: number, y: number): CommandResult {
  if (!e.has('gridMover')) return { ok: false, reason: `${e.name} cannot walk: it has no Grid Mover.` };
  if (!myTurn(ctx, e)) return { ok: false, reason: `It is not ${e.name}'s turn.` };
  if (isMoving(e)) return { ok: false, reason: `${e.name} is already walking.` };
  const reach = moveRange(ctx, e).get(key(x, y));
  if (!reach || reach.path.length === 0) return { ok: false, reason: `${e.name} cannot get to that cell with its action points.` };
  if (ctx.runtime.turns.active) ctx.runtime.turns.ap[e.id] = Math.max(0, (ctx.runtime.turns.ap[e.id] ?? 0) - reach.cost);
  e.set('state:gridMove', { path: reach.path, i: 0 } satisfies GridMove);
  ctx.events.emit('unit-move', { entity: e.id, x, y, cost: reach.cost });
  return { ok: true };
}

/** Attack a unit in range: damage, plus or minus the height difference. */
export function commandAttack(ctx: SimContext, attacker: Entity, target: Entity): CommandResult {
  if (!attacker.has('turnTaker')) return { ok: false, reason: `${attacker.name} is not a unit.` };
  if (!myTurn(ctx, attacker)) return { ok: false, reason: `It is not ${attacker.name}'s turn.` };
  if (isMoving(attacker)) return { ok: false, reason: `${attacker.name} is still walking.` };
  const a = takerOf(attacker);
  if (!inAttackRange(attacker, target)) return { ok: false, reason: `${target.name} is out of range.` };
  if (takerOf(target).team === a.team) return { ok: false, reason: `${target.name} is on ${attacker.name}'s team.` };
  const turns = ctx.runtime.turns;
  const ap = turns.ap[attacker.id] ?? 0;
  if (turns.active && ap < a.attackCost) return { ok: false, reason: `${attacker.name} has not got enough action points.` };
  if (turns.active) turns.ap[attacker.id] = ap - a.attackCost;
  const dh = attacker.require<TransformIso>(C.Transform).h - target.require<TransformIso>(C.Transform).h;
  const amount = Math.max(1, Math.round(a.attackDamage + a.heightBonus * dh));
  damage(ctx, target, amount, { source: attacker, ignoreIframes: true });
  ctx.events.emit('unit-attacked', { attacker: attacker.id, target: target.id, damage: amount });
  return { ok: true };
}

// ---------- the queue ----------

/** Start a battle: every unit goes into the queue, fastest first, and the clock goes by turns. */
export function beginTurns(ctx: SimContext): void {
  const units = unitsOf(ctx).sort((a, b) => takerOf(b).initiative - takerOf(a).initiative || a.id - b.id);
  const t = ctx.runtime.turns;
  t.active = true;
  t.order = units.map((u) => u.id);
  t.index = 0;
  t.round = 1;
  t.ap = {};
  t.phase = 'start';
  t.wait = 0;
  t.winner = '';
  ctx.runtime.clock.mode = 'turns';
  ctx.events.emit('battle-started', { units: t.order.length });
}

/** Leave the battle; time passes by itself again. */
export function endTurns(ctx: SimContext, winner = ''): void {
  const t = ctx.runtime.turns;
  t.active = false;
  t.winner = winner;
  ctx.runtime.clock.mode = 'realtime';
  if (winner) ctx.events.emit('battle-won', { team: winner });
  ctx.events.emit('battle-ended', { team: winner });
}

/** The unit whose turn it is, if a battle is on. */
export function currentUnit(ctx: SimContext): Entity | undefined {
  const t = ctx.runtime.turns;
  return t.active ? ctx.world.get(t.order[t.index] ?? -1) : undefined;
}

/** Finish the current unit's turn (after a short pause so its last move can be seen). */
export function endTurn(ctx: SimContext): void {
  const t = ctx.runtime.turns;
  if (!t.active || t.phase !== 'acting') return;
  const e = currentUnit(ctx);
  ctx.events.emit('turn-end', { entity: e?.id ?? -1, team: e ? takerOf(e).team : '', round: t.round });
  t.phase = 'between';
  t.wait = 18;
}

/** Runs the queue: whose turn it is, refilling action points, ending turns, noticing a winner. */
export function turnSystem(ctx: SimContext): void {
  const t = ctx.runtime.turns;
  const vars = ctx.runtime.vars;
  if (!t.active) return;
  // units that are gone or dead leave the queue (the index keeps pointing at the same unit)
  const current = t.order[t.index];
  const alive = new Set(unitsOf(ctx).map((u) => u.id));
  const kept = t.order.filter((id) => alive.has(id));
  if (kept.length !== t.order.length) {
    const at = current !== undefined && alive.has(current) ? kept.indexOf(current) : Math.min(t.index, kept.length) - (t.phase === 'start' ? 0 : 1);
    t.order = kept;
    t.index = Math.max(0, at);
    if (current !== undefined && !alive.has(current) && t.phase === 'acting') {
      t.phase = 'between';
      t.wait = 10;
    }
  }
  // a battle is over when only one team is left
  const teams = new Set(t.order.map((id) => takerOf(ctx.world.get(id)!).team));
  if (teams.size <= 1) {
    endTurns(ctx, [...teams][0] ?? '');
    vars['battle.winner'] = t.winner;
    return;
  }
  if (t.phase === 'between') {
    if (--t.wait > 0) return;
    t.index++;
    if (t.index >= t.order.length) {
      t.index = 0;
      t.round++;
      ctx.events.emit('round-start', { round: t.round });
    }
    t.phase = 'start';
  }
  if (t.phase === 'start') {
    const e = ctx.world.get(t.order[t.index] ?? -1);
    if (!e) return;
    t.ap[e.id] = takerOf(e).apMax;
    t.phase = 'acting';
    ctx.events.emit('turn-start', { entity: e.id, team: takerOf(e).team, round: t.round });
  }
  const e = currentUnit(ctx);
  if (e && t.phase === 'acting' && takerOf(e).autoEnd && (t.ap[e.id] ?? 0) <= 0 && !isMoving(e) && !e.get('unitAi')) {
    // a person's unit with nothing left to spend ends its turn by itself (the AI decides for its own units)
    endTurn(ctx);
  }
  // numbers the interface and event rows can read
  vars['turn.round'] = t.round;
  vars['turn.unit'] = e?.name ?? '';
  vars['turn.team'] = e ? takerOf(e).team : '';
  vars['turn.ap'] = e ? (t.ap[e.id] ?? 0) : 0;
  vars['battle.winner'] = t.winner;
}
