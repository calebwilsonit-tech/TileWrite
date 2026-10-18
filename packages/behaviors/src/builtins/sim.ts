import {
  C,
  timeOfDay,
  type Body,
  type Entity,
  type SimContext,
  type TableRow,
  type TransformIso,
  type VariableValue,
} from '@tilewright/runtime';
import { behaviorDef, stateOf } from '../framework';
import { newNav, steerTo, type NavState } from './ai';
import { healthOf } from './combat';
import { spawnPrefabAt } from './world';

/**
 * Simulation helpers that any genre can use: resources and production chains, a calendar (day and night, seasons), waves of
 * enemies from a table, units that follow a route, villagers that choose what to do by their needs, and cellular automata
 * (fire, growth, spreading water) on the map itself. Plain behaviours and data tables: nothing here knows what a "colony" or a
 * "tower defence" is.
 */

// ---------- resources ----------

/** "wood:2, stone:1" -> [["wood", 2], ["stone", 1]]. */
export function parseCosts(text: string): [string, number][] {
  const out: [string, number][] = [];
  for (const part of text.split(',')) {
    const [name, amount] = part.split(':').map((s) => s.trim());
    if (!name) continue;
    const n = amount === undefined || amount === '' ? 1 : Number(amount);
    if (Number.isFinite(n)) out.push([name, n]);
  }
  return out;
}

const amountOf = (vars: Record<string, VariableValue>, name: string): number => (typeof vars[name] === 'number' ? (vars[name] as number) : 0);

export function canAfford(vars: Record<string, VariableValue>, costs: string): boolean {
  return parseCosts(costs).every(([name, n]) => amountOf(vars, name) >= n);
}

/** Take the costs away if all of them can be paid; false (and nothing taken) otherwise. */
export function spend(vars: Record<string, VariableValue>, costs: string): boolean {
  if (!canAfford(vars, costs)) return false;
  for (const [name, n] of parseCosts(costs)) vars[name] = amountOf(vars, name) - n;
  return true;
}

export function earn(vars: Record<string, VariableValue>, gains: string): void {
  for (const [name, n] of parseCosts(gains)) vars[name] = amountOf(vars, name) + n;
}

export interface Producer {
  /** What it makes, like "wood:1" or "bread:2" (several: "wood:1, tools:1"). */
  makes: string;
  /** What each batch uses up, like "grain:3". */
  uses: string;
  /** Seconds for one batch. */
  seconds: number;
  enabled: boolean;
}

export const producer = behaviorDef<Producer>({
  id: 'producer',
  name: 'Producer',
  category: 'Simulation',
  description: 'Makes resources over time: every few seconds it uses up what is in "Uses" (if all of it is there) and adds what is in "Makes". Chain them: a farm makes grain, a mill turns grain into flour, a bakery turns flour into bread. Resources are ordinary variables, so costs, the interface and event rows all see them.',
  phase: 'actuator',
  timing: 'realtime',
  defaults: { makes: 'gold:1', uses: '', seconds: 5, enabled: true },
  fields: [
    { key: 'makes', label: 'Makes (name:amount, ...)', type: 'text' },
    { key: 'uses', label: 'Uses up each batch (name:amount, ...)', type: 'text' },
    { key: 'seconds', label: 'Seconds per batch', type: 'number', min: 0.1, step: 0.5 },
    { key: 'enabled', label: 'Working', type: 'boolean' },
  ],
  inputs: [{ name: 'run', label: 'Work only while this is on (when wired)' }],
  outputs: [{ name: 'blocked', label: 'Waiting for what it needs' }, { name: 'made', label: 'Just made something' }],
  requires: {},
  summary: (s) => `Every ${s.seconds} s: ${s.uses ? `uses ${s.uses}, ` : ''}makes ${s.makes}.`,
  update(ctx, e, s) {
    const st = stateOf<{ t: number; blocked: boolean }>(e, 'producer', () => ({ t: 0, blocked: false }));
    const sig = e.get<{ inputs: Record<string, boolean>; outputs: Record<string, boolean> }>('signals');
    const gate = sig && 'run' in sig.inputs ? sig.inputs.run === true : true;
    if (sig) sig.outputs.made = false;
    if (!s.enabled || !gate) return;
    st.t += ctx.dt;
    if (st.t < s.seconds) return;
    if (!spend(ctx.runtime.vars, s.uses)) {
      st.blocked = true;
      st.t = s.seconds; // keep waiting for what it needs
      if (sig) sig.outputs.blocked = true;
      return;
    }
    st.blocked = false;
    if (sig) sig.outputs.blocked = false;
    st.t = 0;
    earn(ctx.runtime.vars, s.makes);
    if (sig) sig.outputs.made = true;
    ctx.events.emit('produced', { entity: e.id, makes: s.makes });
  },
});

// ---------- calendar ----------

export interface Calendar {
  /** Real seconds per game day. */
  dayLength: number;
  startHour: number;
  daysPerSeason: number;
  /** Darken the picture at night. */
  tint: boolean;
}

const SEASONS = ['spring', 'summer', 'autumn', 'winter'];

export const calendar = behaviorDef<Calendar>({
  id: 'calendar',
  name: 'Calendar',
  category: 'Simulation',
  description: 'Keeps the date and time of day from the game clock: variables time.hour (0-24), time.clock ("08:30"), time.day, time.season (0-3) and time.seasonName, time.year, time.night. It announces new-day, day-start, night-start and new-season, and can darken the screen at night. Time passes only while the world runs (not while paused or in turn-based mode) and at the chosen game speed. Put it on any object.',
  phase: 'source',
  defaults: { dayLength: 120, startHour: 8, daysPerSeason: 10, tint: true },
  fields: [
    { key: 'dayLength', label: 'Seconds per day', type: 'number', min: 10, step: 10 },
    { key: 'startHour', label: 'The game starts at (hour)', type: 'number', min: 0, max: 23, step: 1 },
    { key: 'daysPerSeason', label: 'Days per season', type: 'number', min: 1, step: 1 },
    { key: 'tint', label: 'Darken the picture at night', type: 'boolean' },
  ],
  inputs: [],
  outputs: [{ name: 'night', label: 'It is night' }],
  requires: {},
  update(ctx, e, s) {
    const t = timeOfDay(ctx.runtime.clock, s.dayLength, s.startHour);
    const vars = ctx.runtime.vars;
    const night = t.hour < 6 || t.hour >= 20;
    const season = Math.floor((t.day / s.daysPerSeason) % 4);
    const st = stateOf<{ day: number; night: boolean; season: number }>(e, 'calendar', () => ({ day: -1, night, season }));
    vars['time.hour'] = Math.round(t.hour * 100) / 100;
    vars['time.clock'] = `${String(Math.floor(t.hour)).padStart(2, '0')}:${String(Math.floor((t.hour % 1) * 60)).padStart(2, '0')}`;
    vars['time.day'] = t.day + 1;
    vars['time.season'] = season;
    vars['time.seasonName'] = SEASONS[season]!;
    vars['time.year'] = Math.floor(t.day / (s.daysPerSeason * 4)) + 1;
    vars['time.night'] = night;
    if (st.day !== t.day) {
      if (st.day >= 0) ctx.events.emit('new-day', { day: t.day + 1 });
      st.day = t.day;
    }
    if (st.night !== night) {
      ctx.events.emit(night ? 'night-start' : 'day-start', {});
      st.night = night;
    }
    if (st.season !== season) {
      ctx.events.emit('new-season', { season, name: SEASONS[season] });
      st.season = season;
    }
    const sig = e.get<{ outputs: Record<string, boolean> }>('signals');
    if (sig) sig.outputs.night = night;
    if (s.tint) {
      // dark blue at night, a warm edge at dawn and dusk, clear by day
      const h = t.hour;
      const dark = h < 5 ? 1 : h < 7 ? 1 - (h - 5) / 2 : h < 19 ? 0 : h < 21 ? (h - 19) / 2 : 1;
      const warm = h >= 5 && h < 8 ? 1 - Math.abs(h - 6.5) / 1.5 : h >= 18 && h < 21 ? 1 - Math.abs(h - 19.5) / 1.5 : 0;
      ctx.runtime.view.tint = dark > 0.01 || warm > 0.01 ? { color: warm > dark ? 0xff9a4d : 0x0a1030, alpha: Math.max(dark * 0.55, warm * 0.18) } : null;
    }
  },
});

// ---------- waves ----------

export interface WaveSpawner {
  /** The data table of waves: columns prefab, count and gap (seconds between spawns); optional delay (seconds before the wave) and tag. */
  table: string;
  autoStart: boolean;
  /** Seconds between a wave being beaten and the next starting. */
  rest: number;
  /** After the last row, keep going with bigger copies of it. */
  endless: boolean;
}

interface WaveState {
  /** Index of the wave under way (-1 before the first). */
  index: number;
  phase: 'idle' | 'resting' | 'spawning' | 'fighting' | 'done';
  left: number;
  timer: number;
  spawned: number[];
  extra: number;
}

export const waveSpawner = behaviorDef<WaveSpawner>({
  id: 'waveSpawner',
  name: 'Wave Spawner',
  category: 'Simulation',
  description: 'Sends waves of enemies from a data table (rows: prefab, count, gap between spawns, delay before the wave). They appear at this object. When every enemy of a wave is gone the next wave comes after a rest. Variables: wave.index, wave.total, wave.alive, wave.state, wave.countdown. Events: wave-started, wave-cleared, waves-done. Use the "Start the next wave" action for a button, or switch on automatic start.',
  phase: 'actuator',
  timing: 'realtime',
  defaults: { table: 'Waves', autoStart: true, rest: 5, endless: false },
  fields: [
    { key: 'table', label: 'Table of waves', type: 'text' },
    { key: 'autoStart', label: 'Start on its own', type: 'boolean' },
    { key: 'rest', label: 'Rest between waves (seconds)', type: 'number', min: 0, step: 1 },
    { key: 'endless', label: 'Keep going after the last wave (stronger copies)', type: 'boolean' },
  ],
  inputs: [{ name: 'next', label: 'Start the next wave' }],
  outputs: [{ name: 'cleared', label: 'A wave was beaten' }],
  requires: {},
  update(ctx, e, s) {
    const rows = ctx.assets.tables.get(s.table)?.rows ?? [];
    const st = stateOf<WaveState>(e, 'waves', () => ({ index: -1, phase: s.autoStart ? 'resting' : 'idle', left: 0, timer: s.autoStart ? s.rest : 0, spawned: [], extra: 0 }));
    const vars = ctx.runtime.vars;
    const sig = e.get<{ inputs: Record<string, boolean>; outputs: Record<string, boolean> }>('signals');
    if (sig) sig.outputs.cleared = false;
    st.spawned = st.spawned.filter((id) => {
      const x = ctx.world.get(id);
      return !!x && !(healthOf(x)?.dead ?? false);
    });
    vars['wave.total'] = s.endless ? 9999 : rows.length;
    vars['wave.alive'] = st.spawned.length;
    vars['wave.index'] = Math.max(0, st.index + 1);
    vars['wave.state'] = st.phase;
    const rowFor = (i: number): { row: TableRow; scale: number } | null => {
      if (i < rows.length) return { row: rows[i]!, scale: 1 };
      if (s.endless && rows.length > 0) return { row: rows[rows.length - 1]!, scale: 1 + (i - rows.length + 1) * 0.5 };
      return null;
    };
    const go = sig?.inputs.next === true || ctx.runtime.scratch.get('wave-next') === true || ctx.events.of('wave-next').length > 0;
    ctx.runtime.scratch.delete('wave-next');
    const begin = (): void => {
      const next = rowFor(st.index + 1);
      if (!next) {
        st.phase = 'done';
        ctx.events.emit('waves-done', {});
        return;
      }
      st.index++;
      st.left = Math.max(1, Math.round(Number(next.row.count ?? 1) * next.scale));
      st.timer = Number(next.row.delay ?? 0);
      st.phase = 'spawning';
      ctx.events.emit('wave-started', { index: st.index + 1, count: st.left });
    };
    if (st.phase === 'idle' && go) begin();
    else if (st.phase === 'resting') {
      st.timer -= ctx.dt;
      vars['wave.countdown'] = Math.max(0, Math.ceil(st.timer));
      if (st.timer <= 0 || go) begin();
    } else if (st.phase === 'spawning') {
      const cur = rowFor(st.index);
      if (!cur) return;
      st.timer -= ctx.dt;
      if (st.timer <= 0 && st.left > 0) {
        const t = e.require<TransformIso>(C.Transform);
        const made = spawnPrefabAt(ctx, e, String(cur.row.prefab ?? ''), t.x, t.y, t.h, `wave${st.index}-${st.left}`);
        if (made) {
          const tag = String(cur.row.tag ?? '');
          if (tag) made.tags.add(tag);
          made.tags.add('wave-enemy');
          st.spawned.push(made.id);
        }
        st.left--;
        st.timer = Number(cur.row.gap ?? 1);
      }
      if (st.left <= 0) st.phase = 'fighting';
    } else if (st.phase === 'fighting' && st.spawned.length === 0) {
      ctx.events.emit('wave-cleared', { index: st.index + 1 });
      if (sig) sig.outputs.cleared = true;
      st.phase = 'resting';
      st.timer = s.rest;
      if (!rowFor(st.index + 1)) {
        st.phase = 'done';
        ctx.events.emit('waves-done', {});
      }
    }
  },
});

// ---------- following a route ----------

export interface PathFollower {
  /** Points to walk through ("x,y; x,y; ...") (use this or the tag below). */
  points: string;
  /** Or: objects with this tag, in the order of the number at the end of their names ("Waypoint 1", "Waypoint 2"...). */
  routeTag: string;
  speed: number;
  /** Take itself out of the game on reaching the end. */
  removeAtEnd: boolean;
}

function routeOf(ctx: SimContext, s: PathFollower): { x: number; y: number }[] {
  if (s.routeTag) {
    const cached = ctx.runtime.scratch.get(`route:${s.routeTag}`) as { n: number; pts: { x: number; y: number }[] } | undefined;
    const marks = ctx.world.withTag(s.routeTag);
    if (cached && cached.n === marks.length) return cached.pts;
    const pts = marks
      .map((m) => ({ n: Number(/(\d+)$/.exec(m.name)?.[1] ?? 0), t: m.require<TransformIso>(C.Transform) }))
      .sort((a, b) => a.n - b.n)
      .map((m) => ({ x: m.t.x, y: m.t.y }));
    ctx.runtime.scratch.set(`route:${s.routeTag}`, { n: marks.length, pts });
    return pts;
  }
  return s.points
    .split(';')
    .map((p) => p.split(',').map((v) => Number(v.trim())))
    .filter((p) => p.length === 2 && p.every(Number.isFinite))
    .map((p) => ({ x: p[0]!, y: p[1]! }));
}

export const pathFollower = behaviorDef<PathFollower>({
  id: 'pathFollower',
  name: 'Path Follower',
  category: 'Simulation',
  description: 'Walks a fixed route from point to point and, at the end, announces "path-end" (and removes itself if asked). Tower-defence enemies, trains, conveyor items. The route is a list of points, or objects with a tag numbered "Waypoint 1", "Waypoint 2"...',
  phase: 'control',
  timing: 'realtime',
  defaults: { points: '', routeTag: 'route', speed: 2, removeAtEnd: false },
  fields: [
    { key: 'points', label: 'Points (x,y; x,y; ...)', type: 'text' },
    { key: 'routeTag', label: 'Or the tag of the waypoint objects', type: 'text' },
    { key: 'speed', label: 'Speed (cells per second)', type: 'number', min: 0.1, step: 0.5 },
    { key: 'removeAtEnd', label: 'Remove itself at the end', type: 'boolean' },
  ],
  inputs: [],
  outputs: [{ name: 'arrived', label: 'Reached the end' }],
  requires: { body: { vx: 0, vy: 0, vz: 0, radius: 0.25, height: 1, state: 'ground', stepUp: 0.6, stepDown: 1, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false } },
  update(ctx, e, s) {
    const st = stateOf<{ i: number; done: boolean }>(e, 'follow', () => ({ i: 0, done: false }));
    const b = e.get<Body>(C.Body);
    const t = e.require<TransformIso>(C.Transform);
    if (st.done) {
      if (b) b.vx = b.vy = 0;
      return;
    }
    const route = routeOf(ctx, s);
    if (route.length === 0) return;
    let target = route[Math.min(st.i, route.length - 1)]!;
    while (Math.hypot(target.x - t.x, target.y - t.y) < 0.25 && st.i < route.length - 1) {
      st.i++;
      target = route[st.i]!;
    }
    if (st.i >= route.length - 1 && Math.hypot(target.x - t.x, target.y - t.y) < 0.25) {
      st.done = true;
      if (b) b.vx = b.vy = 0;
      const sig = e.get<{ outputs: Record<string, boolean> }>('signals');
      if (sig) sig.outputs.arrived = true;
      ctx.events.emit('path-end', { entity: e.id, name: e.name });
      if (s.removeAtEnd) ctx.world.destroy(e);
      return;
    }
    const dx = target.x - t.x;
    const dy = target.y - t.y;
    const len = Math.hypot(dx, dy) || 1;
    if (b) {
      b.vx = (dx / len) * s.speed;
      b.vy = (dy / len) * s.speed;
    } else {
      t.x += (dx / len) * s.speed * ctx.dt;
      t.y += (dy / len) * s.speed * ctx.dt;
    }
  },
});

// ---------- needs and utility AI ----------

export interface UtilityAgent {
  /** The data table of activities (see below). */
  table: string;
  /** Needs and how fast they fall, "hunger:0.8, energy:0.5" (per second, on a scale of 0-100; they start full). */
  needs: string;
  speed: number;
}

interface AgentState {
  needs: Record<string, number>;
  activity: string;
  phase: 'choosing' | 'walking' | 'doing';
  left: number;
  target: number;
  nav: NavState;
  think: number;
}

const NIGHT = 'time.night';

export const utilityAgent = behaviorDef<UtilityAgent>({
  id: 'utilityAgent',
  name: 'Utility Agent (needs)',
  category: 'Simulation',
  description: 'A villager that decides what to do from its needs. It has needs that fall over time (hunger, energy...). A data table lists activities: which need one satisfies, how much it restores per second, which tagged object to walk to (a farm, a bed, a workplace), how long it takes, when it can be done (any time, day, night), how much the character wants it anyway, and a resource it makes. Each time it is free it scores every activity (the weight, plus how badly it needs it, minus the walk) and does the best one it can reach. Table columns: id, need, gain, target, seconds, weight, when, makes.',
  phase: 'brain',
  timing: 'realtime',
  defaults: { table: 'Activities', needs: 'hunger:1, energy:0.6', speed: 3 },
  fields: [
    { key: 'table', label: 'Table of activities', type: 'text' },
    { key: 'needs', label: 'Needs (name:fall per second, ...)', type: 'text' },
    { key: 'speed', label: 'Walking speed (cells per second)', type: 'number', min: 0.5, step: 0.5 },
  ],
  inputs: [],
  outputs: [],
  requires: { body: { vx: 0, vy: 0, vz: 0, radius: 0.25, height: 1, state: 'ground', stepUp: 0.6, stepDown: 1, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false } },
  update(ctx, e, s) {
    const decay = Object.fromEntries(parseCosts(s.needs));
    const st = stateOf<AgentState>(e, 'agent', () => ({ needs: Object.fromEntries(Object.keys(decay).map((n) => [n, 100])), activity: '', phase: 'choosing', left: 0, target: -1, nav: newNav(), think: 0 }));
    for (const [n, d] of Object.entries(decay)) st.needs[n] = Math.max(0, (st.needs[n] ?? 100) - d * ctx.dt);
    const rows = ctx.assets.tables.get(s.table)?.rows ?? [];
    const b = e.get<Body>(C.Body);
    const t = e.require<TransformIso>(C.Transform);
    const night = ctx.runtime.vars[NIGHT] === true;
    const row = (id: string): TableRow | undefined => rows.find((r) => r.id === id);
    if (st.phase === 'doing') {
      const r = row(st.activity);
      if (b) b.vx = b.vy = 0;
      if (r) {
        const need = String(r.need ?? '');
        if (need) st.needs[need] = Math.min(100, (st.needs[need] ?? 0) + Number(r.gain ?? 0) * ctx.dt);
      }
      st.left -= ctx.dt;
      if (st.left <= 0) {
        if (r?.makes) earn(ctx.runtime.vars, String(r.makes));
        ctx.events.emit('activity-done', { entity: e.id, activity: st.activity });
        st.phase = 'choosing';
        st.activity = '';
      }
      return;
    }
    if (st.phase === 'walking') {
      const target = ctx.world.get(st.target);
      if (!target || !target.alive) {
        st.phase = 'choosing';
        return;
      }
      const tt = target.require<TransformIso>(C.Transform);
      if (Math.hypot(tt.x - t.x, tt.y - t.y) < 1.4) {
        st.phase = 'doing';
        st.left = Number(row(st.activity)?.seconds ?? 3);
        if (b) b.vx = b.vy = 0;
        return;
      }
      const r = steerTo(ctx, e, { x: tt.x, y: tt.y }, s.speed, st.nav, 1.2);
      if (r === 'stuck') st.phase = 'choosing';
      return;
    }
    // choosing: a fresh look every half second
    st.think -= ctx.dt;
    if (st.think > 0) return;
    st.think = 0.5;
    let best: { id: string; score: number; target: Entity } | null = null;
    for (const r of rows) {
      const when = String(r.when ?? 'any');
      if ((when === 'night' && !night) || (when === 'day' && night)) continue;
      const tag = String(r.target ?? '');
      let target: Entity | null = null;
      let dist = 0;
      if (tag) {
        for (const o of ctx.world.withTag(tag)) {
          const d = Math.hypot(o.require<TransformIso>(C.Transform).x - t.x, o.require<TransformIso>(C.Transform).y - t.y);
          if (!target || d < dist) {
            target = o;
            dist = d;
          }
        }
        if (!target) continue; // nothing of that kind to go to
      } else target = e;
      const need = String(r.need ?? '');
      const urgency = need ? 100 - (st.needs[need] ?? 100) : 0;
      const score = Number(r.weight ?? 0) + urgency - dist * 0.5;
      if (!best || score > best.score) best = { id: r.id, score, target };
    }
    if (!best || best.score <= 0) return;
    st.activity = best.id;
    st.target = best.target.id;
    st.nav = newNav();
    st.phase = best.target === e ? 'doing' : 'walking';
    if (st.phase === 'doing') st.left = Number(row(best.id)?.seconds ?? 3);
    ctx.events.emit('activity-chosen', { entity: e.id, activity: best.id });
  },
});

// ---------- cellular automata on the map ----------

export interface Automaton {
  /** The data table of rules: columns from, to (tile ids), near (a tile id, or 0), min (how many neighbours of it), chance (percent per step). */
  table: string;
  /** Seconds between steps. */
  every: number;
  /** Count the eight neighbours (otherwise the four that share an edge). */
  diagonal: boolean;
}

export const automaton = behaviorDef<Automaton>({
  id: 'automaton',
  name: 'Cellular Automaton',
  category: 'Simulation',
  description: 'Rules that change the map itself over time: every step each tile may turn into another when enough of its neighbours are a certain tile (grass catches fire next to fire; fire dies out; crops grow; water spreads). A data table lists the rules: from, to, near, min, chance. All the cells change at once, with the game\'s seeded random numbers, so a replay is identical. Put it on any object.',
  phase: 'actuator',
  timing: 'realtime',
  defaults: { table: 'Automata', every: 0.5, diagonal: false },
  fields: [
    { key: 'table', label: 'Table of rules', type: 'text' },
    { key: 'every', label: 'Seconds between steps', type: 'number', min: 0.05, step: 0.05 },
    { key: 'diagonal', label: 'Count diagonal neighbours too', type: 'boolean' },
  ],
  inputs: [],
  outputs: [],
  requires: {},
  update(ctx, e, s) {
    const map = ctx.map;
    const rules = ctx.assets.tables.get(s.table)?.rows ?? [];
    if (!map || rules.length === 0) return;
    const st = stateOf<{ t: number }>(e, 'automaton', () => ({ t: 0 }));
    st.t += ctx.dt;
    if (st.t < s.every) return;
    st.t = 0;
    const dirs: [number, number][] = s.diagonal ? [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]] : [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const changes: { x: number; y: number; to: number }[] = [];
    for (let y = 0; y < map.height; y++) {
      for (let x = 0; x < map.width; x++) {
        const tile = map.getTile(x, y);
        for (const r of rules) {
          if (Number(r.from) !== tile) continue;
          const near = Number(r.near ?? 0);
          if (near > 0) {
            let n = 0;
            for (const [dx, dy] of dirs) if (map.getTile(x + dx, y + dy) === near) n++;
            if (n < Math.max(1, Number(r.min ?? 1))) continue;
          }
          const chance = Number(r.chance ?? 100);
          if (chance < 100 && ctx.rng.next() * 100 >= chance) continue;
          changes.push({ x, y, to: Number(r.to) });
          break;
        }
      }
    }
    for (const c of changes) {
      map.tiles[c.y * map.width + c.x] = c.to;
      markDirty(ctx, c.x, c.y);
    }
    if (changes.length > 0) ctx.events.emit('tiles-changed', { count: changes.length });
  },
});

/** Tell the game host that a map cell changed, so it can be drawn again. */
export function markDirty(ctx: SimContext, x: number, y: number): void {
  let list = ctx.runtime.scratch.get('dirtyCells') as { x: number; y: number }[] | undefined;
  if (!list) ctx.runtime.scratch.set('dirtyCells', (list = []));
  if (list.length < 20000) list.push({ x, y });
}

