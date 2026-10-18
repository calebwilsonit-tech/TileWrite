import {
  C,
  buildFlowField,
  cellWalkable,
  flowNext,
  groundHeightAt,
  pictureOf,
  readPointer,
  screenIntentToGrid,
  type Body,
  type CellMark,
  type Entity,
  type FlowField,
  type SimContext,
  type TransformIso,
} from '@tilewright/runtime';
import { behaviorDef, stateOf } from '../framework';
import { beginDialogue } from '../story/director';
import { newNav, steerTo, type NavState } from './ai';
import { damage, healthOf } from './combat';
import { commandAttack, commandMove, currentUnit, endTurn, moveRange, takerOf, unitsOf } from './turns';
import { spawnPrefabAt } from './world';

/**
 * Control schemes. Each is a behaviour on an object, so a game picks the ones it wants by putting them on objects:
 * - Click to Move (point-and-click adventures): click the ground and the object walks there.
 * - Hotspot: something you can look at, use or talk to by clicking it with the chosen verb.
 * - Grid Cursor (tactics): a cursor over the grid; pick a unit, see where it can go and what it can hit, click to act.
 * - RTS Control + Commandable: select units by click or box, give orders (queue them with Shift).
 * - Camera Rig (builders): pan, zoom and turn the view between the four isometric views.
 * - Builder: choose a building from a table, see a ghost with a valid/invalid tint, rotate it, place it.
 * They read the pointer and buttons from the same input every other behaviour reads, so recordings, replays and the
 * playbot drive them like a person does.
 */

const cellOf = (e: Entity): { x: number; y: number } => {
  const t = e.require<TransformIso>(C.Transform);
  return { x: Math.floor(t.x), y: Math.floor(t.y) };
};
const heightAtCell = (ctx: SimContext, x: number, y: number): number => (ctx.map ? groundHeightAt(ctx.map, x + 0.5, y + 0.5) : 0);
const mark = (ctx: SimContext, x: number, y: number, color: number, alpha = 0.45, outline = false): void => {
  ctx.runtime.view.cells.push({ x, y, h: heightAtCell(ctx, x, y), color, alpha, outline } satisfies CellMark);
};

// ---------- click to move ----------

export interface ClickToMove {
  /** Walking speed (cells per second). */
  speed: number;
  /** Show where it is going. */
  marker: boolean;
}

interface ClickMoveState {
  goal: { x: number; y: number } | null;
  nav: NavState;
  /** What to do on arriving: a hotspot and the verb to use on it. */
  then: { hotspot: number; verb: string } | null;
}

/** Order an object with Click to Move to walk to a place (used by hotspots, event rows and scripts). */
export function walkTo(ctx: SimContext, e: Entity, x: number, y: number, then: ClickMoveState['then'] = null): void {
  const st = stateOf<ClickMoveState>(e, 'clickMove', () => ({ goal: null, nav: newNav(), then: null }));
  st.goal = { x, y };
  st.nav = newNav();
  st.then = then;
}

export const clickToMove = behaviorDef<ClickToMove>({
  id: 'clickToMove',
  name: 'Click to Move',
  category: 'Control schemes',
  description: 'Point-and-click movement: click the ground and this object walks there, around walls, up stairs and over bridges. Clicking a Hotspot walks up to it and uses it.',
  phase: 'control',
  defaults: { speed: 4, marker: true },
  fields: [
    { key: 'speed', label: 'Walking speed (cells per second)', type: 'number', min: 0.5, step: 0.5 },
    { key: 'marker', label: 'Show where it is going', type: 'boolean' },
  ],
  inputs: [],
  outputs: [{ name: 'walking', label: 'Walking' }],
  requires: { body: { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false } },
  summary: (s) => `Walks to where you click at ${s.speed} cells per second.`,
  update(ctx, e, s) {
    const st = stateOf<ClickMoveState>(e, 'clickMove', () => ({ goal: null, nav: newNav(), then: null }));
    const p = readPointer(ctx.input);
    if (p.primary.pressed && p.cell) {
      const hit = hotspotAt(ctx, p.cell.x, p.cell.y);
      if (hit) walkTo(ctx, e, ...standingSpot(ctx, e, hit), { hotspot: hit.id, verb: String(ctx.runtime.vars.verb ?? 'use') });
      else {
        walkTo(ctx, e, p.cell.x + 0.5, p.cell.y + 0.5);
        ctx.events.emit('click-move', { entity: e.id, x: p.cell.x, y: p.cell.y });
      }
    }
    if (!st.goal) return;
    const r = steerTo(ctx, e, st.goal, s.speed, st.nav, 0.15);
    if (s.marker) mark(ctx, Math.floor(st.goal.x), Math.floor(st.goal.y), 0xffe27a, 0.9, true);
    if (r !== 'moving') {
      st.goal = null;
      const body = e.get<Body>(C.Body);
      if (body) body.vx = body.vy = 0;
      if (st.then) {
        const h = ctx.world.get(st.then.hotspot);
        if (h && r === 'arrived') useHotspot(ctx, h, st.then.verb);
        st.then = null;
      }
    }
  },
});

// ---------- hotspots ----------

export interface Hotspot {
  /** What the pointer shows when over it. */
  label: string;
  /** What looking at it says (or `dialogue:Name` to start a conversation). */
  look: string;
  use: string;
  talk: string;
  /** How close the walker has to get, in cells. */
  reach: number;
}

export const hotspot = behaviorDef<Hotspot>({
  id: 'hotspot',
  name: 'Hotspot',
  category: 'Control schemes',
  description: 'Something to click: with the Look, Use or Talk verb chosen (the variable "verb"), the walker goes up to it and its words are said, or a conversation starts ("dialogue:Name"). Event rows can react with the "A hotspot was used" condition.',
  phase: 'logic',
  defaults: { label: 'Thing', look: 'Nothing special.', use: '', talk: '', reach: 1.5 },
  fields: [
    { key: 'label', label: 'Name shown under the pointer', type: 'text' },
    { key: 'look', label: 'Look says (or dialogue:Name)', type: 'text' },
    { key: 'use', label: 'Use says (or dialogue:Name)', type: 'text' },
    { key: 'talk', label: 'Talk says (or dialogue:Name)', type: 'text' },
    { key: 'reach', label: 'How close to stand (cells)', type: 'number', min: 0.5, step: 0.5 },
  ],
  inputs: [],
  outputs: [{ name: 'used', label: 'Was used' }],
  requires: {},
  update(ctx) {
    // the name under the pointer, for a label in the interface
    const p = readPointer(ctx.input);
    const over = p.cell ? hotspotAt(ctx, p.cell.x, p.cell.y) : null;
    ctx.runtime.vars['hover.name'] = over ? (over.get<Hotspot>('hotspot')?.label ?? over.name) : '';
    if (over && p.cell) mark(ctx, p.cell.x, p.cell.y, 0xffffff, 0.8, true);
  },
});

/** The hotspot (an object with the Hotspot behaviour) standing in a cell. */
export function hotspotAt(ctx: SimContext, x: number, y: number): Entity | null {
  for (const e of ctx.world.query('hotspot')) {
    const c = cellOf(e);
    if (c.x === x && c.y === y) return e;
  }
  return null;
}

/** A place to stand next to a hotspot: the walkable cell closest to the walker. */
function standingSpot(ctx: SimContext, walker: Entity, h: Entity): [number, number] {
  const from = walker.require<TransformIso>(C.Transform);
  const c = cellOf(h);
  let best: [number, number] = [c.x + 0.5, c.y + 0.5];
  let bd = Infinity;
  if (ctx.map) {
    for (const [dx, dy] of [[0, 1], [1, 0], [0, -1], [-1, 0], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const) {
      const nx = c.x + dx;
      const ny = c.y + dy;
      if (!ctx.map.inBounds(nx, ny) || !cellWalkable(ctx.map, nx, ny)) continue;
      const d = Math.hypot(nx + 0.5 - from.x, ny + 0.5 - from.y);
      if (d < bd) {
        bd = d;
        best = [nx + 0.5, ny + 0.5];
      }
    }
  }
  return best;
}

/** Do a verb on a hotspot: say its words or start its conversation, and announce it. */
export function useHotspot(ctx: SimContext, h: Entity, verb: string): void {
  const s = { look: '', use: '', talk: '', ...(h.get<Partial<Hotspot>>('hotspot') ?? {}) } as Hotspot;
  const text = verb === 'look' ? s.look : verb === 'talk' ? s.talk : s.use;
  ctx.events.emit('hotspot-used', { entity: h.id, verb, name: h.name });
  ctx.runtime.vars['hotspot.last'] = h.name;
  ctx.runtime.vars['hotspot.verb'] = verb;
  if (text.startsWith('dialogue:')) beginDialogue(ctx, text.slice(9));
  else if (text) ctx.events.emit('message', { text });
}

// ---------- grid cursor (tactics) ----------

export interface GridCursor {
  /** The team a person plays. */
  team: string;
  /** Tint the cells a selected unit can walk to and hit. */
  showRange: boolean;
}

export const gridCursor = behaviorDef<GridCursor>({
  id: 'gridCursor',
  name: 'Grid Cursor',
  category: 'Control schemes',
  description: 'Tactics controls: a cursor over the grid. Click one of your units to select it (the cells it can walk to light up blue, enemies in reach red), click a blue cell to walk there, click an enemy in reach to attack, right-click to deselect, and the End turn button ends the turn. Put it on any object (an empty "Controls" object works).',
  phase: 'control',
  defaults: { team: 'blue', showRange: true },
  fields: [
    { key: 'team', label: 'Team the person plays', type: 'text' },
    { key: 'showRange', label: 'Tint movement and attack range', type: 'boolean' },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const p = readPointer(ctx.input);
    const vars = ctx.runtime.vars;
    const turns = ctx.runtime.turns;
    const selectedId = typeof vars['cursor.selected'] === 'number' ? (vars['cursor.selected'] as number) : -1;
    let sel = ctx.world.get(selectedId);
    if (sel && (!sel.alive || (healthOf(sel)?.dead ?? false))) sel = undefined;
    const unitAt = (x: number, y: number): Entity | undefined => unitsOf(ctx).find((u) => cellOf(u).x === x && cellOf(u).y === y);
    const hover = p.cell;
    if (hover) mark(ctx, hover.x, hover.y, 0xffffff, 0.9, true);
    vars['cursor.x'] = hover?.x ?? -1;
    vars['cursor.y'] = hover?.y ?? -1;
    const under = hover ? unitAt(hover.x, hover.y) : undefined;
    vars['cursor.unit'] = under?.name ?? '';
    if (ctx.input.pressed('end_turn')) endTurn(ctx);
    const myTurn = (u: Entity): boolean => !turns.active || (turns.phase === 'acting' && currentUnit(ctx) === u);

    if (p.secondary.pressed) sel = undefined;
    if (p.primary.pressed && hover) {
      const clicked = unitAt(hover.x, hover.y);
      if (clicked && takerOf(clicked).team === s.team && (!sel || clicked !== sel)) {
        sel = clicked;
      } else if (sel && myTurn(sel)) {
        if (clicked && takerOf(clicked).team !== s.team) commandAttack(ctx, sel, clicked);
        else if (!clicked) commandMove(ctx, sel, hover.x, hover.y);
      } else if (!clicked) sel = undefined;
    }
    vars['cursor.selected'] = sel ? sel.id : -1;
    // the selected unit's card: numbers an interface can show
    const h = sel ? healthOf(sel) : undefined;
    vars['sel.name'] = sel?.name ?? '';
    vars['sel.team'] = sel ? takerOf(sel).team : '';
    vars['sel.hp'] = h?.hp ?? 0;
    vars['sel.hpMax'] = h?.max ?? 0;
    vars['sel.ap'] = sel ? (turns.ap[sel.id] ?? (turns.active ? 0 : takerOf(sel).apMax)) : 0;
    vars['sel.apMax'] = sel ? takerOf(sel).apMax : 0;
    if (sel) {
      const c = cellOf(sel);
      mark(ctx, c.x, c.y, 0x7dffb2, 0.9, true);
      if (s.showRange && myTurn(sel)) {
        const range = moveRange(ctx, sel);
        for (const k of range.keys()) {
          const [x, y] = k.split(',').map(Number) as [number, number];
          if (x !== c.x || y !== c.y) mark(ctx, x, y, 0x4aa3df, 0.38);
        }
        const me = takerOf(sel);
        for (const u of unitsOf(ctx)) {
          if (takerOf(u).team === me.team) continue;
          const uc = cellOf(u);
          if (Math.abs(uc.x - c.x) + Math.abs(uc.y - c.y) <= me.attackRange) mark(ctx, uc.x, uc.y, 0xe0566b, 0.55);
        }
        // the walk to the cell under the pointer
        const path = hover ? range.get(`${hover.x},${hover.y}`)?.path : undefined;
        for (const step of path ?? []) mark(ctx, Math.floor(step.x), Math.floor(step.y), 0xffe27a, 0.55);
      }
    }
    void e;
  },
});

// ---------- RTS: selection, orders and crowds ----------

export interface Commandable {
  team: string;
  /** Walking speed (cells per second). */
  speed: number;
  /** How close another unit may come before it is pushed aside (cells). */
  spacing: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  /** Attack enemies that come this close on their own (0 = only when ordered). */
  aggro: number;
}

/** `ax`, `ay` is the place the whole group was sent (they share one flow field to it); x, y is this unit's own spot around it. */
export type Order = { type: 'move'; x: number; y: number; ax?: number; ay?: number } | { type: 'attackMove'; x: number; y: number; ax?: number; ay?: number } | { type: 'attack'; target: number } | { type: 'stop' };

interface OrderState {
  list: Order[];
  cooldown: number;
  /** The flow field this unit is following, and the cell it leads to (renewed only now and then when the goal moves). */
  field: FlowField | null;
  fieldGoal: string;
  fieldAt: number;
}

const ordersOf = (e: Entity): OrderState => stateOf<OrderState>(e, 'orders', () => ({ list: [], cooldown: 0, field: null, fieldGoal: '', fieldAt: -1000 }));

/** Give an order to a unit: replaces what it was doing, or joins the end of the queue. */
export function giveOrder(e: Entity, order: Order, queue = false): void {
  const st = ordersOf(e);
  if (order.type === 'stop') {
    st.list = [];
    return;
  }
  if (queue) st.list.push(order);
  else st.list = [order];
}

const NAV_VERSION = 'nav.version';

/** Tell units that buildings changed where they can walk (the next orders build fresh flow fields). */
export function bumpNav(ctx: SimContext): void {
  ctx.runtime.vars[NAV_VERSION] = (Number(ctx.runtime.vars[NAV_VERSION]) || 0) + 1;
}

/** Cells buildings and other solid things take up. Units walk around them. */
function solidCells(ctx: SimContext): Set<number> {
  const key = `solid:${ctx.runtime.scene}:${String(ctx.runtime.vars[NAV_VERSION] ?? 0)}`;
  const cached = ctx.runtime.scratch.get(key) as { at: number; set: Set<number> } | undefined;
  if (cached && cached.at === ctx.world.count) return cached.set;
  const w = ctx.map?.width ?? 0;
  const set = new Set<number>();
  for (const o of ctx.world.query(C.Transform, C.Collider)) {
    if (o.has(C.Body)) continue;
    const c = o.require<{ solid: boolean; enabled: boolean; trigger: boolean; height: number; w: number; d: number }>(C.Collider);
    if (!c.solid || !c.enabled || c.trigger || c.height < 0.4) continue;
    const t = o.require<TransformIso>(C.Transform);
    for (let x = Math.floor(t.x - c.w / 2 + 0.05); x <= Math.floor(t.x + c.w / 2 - 0.05); x++) for (let y = Math.floor(t.y - c.d / 2 + 0.05); y <= Math.floor(t.y + c.d / 2 - 0.05); y++) set.add(y * w + x);
  }
  ctx.runtime.scratch.set(key, { at: ctx.world.count, set });
  return set;
}

/** The flow field toward a cell (one search shared by every unit going there). */
export function fieldTo(ctx: SimContext, x: number, y: number): FlowField | null {
  const map = ctx.map;
  if (!map) return null;
  const gx = Math.floor(x);
  const gy = Math.floor(y);
  const key = `flow:${ctx.runtime.scene}:${String(ctx.runtime.vars[NAV_VERSION] ?? 0)}:${gx},${gy}`;
  let f = ctx.runtime.scratch.get(key) as FlowField | undefined;
  if (!f) {
    const solid = solidCells(ctx);
    f = buildFlowField(map, [{ x: gx, y: gy }], { stepUp: 0.6, maxDrop: 1, blocked: (cx, cy) => solid.has(cy * map.width + cx) });
    // keep the cache small: forget old goals when there are many
    let n = 0;
    for (const k of [...ctx.runtime.scratch.keys()]) if (k.startsWith('flow:') && ++n > 64) ctx.runtime.scratch.delete(k);
    ctx.runtime.scratch.set(key, f);
  }
  return f;
}

/** A hash of where the crowd is, rebuilt once per tick, so neighbours are found without looking at everyone. */
function crowdIndex(ctx: SimContext): Map<number, Entity[]> {
  const cached = ctx.runtime.scratch.get('crowd') as { tick: number; map: Map<number, Entity[]> } | undefined;
  if (cached && cached.tick === ctx.tick) return cached.map;
  const map = new Map<number, Entity[]>();
  const w = ctx.map?.width ?? 1;
  for (const u of ctx.world.query('commandable')) {
    const t = u.require<TransformIso>(C.Transform);
    const k = Math.floor(t.y) * w + Math.floor(t.x);
    const list = map.get(k);
    if (list) list.push(u);
    else map.set(k, [u]);
  }
  ctx.runtime.scratch.set('crowd', { tick: ctx.tick, map });
  return map;
}

function neighboursOf(ctx: SimContext, e: Entity, radius: number): Entity[] {
  const index = crowdIndex(ctx);
  const w = ctx.map?.width ?? 1;
  const t = e.require<TransformIso>(C.Transform);
  const cx = Math.floor(t.x);
  const cy = Math.floor(t.y);
  const r = Math.ceil(radius);
  const out: Entity[] = [];
  for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) for (const o of index.get(y * w + x) ?? []) if (o !== e) out.push(o);
  return out;
}

const alive = (e: Entity | undefined): e is Entity => !!e && e.alive && !(healthOf(e)?.dead ?? false);

function nearestEnemy(ctx: SimContext, e: Entity, team: string, within: number): Entity | null {
  const t = e.require<TransformIso>(C.Transform);
  let best: Entity | null = null;
  let bd = within * within;
  for (const o of ctx.world.query('commandable')) {
    if (o === e || !alive(o) || (o.get<Commandable>('commandable')?.team ?? '') === team) continue;
    const ot = o.require<TransformIso>(C.Transform);
    const d = (ot.x - t.x) ** 2 + (ot.y - t.y) ** 2;
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

export const commandable = behaviorDef<Commandable>({
  id: 'commandable',
  name: 'Commandable Unit',
  category: 'Control schemes',
  description: 'A unit that follows orders (move, attack, attack-move, stop), one after another when queued. Crowds of them share one flow field per destination, so hundreds can move at once without bumping into each other. Units on a team attack enemies that come close by themselves if "Auto-attack range" is more than 0.',
  phase: 'control',
  timing: 'realtime',
  defaults: { team: 'blue', speed: 3, spacing: 0.7, attackRange: 1.2, attackDamage: 2, attackCooldown: 0.8, aggro: 4 },
  fields: [
    { key: 'team', label: 'Team', type: 'text' },
    { key: 'speed', label: 'Walking speed (cells per second)', type: 'number', min: 0.5, step: 0.5 },
    { key: 'spacing', label: 'Personal space (cells)', type: 'number', min: 0.2, step: 0.1 },
    { key: 'attackRange', label: 'Attack range (cells)', type: 'number', min: 0.5, step: 0.1 },
    { key: 'attackDamage', label: 'Attack damage', type: 'number', min: 0, step: 1 },
    { key: 'attackCooldown', label: 'Seconds between attacks', type: 'number', min: 0.1, step: 0.1 },
    { key: 'aggro', label: 'Auto-attack range (0 = only when ordered)', type: 'number', min: 0, step: 1 },
  ],
  inputs: [],
  outputs: [],
  requires: { body: { vx: 0, vy: 0, vz: 0, radius: 0.25, height: 1, state: 'ground', stepUp: 0.6, stepDown: 1, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false } },
  update(ctx, e, s) {
    const st = ordersOf(e);
    const b = e.require<Body>(C.Body);
    const t = e.require<TransformIso>(C.Transform);
    if (st.cooldown > 0) st.cooldown -= ctx.dt;
    if ((healthOf(e)?.dead ?? false)) {
      b.vx = b.vy = 0;
      return;
    }
    let order = st.list[0];
    // an idle unit (or one on attack-move) takes on enemies that come close
    if ((!order || order.type === 'attackMove') && s.aggro > 0) {
      const foe = nearestEnemy(ctx, e, s.team, s.aggro);
      if (foe) order = { type: 'attack', target: foe.id };
    }
    let goal: { x: number; y: number } | null = null;
    let approach: { x: number; y: number } | null = null; // where the shared flow field leads
    if (order?.type === 'move' || order?.type === 'attackMove') {
      goal = { x: order.x, y: order.y };
      approach = order.ax !== undefined && order.ay !== undefined ? { x: order.ax, y: order.ay } : goal;
      if (Math.hypot(order.x - t.x, order.y - t.y) < 0.45 || (neighboursNear(ctx, e, goal, s.spacing) >= 3 && Math.hypot(order.x - t.x, order.y - t.y) < 1.6)) {
        st.list.shift();
        goal = null;
      }
    } else if (order?.type === 'attack') {
      const foe = ctx.world.get(order.target);
      if (!alive(foe)) {
        if (st.list[0]?.type === 'attack') st.list.shift();
        goal = null;
      } else {
        const ft = foe.require<TransformIso>(C.Transform);
        const dist = Math.hypot(ft.x - t.x, ft.y - t.y);
        if (dist <= s.attackRange) {
          goal = null;
          if (st.cooldown <= 0) {
            st.cooldown = s.attackCooldown;
            damage(ctx, foe, s.attackDamage, { source: e, ignoreIframes: true });
            ctx.events.emit('unit-attacked', { attacker: e.id, target: foe.id, damage: s.attackDamage });
          }
        } else {
          goal = { x: ft.x, y: ft.y };
          approach = goal;
        }
      }
    }
    if (!goal) {
      b.vx = b.vy = 0;
      return;
    }
    // follow the flow field to the group's destination; a unit asks for a new one only when the destination moved, and not every tick
    const want = `${Math.floor((approach ?? goal).x)},${Math.floor((approach ?? goal).y)}`;
    if (st.fieldGoal !== want && (!st.field || ctx.tick - st.fieldAt > 20 + (e.id % 20))) {
      st.field = fieldTo(ctx, (approach ?? goal).x, (approach ?? goal).y);
      st.fieldGoal = want;
      st.fieldAt = ctx.tick;
    }
    const next = st.field ? flowNext(st.field, t.x, t.y) : null;
    const closeToGoal = Math.hypot(goal.x - t.x, goal.y - t.y) < 2.4 && (!approach || Math.hypot(approach.x - t.x, approach.y - t.y) < 3.2);
    const dx = (closeToGoal || !next ? goal.x : next.x) - t.x;
    const dy = (closeToGoal || !next ? goal.y : next.y) - t.y;
    const len = Math.hypot(dx, dy) || 1;
    let vx = (dx / len) * s.speed;
    let vy = (dy / len) * s.speed;
    // a push away from neighbours that are too close
    for (const o of neighboursOf(ctx, e, s.spacing)) {
      const ot = o.require<TransformIso>(C.Transform);
      const ox = t.x - ot.x;
      const oy = t.y - ot.y;
      const d = Math.hypot(ox, oy);
      if (d > 0 && d < s.spacing) {
        const k = ((s.spacing - d) / s.spacing) * s.speed * 0.9;
        vx += (ox / d) * k;
        vy += (oy / d) * k;
      }
    }
    const mag = Math.hypot(vx, vy);
    if (mag > s.speed) {
      vx = (vx / mag) * s.speed;
      vy = (vy / mag) * s.speed;
    }
    b.vx = vx;
    b.vy = vy;
  },
});

function neighboursNear(ctx: SimContext, e: Entity, goal: { x: number; y: number }, spacing: number): number {
  let n = 0;
  for (const o of neighboursOf(ctx, e, 2)) {
    const ot = o.require<TransformIso>(C.Transform);
    if (Math.hypot(ot.x - goal.x, ot.y - goal.y) < spacing * 1.2 && ordersOf(o).list.length === 0) n++;
  }
  return n;
}

export interface RtsControl {
  /** The team a person plays. */
  team: string;
  /** Smallest drag (pixels) that counts as a box. */
  boxMin: number;
}

interface RtsState {
  start: { x: number; y: number } | null;
}

/** The units on a team that are selected right now. */
export function selectedUnits(ctx: SimContext): Entity[] {
  return ctx.world.query('commandable').filter((u) => u.get('state:selected') === true && alive(u));
}

export const rtsControl = behaviorDef<RtsControl>({
  id: 'rtsControl',
  name: 'RTS Control',
  category: 'Control schemes',
  description: 'Real-time strategy controls: click a unit or drag a box to select units, right-click the ground to send them there (spread out), right-click an enemy to attack, Shift+right-click to queue the order after the current ones, A then click to attack-move, S to stop. Put it on any object (an empty "Controls" object works).',
  phase: 'control',
  defaults: { team: 'blue', boxMin: 6 },
  fields: [
    { key: 'team', label: 'Team the person plays', type: 'text' },
    { key: 'boxMin', label: 'Smallest drag that makes a box (pixels)', type: 'number', min: 2, step: 1 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const st = stateOf<RtsState>(e, 'rts', () => ({ start: null }));
    const p = readPointer(ctx.input);
    const view = ctx.runtime.view;
    const mine = ctx.world.query('commandable').filter((u) => (u.get<Commandable>('commandable')?.team ?? '') === s.team && alive(u));
    const setSel = (list: Entity[], add: boolean): void => {
      const keep = new Set(add ? selectedUnits(ctx).map((u) => u.id) : []);
      for (const u of mine) u.set('state:selected', keep.has(u.id) || list.includes(u));
    };
    if (p.primary.pressed) st.start = { x: p.screen.x, y: p.screen.y };
    if (st.start && p.primary.down) {
      view.selectBox = { x0: st.start.x, y0: st.start.y, x1: p.screen.x, y1: p.screen.y };
    }
    if (st.start && p.primary.released) {
      const a = st.start;
      st.start = null;
      view.selectBox = null;
      const drag = Math.hypot(p.screen.x - a.x, p.screen.y - a.y);
      if (drag >= s.boxMin && p.camera && ctx.map) {
        const x0 = Math.min(a.x, p.screen.x);
        const x1 = Math.max(a.x, p.screen.x);
        const y0 = Math.min(a.y, p.screen.y);
        const y1 = Math.max(a.y, p.screen.y);
        const inside = mine.filter((u) => {
          const t = u.require<TransformIso>(C.Transform);
          const pt = pictureOf(p.camera!, view.rotation, ctx.map, t.x, t.y, t.h + 0.5);
          return pt.x >= x0 && pt.x <= x1 && pt.y >= y0 && pt.y <= y1;
        });
        setSel(inside, p.shift);
      } else if (p.cell) {
        const hit = mine.find((u) => cellOf(u).x === p.cell!.x && cellOf(u).y === p.cell!.y);
        if (hit) setSel([hit], p.shift);
        else if (!p.shift) setSel([], false);
      }
    }
    const sel = selectedUnits(ctx);
    ctx.runtime.vars['rts.selected'] = sel.length;
    ctx.runtime.vars['rts.first'] = sel[0]?.name ?? '';
    for (const u of sel) {
      const c = cellOf(u);
      mark(ctx, c.x, c.y, 0x7dffb2, 0.9, true);
    }
    // orders
    if (ctx.input.pressed('rts_stop')) for (const u of sel) giveOrder(u, { type: 'stop' });
    if (p.secondary.pressed && p.cell && sel.length > 0) {
      const foe = ctx.world.query('commandable').find((u) => alive(u) && (u.get<Commandable>('commandable')?.team ?? '') !== s.team && cellOf(u).x === p.cell!.x && cellOf(u).y === p.cell!.y);
      const attackMove = ctx.input.down('rts_attack_move');
      sel.forEach((u, i) => {
        if (foe) giveOrder(u, { type: 'attack', target: foe.id }, p.shift);
        else {
          // spread the group out around the target, ring by ring
          const spot = ringSpot(p.cell!.x + 0.5, p.cell!.y + 0.5, i, 0.8);
          giveOrder(u, { type: attackMove ? 'attackMove' : 'move', x: spot.x, y: spot.y, ax: p.cell!.x + 0.5, ay: p.cell!.y + 0.5 }, p.shift);
        }
      });
      ctx.events.emit('orders-given', { count: sel.length, x: p.cell.x, y: p.cell.y, attack: !!foe });
    }
  },
});

/** The i-th spot in rings around a centre (one in the middle, six around it, twelve around those...). */
export function ringSpot(cx: number, cy: number, i: number, gap: number): { x: number; y: number } {
  if (i === 0) return { x: cx, y: cy };
  let ring = 1;
  let left = i - 1;
  while (left >= ring * 6) {
    left -= ring * 6;
    ring++;
  }
  const a = (left / (ring * 6)) * Math.PI * 2;
  return { x: cx + Math.cos(a) * ring * gap, y: cy + Math.sin(a) * ring * gap };
}

// ---------- camera rig ----------

export interface CameraRig {
  panSpeed: number;
  /** Pan when the pointer is at the edge of the picture. */
  edgePan: boolean;
  zoomMin: number;
  zoomMax: number;
  /** Allow turning the world between the four views. */
  rotate: boolean;
}

interface RigState {
  x: number;
  y: number;
  zoom: number;
  drag: { sx: number; sy: number } | null;
}

export const cameraRig = behaviorDef<CameraRig>({
  id: 'cameraRig',
  name: 'Camera Rig',
  category: 'Control schemes',
  description: 'A free camera for builders and strategy games: the move buttons (or the pointer at the edge of the picture, or the middle mouse button dragged) pan it, the mouse wheel zooms, and the camera-turn buttons (Q and E) turn the whole world between the four isometric views. Put it on any object.',
  phase: 'control',
  defaults: { panSpeed: 12, edgePan: true, zoomMin: 0.5, zoomMax: 2.5, rotate: true },
  fields: [
    { key: 'panSpeed', label: 'Pan speed (cells per second)', type: 'number', min: 1, step: 1 },
    { key: 'edgePan', label: 'Pan when the pointer is at the edge', type: 'boolean' },
    { key: 'zoomMin', label: 'Furthest out (zoom)', type: 'number', min: 0.25, step: 0.25 },
    { key: 'zoomMax', label: 'Closest in (zoom)', type: 'number', min: 1, step: 0.25 },
    { key: 'rotate', label: 'Turn the view with Q and E', type: 'boolean' },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const map = ctx.map;
    if (!map || ctx.runtime.cutscene) return;
    const st = stateOf<RigState>(e, 'rig', () => ({ x: map.width / 2, y: map.height / 2, zoom: 1, drag: null }));
    const p = readPointer(ctx.input);
    const view = ctx.runtime.view;
    // pan: the move buttons are "up the screen", whatever way the world is turned
    const v = ctx.input.vector('move_left', 'move_right', 'move_up', 'move_down');
    let sx = v.x;
    let sy = v.y;
    if (s.edgePan && p.camera && p.inside) {
      const m = 14;
      if (p.screen.x < m) sx -= 1;
      else if (p.screen.x > p.camera.w - m) sx += 1;
      if (p.screen.y < m) sy -= 1;
      else if (p.screen.y > p.camera.h - m) sy += 1;
    }
    if (sx !== 0 || sy !== 0) {
      const g = screenIntentToGrid(sx, sy, view.rotation);
      const k = (s.panSpeed / st.zoom) * ctx.dt;
      st.x += g.x * k;
      st.y += g.y * k;
    }
    // drag with the middle button
    const mid = ctx.input.down('pointer_middle');
    if (mid && p.camera) {
      if (st.drag) {
        const dx = (p.screen.x - st.drag.sx) / st.zoom;
        const dy = (p.screen.y - st.drag.sy) / st.zoom;
        const g = screenIntentToGrid(-dx / 32, -dy / 16, view.rotation);
        st.x += g.x * 0.5;
        st.y += g.y * 0.5;
      }
      st.drag = { sx: p.screen.x, sy: p.screen.y };
    } else st.drag = null;
    if (p.wheel !== 0) st.zoom = Math.min(s.zoomMax, Math.max(s.zoomMin, st.zoom * (p.wheel > 0 ? 1.15 : 1 / 1.15)));
    if (s.rotate) {
      if (ctx.input.pressed('camera_rotate_left')) view.rotation = ((view.rotation + 3) % 4) as 0 | 1 | 2 | 3;
      if (ctx.input.pressed('camera_rotate_right')) view.rotation = ((view.rotation + 1) % 4) as 0 | 1 | 2 | 3;
    }
    st.x = Math.min(map.width, Math.max(0, st.x));
    st.y = Math.min(map.height, Math.max(0, st.y));
    view.cameraTarget = { x: st.x, y: st.y };
    view.cameraZoom = st.zoom;
  },
});

// ---------- builder ----------

export interface Builder {
  /** The data table of buildings: columns `prefab`, `w` and `d` (footprint in cells), `cost` (and `name`). */
  table: string;
  /** The resource variable the cost is paid from. */
  currency: string;
  /** Largest height difference across a footprint (levels). */
  flatness: number;
}

export const builder = behaviorDef<Builder>({
  id: 'builder',
  name: 'Builder',
  category: 'Control schemes',
  description: 'Place buildings from a data table: pick one (the variable "build.selected" holds its row id), move the pointer to see a ghost footprint (green where it fits, red where it does not), R turns it a quarter turn, click to place it and pay its cost, right-click to put it away. Holding the button and dragging places 1 x 1 pieces (walls, fences) along the way. Footprints can be any number of cells.',
  phase: 'control',
  defaults: { table: 'Buildings', currency: 'gold', flatness: 0 },
  fields: [
    { key: 'table', label: 'Table of buildings', type: 'text', help: 'Needs the columns prefab, w, d and cost.' },
    { key: 'currency', label: 'Paid from the variable', type: 'text' },
    { key: 'flatness', label: 'Highest slope a building may stand on (levels)', type: 'number', min: 0, step: 1 },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const vars = ctx.runtime.vars;
    const id = String(vars['build.selected'] ?? '');
    const table = ctx.assets.tables.get(s.table);
    const row = table?.rows.find((r) => r.id === id);
    const p = readPointer(ctx.input);
    if (!row) {
      vars['build.valid'] = false;
      vars['build.why'] = '';
      return;
    }
    if (p.secondary.pressed || ctx.input.pressed('build_cancel')) {
      vars['build.selected'] = '';
      return;
    }
    if (ctx.input.pressed('build_rotate')) vars['build.rotation'] = ((Number(vars['build.rotation']) || 0) + 1) % 2;
    const rot = Number(vars['build.rotation']) || 0;
    const w0 = Math.max(1, Number(row.w) || 1);
    const d0 = Math.max(1, Number(row.d) || 1);
    const w = rot === 1 ? d0 : w0;
    const d = rot === 1 ? w0 : d0;
    if (!p.cell) {
      vars['build.valid'] = false;
      return;
    }
    // the footprint hangs from the cell under the pointer: that cell is its middle (or the middle-ish for even sizes)
    const x0 = p.cell.x - Math.floor((w - 1) / 2);
    const y0 = p.cell.y - Math.floor((d - 1) / 2);
    const why = placementProblem(ctx, s, row.id, x0, y0, w, d);
    const ok = why === '';
    vars['build.valid'] = ok;
    vars['build.why'] = why;
    vars['build.name'] = String(row.name ?? row.id);
    vars['build.cost'] = Number(row.cost) || 0;
    for (let y = y0; y < y0 + d; y++) for (let x = x0; x < x0 + w; x++) mark(ctx, x, y, ok ? 0x5fd38d : 0xe0566b, 0.5);
    const placing = p.primary.pressed || (p.primary.down && w0 === 1 && d0 === 1 && (vars['build.lastCell'] !== `${p.cell.x},${p.cell.y}`));
    if (placing && ok) {
      const prefab = String(row.prefab ?? '');
      const cx = x0 + w / 2;
      const cy = y0 + d / 2;
      const made = prefab ? spawnPrefabAt(ctx, e, prefab, cx, cy, heightAtCell(ctx, x0, y0), `build${ctx.tick}`) : null;
      if (made) {
        made.set('footprint', { x: x0, y: y0, w, d, row: row.id });
        if (!made.tags.has('building')) made.tags.add('building');
        vars[s.currency] = (Number(vars[s.currency]) || 0) - (Number(row.cost) || 0);
        vars['build.lastCell'] = `${p.cell.x},${p.cell.y}`;
        vars['build.count'] = (Number(vars['build.count']) || 0) + 1;
        bumpNav(ctx);
        ctx.events.emit('building-placed', { entity: made.id, row: row.id, x: x0, y: y0, w, d });
        if (!p.shift && !(w0 === 1 && d0 === 1)) vars['build.selected'] = '';
      }
    }
    if (!p.primary.down) vars['build.lastCell'] = '';
  },
});

/** Why a building cannot go here, in plain English, or '' when it can. */
export function placementProblem(ctx: SimContext, s: Builder, rowId: string, x0: number, y0: number, w: number, d: number): string {
  const map = ctx.map;
  const row = ctx.assets.tables.get(s.table)?.rows.find((r) => r.id === rowId);
  if (!map || !row) return 'There is nothing to build on.';
  const cost = Number(row.cost) || 0;
  if ((Number(ctx.runtime.vars[s.currency]) || 0) < cost) return `Not enough ${s.currency}: it costs ${cost}.`;
  const base = map.inBounds(x0, y0) ? map.getHeight(x0, y0) : 0;
  const solid = solidCells(ctx);
  for (let y = y0; y < y0 + d; y++) {
    for (let x = x0; x < x0 + w; x++) {
      if (!map.inBounds(x, y)) return 'It does not fit on the map.';
      if (!cellWalkable(map, x, y)) return 'The ground there cannot be built on (water, a pit or a wall).';
      if (Math.abs(map.getHeight(x, y) - base) > s.flatness || map.getSlope(x, y)) return 'The ground there is not flat enough.';
      if (solid.has(y * map.width + x)) return 'Something is already there.';
    }
  }
  return '';
}
