import type { Scroller, Simulation, VariableValue } from '@tilewright/runtime';
import { runActionList } from '../events/sheet';
import { contextOf } from '../story/context';

/**
 * Scrolling for any panel, list or grid, with no drawing in it: the numbers (where the content is, how far it may go, where a
 * focused widget has to be to be in view, what a held button does), the state each scroller keeps, and what it tells the rest
 * of the game (values for bindings, events, actions). The game draws it (screens-dom.ts); the tests and the playbot read it.
 *
 * Positions are in pixels along the scroller's own axes: offset 0 shows the start of the content.
 */

export interface Axis {
  /** Where it is, where it is going, and how fast it was moving when the player let go. */
  o: number;
  t: number;
  v: number;
}

/** What the screen measured of one scroller (the drawing fills this in every frame; a test sets it by hand). */
export interface ScrollMetrics {
  viewW: number;
  viewH: number;
  contentW: number;
  contentH: number;
  /** Where each widget inside is, in content pixels: [left, top, right, bottom]. */
  items: Record<string, [number, number, number, number]>;
  /** The size of a row (the first row's) along the scroll direction, 0 when not known. */
  row: number;
}

export interface Hold {
  /** Seconds the button has been down, and the second it next repeats at. */
  held: number;
  next: number;
}

export interface ScrollState {
  x: Axis;
  y: Axis;
  metrics: ScrollMetrics;
  holds: Record<string, Hold>;
  /** The last values reported, so a change is reported once. */
  last: { pos: string; top: boolean; bottom: boolean; bottomPinned: boolean; contentLen: number };
  /** Tick of the last time it moved (for a bar that shows only while scrolling). */
  movedAt: number;
  dragging: boolean;
}

const EMPTY_METRICS = (): ScrollMetrics => ({ viewW: 0, viewH: 0, contentW: 0, contentH: 0, items: {}, row: 0 });
const newAxis = (): Axis => ({ o: 0, t: 0, v: 0 });

const STATES = 'ui.scrollers';

export function scrollStates(sim: Simulation): Map<string, ScrollState> {
  let m = sim.runtime.scratch.get(STATES) as Map<string, ScrollState> | undefined;
  if (!m) {
    m = new Map();
    sim.runtime.scratch.set(STATES, m);
  }
  return m;
}

export function scrollState(sim: Simulation, key: string): ScrollState {
  const all = scrollStates(sim);
  let s = all.get(key);
  if (!s) {
    s = { x: newAxis(), y: newAxis(), metrics: EMPTY_METRICS(), holds: {}, last: { pos: '', top: true, bottom: false, bottomPinned: false, contentLen: 0 }, movedAt: -1e9, dragging: false };
    all.set(key, s);
  }
  return s;
}

/** The scroller a widget has with the engine's own scrolling on: its own settings, or the plain one a panel set to "scroll" gets. */
export const DEFAULT_SCROLLER: Scroller = {
  dir: 'vertical',
  padStart: 0,
  padEnd: 0,
  limit: 0,
  snap: 'none',
  snapSize: 0,
  edges: 'stop',
  momentum: false,
  motion: 'smooth',
  speed: 1,
  follow: 'nearest',
  margin: 1,
  actions: { up: 'ui_scroll_up', down: 'ui_scroll_down', left: 'ui_scroll_left', right: 'ui_scroll_right', pageUp: 'ui_page_up', pageDown: 'ui_page_down' },
  holdDelay: 0.4,
  holdRate: 12,
  holdAccel: 1.5,
  wheel: true,
  drag: true,
  stick: 'none',
  auto: 0,
  autoLoop: false,
  lazy: false,
  rowSize: 0,
  bind: '',
  on: { scrolled: [], top: [], bottom: [] },
};

export function scrollerOf(node: { scroller?: Scroller | undefined; style: { scroll?: boolean | undefined } }, on: boolean): Scroller | null {
  if (!on) return null;
  if (node.scroller) return node.scroller;
  return node.style.scroll ? DEFAULT_SCROLLER : null;
}

// ---------- the numbers ----------

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** The lowest and highest offset along one axis. */
export function offsetRange(s: Scroller, contentLen: number, viewLen: number): { min: number; max: number } {
  const room = Math.max(0, contentLen - viewLen);
  const max = (s.limit > 0 ? Math.min(room, s.limit) : room) + (room > 0 || s.padEnd > 0 ? s.padEnd : 0);
  return { min: s.padStart > 0 ? -s.padStart : 0, max: Math.max(0, max) };
}

/** Where to scroll so that a widget between `start` and `end` is in view, by the follow rule. */
export function followOffset(mode: Scroller['follow'], start: number, end: number, offset: number, viewLen: number, rowLen: number, margin: number): number {
  if (mode === 'none') return offset;
  const size = end - start;
  if (mode === 'center') return start + size / 2 - viewLen / 2;
  if (mode === 'page') {
    const page = Math.max(1, viewLen);
    const inView = start >= offset && end <= offset + viewLen;
    return inView ? offset : Math.floor(start / page) * page;
  }
  const m = mode === 'margin' ? Math.max(0, margin) * Math.max(rowLen, size) : 0;
  // an item taller than the view shows its start
  if (size + 2 * m > viewLen) return start - m;
  if (start - m < offset) return start - m;
  if (end + m > offset + viewLen) return end + m - viewLen;
  return offset;
}

/** The nearest place the offset sticks to under the snap setting. */
export function snapOffset(s: Scroller, offset: number, viewLen: number, rowLen: number): number {
  const unit = s.snap === 'rows' ? rowLen : s.snap === 'pages' ? viewLen : s.snap === 'grid' ? s.snapSize : 0;
  if (unit <= 0) return offset;
  return Math.round(offset / unit) * unit;
}

/** The rows that are in view (first and how many), and how many are out of view each way, for a column of equal rows. */
export function visibleRows(offset: number, viewLen: number, rowLen: number, count: number): { first: number; rows: number; before: number; after: number } {
  if (rowLen <= 0 || count <= 0) return { first: 0, rows: count, before: 0, after: 0 };
  const first = clamp(Math.floor((offset + 1) / rowLen), 0, count);
  const last = clamp(Math.ceil((offset + viewLen - 1) / rowLen), 0, count);
  return { first, rows: Math.max(0, last - first), before: first, after: Math.max(0, count - last) };
}

/** Rows to make when only the ones in view (and a few either side) are made: from (included) to (excluded). */
export function lazyWindow(offset: number, viewLen: number, rowLen: number, count: number, buffer = 2): { from: number; to: number } {
  if (rowLen <= 0) return { from: 0, to: count };
  const from = clamp(Math.floor(offset / rowLen) - buffer, 0, count);
  const to = clamp(Math.ceil((offset + viewLen) / rowLen) + buffer, from, count);
  return { from, to };
}

/** Where the thumb sits on a track: start and length as fractions of the track. */
export function thumbOf(offset: number, range: { min: number; max: number }, viewLen: number, contentLen: number, mode: 'visible' | 'fixed', fixedPx: number, trackPx: number): { start: number; len: number } {
  const total = Math.max(1, contentLen);
  const len = clamp(mode === 'fixed' ? fixedPx / Math.max(1, trackPx) : viewLen / total, 0.04, 1);
  const span = range.max - range.min;
  const at = span <= 0 ? 0 : clamp((offset - range.min) / span, 0, 1);
  return { start: at * (1 - len), len };
}

/**
 * A button held down: how many times it acts this tick. It acts once on the tick it goes down, again after `delay` seconds, then
 * `rate` times a second, which grows by `accel` for every second it stays down past the delay.
 */
export function holdSteps(h: Hold, down: boolean, dt: number, delay: number, rate: number, accel: number): number {
  if (!down) {
    h.held = 0;
    h.next = 0;
    return 0;
  }
  let n = 0;
  if (h.held === 0) {
    n = 1;
    h.next = delay;
  }
  h.held += dt;
  while (h.held >= h.next && n < 8) {
    n++;
    const sinceDelay = Math.max(0, h.held - delay);
    h.next += 1 / Math.min(60, rate * Math.pow(Math.max(1, accel), sinceDelay));
  }
  return n;
}

// ---------- moving ----------

/** Make the scroller go to an offset (clamped, and stuck to the snap setting), at once or by easing. */
export function scrollTo(s: Scroller, st: ScrollState, axis: 'x' | 'y', offset: number, instant = false): void {
  const m = st.metrics;
  const view = axis === 'y' ? m.viewH : m.viewW;
  const content = axis === 'y' ? m.contentH : m.contentW;
  const r = offsetRange(s, content, view);
  const a = st[axis];
  a.t = clamp(snapOffset(s, offset, view, m.row), r.min, r.max);
  a.v = 0;
  if (instant || s.motion === 'instant') a.o = a.t;
}

/** Move by an amount from where it is going. */
export function scrollBy(s: Scroller, st: ScrollState, axis: 'x' | 'y', delta: number, instant = false): void {
  scrollTo(s, st, axis, st[axis].t + delta, instant);
}

/** Which axes the scroller scrolls along. */
export const axesOf = (s: Scroller): ('x' | 'y')[] => (s.dir === 'both' ? ['y', 'x'] : s.dir === 'horizontal' ? ['x'] : ['y']);

/** Can it move along this axis at all? */
export function canScroll(s: Scroller, st: ScrollState, axis: 'x' | 'y'): boolean {
  if (!axesOf(s).includes(axis)) return false;
  const m = st.metrics;
  const r = offsetRange(s, axis === 'y' ? m.contentH : m.contentW, axis === 'y' ? m.viewH : m.viewW);
  return r.max > r.min;
}

/** The player lets go of a drag at a speed (pixels a second): with momentum it carries on, otherwise it stops and settles on a snap point. */
export function releaseDrag(s: Scroller, st: ScrollState, axis: 'x' | 'y', speed: number): void {
  st.dragging = false;
  const a = st[axis];
  scrollTo(s, st, axis, s.momentum ? a.o + speed * 0.3 * s.speed : a.o);
}

/** Dragging the content: follows the pointer one to one inside the limits, and stretches at the ends when the edges are elastic. */
export function dragTo(s: Scroller, st: ScrollState, axis: 'x' | 'y', offset: number): void {
  st.dragging = true;
  const m = st.metrics;
  const r = offsetRange(s, axis === 'y' ? m.contentH : m.contentW, axis === 'y' ? m.viewH : m.viewW);
  const a = st[axis];
  if (s.edges === 'elastic') {
    const over = offset < r.min ? offset - r.min : offset > r.max ? offset - r.max : 0;
    a.o = over === 0 ? offset : (over < 0 ? r.min : r.max) + over * 0.4;
  } else a.o = clamp(offset, r.min, r.max);
  a.t = a.o;
}

/** Ease the offset toward where it is going. `ms` is the length of the step. */
function approach(s: Scroller, a: Axis, r: { min: number; max: number }, dt: number, reduce: boolean): void {
  if (s.motion === 'instant' || reduce) {
    a.o = a.t;
    return;
  }
  const d = a.t - a.o;
  if (Math.abs(d) < 0.4) a.o = a.t;
  else a.o += d * (1 - Math.exp(-dt * 16));
  if (s.edges === 'stop') a.o = clamp(a.o, r.min, r.max);
}

// ---------- values the rest of the game reads ----------

export interface ScrollValues {
  /** 0 to 1 along the main axis. */
  pos: number;
  /** The first row in view (from 1), how many rows are in view, how many are out of view before and after, and the number of rows. */
  row: number;
  rows: number;
  hidden_before: number;
  hidden_after: number;
  count: number;
  top: 0 | 1;
  bottom: 0 | 1;
  /** Pages: the one in view (from 1) and how many there are. */
  page: number;
  pages: number;
  /** The offset in pixels and how far it can go. */
  offset: number;
  max: number;
}

export function mainAxis(s: Scroller): 'x' | 'y' {
  return s.dir === 'horizontal' ? 'x' : 'y';
}

export function scrollValues(s: Scroller, st: ScrollState, count: number): ScrollValues {
  const axis = mainAxis(s);
  const m = st.metrics;
  const view = axis === 'y' ? m.viewH : m.viewW;
  const content = axis === 'y' ? m.contentH : m.contentW;
  const r = offsetRange(s, content, view);
  const o = st[axis].o;
  const span = r.max - r.min;
  const vis = visibleRows(o, view, m.row, count);
  const pages = view > 0 ? Math.max(1, Math.ceil(content / view)) : 1;
  return {
    pos: span <= 0 ? 0 : clamp((o - r.min) / span, 0, 1),
    row: vis.first + 1,
    rows: vis.rows,
    hidden_before: vis.before,
    hidden_after: vis.after,
    count,
    top: o <= r.min + 0.5 ? 1 : 0,
    bottom: o >= r.max - 0.5 ? 1 : 0,
    page: view > 0 ? clamp(Math.floor((o + 1) / view) + 1, 1, pages) : 1,
    pages,
    offset: Math.round(o),
    max: Math.round(r.max),
  };
}

export const scrollScope = (v: ScrollValues): Record<string, VariableValue> => ({
  'scroll.pos': v.pos,
  'scroll.row': v.row,
  'scroll.rows': v.rows,
  'scroll.hidden_before': v.hidden_before,
  'scroll.hidden_after': v.hidden_after,
  'scroll.count': v.count,
  'scroll.top': v.top,
  'scroll.bottom': v.bottom,
  'scroll.page': v.page,
  'scroll.pages': v.pages,
});

// ---------- once a tick ----------

export interface ScrollDrive {
  /** How many rows the scroller repeats (for values in rows). */
  count: number;
  /** Is this the scroller the buttons act on? */
  inputs: boolean;
  /** Seconds this step lasts. */
  dt?: number;
  reduceMotion?: boolean;
}

/**
 * One tick of one scroller: the mapped buttons, a self-scrolling roll, staying at the end, easing, and telling the game what changed
 * (the bound variables, the event, the actions). Returns the values.
 */
export function driveScroller(sim: Simulation, key: string, s: Scroller, d: ScrollDrive): ScrollValues {
  const st = scrollState(sim, key);
  const dt = d.dt ?? 1 / 60;
  const m = st.metrics;
  const axes = axesOf(s);
  const main = mainAxis(s);
  const ui = sim.uiInput;
  const reduce = d.reduceMotion === true;
  if (d.inputs) {
    const row = m.row > 0 ? m.row : 40;
    const table: [keyof Scroller['actions'], 'x' | 'y', number][] = [
      ['up', 'y', -1],
      ['down', 'y', 1],
      ['left', 'x', -1],
      ['right', 'x', 1],
      ['pageUp', main, -1],
      ['pageDown', main, 1],
    ];
    for (const [name, axis, sign] of table) {
      if (!axes.includes(axis)) continue;
      const action = s.actions[name];
      const h = (st.holds[name] ??= { held: 0, next: 0 });
      const n = holdSteps(h, ui.down(action), dt, s.holdDelay, s.holdRate, s.holdAccel);
      if (n === 0) continue;
      const view = axis === 'y' ? m.viewH : m.viewW;
      const step = name === 'pageUp' || name === 'pageDown' ? Math.max(row, view - row) : row;
      for (let i = 0; i < n; i++) scrollBy(s, st, axis, sign * step * s.speed);
    }
  }
  const content = main === 'y' ? m.contentH : m.contentW;
  const view = main === 'y' ? m.viewH : m.viewW;
  // a roll that scrolls by itself
  if (s.auto > 0 && !st.dragging) {
    const r = offsetRange(s, content, view);
    const next = st[main].t + s.auto * dt;
    if (next > r.max && r.max > r.min) scrollTo(s, st, main, s.autoLoop ? r.min : r.max, s.autoLoop);
    else {
      st[main].t = Math.min(next, r.max);
      st[main].o = st[main].t;
    }
  }
  // staying at the end (a chat log) or at the start when the content grows
  if (s.stick !== 'none' && content !== st.last.contentLen && st.last.contentLen > 0) {
    const r = offsetRange(s, content, view);
    if (s.stick === 'end' && st.last.bottomPinned) scrollTo(s, st, main, r.max);
    if (s.stick === 'start' && st.last.top) scrollTo(s, st, main, r.min);
  }
  for (const axis of axes) {
    const a = st[axis];
    const view2 = axis === 'y' ? m.viewH : m.viewW;
    const content2 = axis === 'y' ? m.contentH : m.contentW;
    const r = offsetRange(s, content2, view2);
    if (!st.dragging) {
      const before = a.o;
      if (s.edges === 'stop') a.t = clamp(a.t, r.min, r.max);
      approach(s, a, r, dt, reduce);
      if (Math.abs(a.o - before) > 0.01) st.movedAt = sim.tick;
    }
  }
  const v = scrollValues(s, st, d.count);
  const pos = `${v.offset}|${v.row}|${v.rows}`;
  const moved = pos !== st.last.pos;
  const hadPos = st.last.pos !== '';
  st.last.pos = pos;
  st.last.contentLen = content;
  st.last.bottomPinned = v.bottom === 1;
  if (moved) st.movedAt = sim.tick;
  if (s.bind) {
    const vars = sim.runtime.vars;
    vars[s.bind] = Math.round(v.pos * 1000) / 1000;
    vars[`${s.bind}.row`] = v.row;
    vars[`${s.bind}.rows`] = v.rows;
    vars[`${s.bind}.top`] = v.top;
    vars[`${s.bind}.bottom`] = v.bottom;
  }
  if (moved && hadPos) {
    sim.events.emit('ui-scrolled', { widget: key, pos: v.pos, row: v.row, rows: v.rows });
    runList(sim, s.on.scrolled, v);
  }
  if (v.top === 1 && !st.last.top && hadPos) {
    sim.events.emit('ui-scroll-top', { widget: key });
    runList(sim, s.on.top, v);
  }
  if (v.bottom === 1 && !st.last.bottom && hadPos) {
    sim.events.emit('ui-scroll-bottom', { widget: key });
    runList(sim, s.on.bottom, v);
  }
  st.last.top = v.top === 1;
  st.last.bottom = v.bottom === 1;
  return v;
}

function runList(sim: Simulation, actions: Scroller['on']['scrolled'], v: ScrollValues): void {
  if (actions.length === 0) return;
  const vars = sim.runtime.vars;
  const scope = scrollScope(v);
  const before = Object.keys(scope).map((k) => [k, vars[k]] as const);
  Object.assign(vars, scope);
  try {
    runActionList(contextOf(sim), actions as never);
  } finally {
    for (const [k, old] of before) {
      if (old === undefined) delete vars[k];
      else vars[k] = old;
    }
  }
}

// ---------- the focus follows ----------

/**
 * The focus moved to a widget inside scrollers: every scroller around it (the nearest first) brings it into view by its own follow
 * rule. `chain` is the scrollers' keys from the widget outward, with each one's settings. Nested scrollers work out their part in turn,
 * the outer ones seeing the inner scroller's box as the thing to bring into view.
 */
export function bringIntoView(sim: Simulation, itemKey: string, chain: { key: string; scroller: Scroller }[]): void {
  let target = itemKey;
  for (const { key, scroller } of chain) {
    const st = scrollState(sim, key);
    const r = st.metrics.items[target];
    if (r) {
      for (const axis of axesOf(scroller)) {
        const start = axis === 'y' ? r[1] : r[0];
        const end = axis === 'y' ? r[3] : r[2];
        const view = axis === 'y' ? st.metrics.viewH : st.metrics.viewW;
        const row = st.metrics.row || end - start;
        scrollTo(scroller, st, axis, followOffset(scroller.follow, start, end, st[axis].t, view, row, scroller.margin));
      }
    }
    target = key;
  }
}

/** Scroll a scroller to its start or end, to a row (from 1), or to a widget inside it (the actions of Quick Actions and scripts call these). */
export function scrollToEdge(sim: Simulation, key: string, s: Scroller, where: 'top' | 'bottom'): void {
  const st = scrollState(sim, key);
  const main = mainAxis(s);
  const m = st.metrics;
  const r = offsetRange(s, main === 'y' ? m.contentH : m.contentW, main === 'y' ? m.viewH : m.viewW);
  scrollTo(s, st, main, where === 'top' ? r.min : r.max);
}

export function scrollToRow(sim: Simulation, key: string, s: Scroller, row: number): void {
  const st = scrollState(sim, key);
  const unit = st.metrics.row > 0 ? st.metrics.row : 40;
  scrollTo(s, st, mainAxis(s), (Math.max(1, row) - 1) * unit);
}

/**
 * Called every tick with the widget that has the focus: when the focus has just moved, or when the widget moved inside its scroller
 * because rows were added or removed around it, every scroller around it brings it into view again. A player who scrolls the content
 * away with the wheel is left alone (the widget did not move inside the content).
 */
export function followFocus(sim: Simulation, itemKey: string, chain: { key: string; scroller: Scroller }[]): boolean {
  const spot = chain.map((c) => `${c.key}:${(scrollState(sim, c.key).metrics.items[itemKey] ?? []).join(',')}`).join(';');
  const sig = `${itemKey}|${spot}`;
  const had = sim.runtime.scratch.get('ui.focusfollow') as string | undefined;
  if (had === sig) return false;
  sim.runtime.scratch.set('ui.focusfollow', sig);
  bringIntoView(sim, itemKey, chain);
  return true;
}
