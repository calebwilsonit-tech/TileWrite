import { describe, expect, it } from 'vitest';
import { ScrollerSchema, Simulation, UiDocSchema } from '@tilewright/runtime';
import { DEFAULT_SCROLLER, bringIntoView, driveScroller, followFocus, followOffset, holdSteps, lazyWindow, offsetRange, scrollBy, scrollState, scrollTo, scrollToEdge, scrollToRow, scrollValues, scrollerOf, snapOffset, thumbOf, visibleRows } from './scrolling';

const sc = (patch: Record<string, unknown> = {}) => ScrollerSchema.parse(patch);
const game = (): Simulation => {
  const sim = new Simulation(1);
  sim.assets.ui = UiDocSchema.parse({});
  return sim;
};
/** A list of 20 rows of 40 pixels in a window of 200. */
const metrics = (sim: Simulation, key: string, rows = 20, view = 200, row = 40): void => {
  const m = scrollState(sim, key).metrics;
  m.viewW = 300;
  m.viewH = view;
  m.contentW = 300;
  m.contentH = rows * row;
  m.row = row;
  m.items = {};
  for (let i = 0; i < rows; i++) m.items[`r${i}`] = [0, i * row, 300, (i + 1) * row];
};

describe('how far a scroller may go', () => {
  it('stops at the ends of the content, leaves room for padding, and obeys a limit', () => {
    expect(offsetRange(sc(), 800, 200)).toEqual({ min: 0, max: 600 });
    expect(offsetRange(sc(), 100, 200)).toEqual({ min: 0, max: 0 });
    expect(offsetRange(sc({ padStart: 20, padEnd: 30 }), 800, 200)).toEqual({ min: -20, max: 630 });
    expect(offsetRange(sc({ limit: 300 }), 800, 200)).toEqual({ min: 0, max: 300 });
  });

  it('a panel set to scroll gets the engine scroller only when the project has the flag', () => {
    const node = { style: { scroll: true } };
    expect(scrollerOf(node, false)).toBeNull();
    expect(scrollerOf(node, true)).toBe(DEFAULT_SCROLLER);
    expect(scrollerOf({ style: {} }, true)).toBeNull();
    const own = sc({ dir: 'horizontal' });
    expect(scrollerOf({ scroller: own, style: {} }, true)).toBe(own);
  });
});

describe('the focus follows: every setting', () => {
  // a window 200 tall showing offset 100..300, rows of 40
  const at = (mode: 'nearest' | 'center' | 'margin' | 'page' | 'none', start: number, offset = 100, margin = 1): number => followOffset(mode, start, start + 40, offset, 200, 40, margin);
  it('"just enough" moves the least that shows the row', () => {
    expect(at('nearest', 160)).toBe(100); // already in view
    expect(at('nearest', 40)).toBe(40); // above: its top at the top
    expect(at('nearest', 360)).toBe(200); // below: its bottom at the bottom
  });
  it('"keep centred" puts the row in the middle', () => {
    expect(at('center', 400)).toBe(320);
  });
  it('"keep a margin of N rows" leaves rows of room', () => {
    expect(at('margin', 120, 100, 1)).toBe(80); // one row of room above it
    expect(at('margin', 240, 100, 1)).toBe(120); // its bottom is 280, one row of room is 320, so the window runs 120 to 320
    expect(at('margin', 200, 100, 2)).toBe(120); // two rows of room below: bottom 240 + 80 = 320
    expect(at('margin', 180, 100, 1)).toBe(100); // already has the room
  });
  it('"page by page" jumps to the page the row is on, and stays when it is in view', () => {
    expect(at('page', 160)).toBe(100);
    expect(at('page', 440)).toBe(400);
    expect(at('page', 20)).toBe(0);
  });
  it('"not at all" never moves', () => {
    expect(at('none', 900)).toBe(100);
  });
  it('a row taller than the window shows its start', () => {
    expect(followOffset('nearest', 500, 900, 0, 200, 40, 0)).toBe(500);
  });
});

describe('snapping, rows in view, long lists, the thumb', () => {
  it('snaps to rows, pages and a grid', () => {
    expect(snapOffset(sc({ snap: 'rows' }), 95, 200, 40)).toBe(80);
    expect(snapOffset(sc({ snap: 'rows' }), 105, 200, 40)).toBe(120);
    expect(snapOffset(sc({ snap: 'pages' }), 290, 200, 40)).toBe(200);
    expect(snapOffset(sc({ snap: 'grid', snapSize: 64 }), 100, 200, 40)).toBe(128);
    expect(snapOffset(sc(), 95, 200, 40)).toBe(95);
  });
  it('counts the rows in view and out of view', () => {
    expect(visibleRows(0, 200, 40, 20)).toEqual({ first: 0, rows: 5, before: 0, after: 15 });
    expect(visibleRows(120, 200, 40, 20)).toEqual({ first: 3, rows: 5, before: 3, after: 12 });
    expect(visibleRows(600, 200, 40, 20)).toEqual({ first: 15, rows: 5, before: 15, after: 0 });
  });
  it('makes only the rows in view, with a few either side', () => {
    expect(lazyWindow(0, 200, 40, 1000)).toEqual({ from: 0, to: 7 });
    expect(lazyWindow(4000, 200, 40, 1000)).toEqual({ from: 98, to: 107 });
    expect(lazyWindow(39000, 200, 40, 1000)).toEqual({ from: 973, to: 982 });
    expect(lazyWindow(39900, 200, 40, 1000)).toEqual({ from: 995, to: 1000 }); // the end of the list
  });
  it('sizes the thumb by what is visible or to a fixed length', () => {
    const r = offsetRange(sc(), 800, 200);
    expect(thumbOf(0, r, 200, 800, 'visible', 40, 200)).toEqual({ start: 0, len: 0.25 });
    const end = thumbOf(600, r, 200, 800, 'visible', 40, 200);
    expect(end.start + end.len).toBeCloseTo(1);
    const mid = thumbOf(300, r, 200, 800, 'fixed', 40, 200);
    expect(mid.len).toBeCloseTo(0.2);
    expect(mid.start).toBeCloseTo(0.4);
  });
});

describe('a held button', () => {
  it('acts at once, waits, then repeats faster the longer it is held', () => {
    const total = (accel: number, seconds: number): number => {
      const hold = { held: 0, next: 0 };
      let n = 0;
      for (let t = 0; t < seconds * 60; t++) n += holdSteps(hold, true, 1 / 60, 0.4, 10, accel);
      return n;
    };
    const h = { held: 0, next: 0 };
    expect(holdSteps(h, true, 1 / 60, 0.4, 10, 1)).toBe(1);
    expect(holdSteps(h, true, 1 / 60, 0.4, 10, 1)).toBe(0); // nothing during the wait
    expect(total(1, 1)).toBeGreaterThanOrEqual(6); // 1 + about 0.6 s at 10 a second
    expect(total(1, 1)).toBeLessThanOrEqual(8);
    expect(total(3, 2)).toBeGreaterThan(total(1, 2) * 1.5); // it speeds up
    expect(holdSteps(h, false, 1 / 60, 0.4, 10, 1)).toBe(0);
    expect(holdSteps(h, true, 1 / 60, 0.4, 10, 1)).toBe(1); // let go and press again: acts at once
  });
});

describe('a scroller, a tick at a time', () => {
  it('a mapped button scrolls a row, holding repeats, and page buttons go a page', () => {
    const sim = game();
    const s = sc({ motion: 'instant' });
    metrics(sim, 'list');
    const press = (name: string, ticks = 1): void => {
      for (let i = 0; i < ticks; i++) {
        sim.uiInput.update({ [name]: 1 });
        driveScroller(sim, 'list', s, { count: 20, inputs: true });
      }
    };
    press('ui_scroll_down');
    expect(scrollState(sim, 'list').y.o).toBe(40);
    press('ui_scroll_down', 60); // held for a second
    expect(scrollState(sim, 'list').y.o).toBeGreaterThan(40 * 6);
    sim.uiInput.update({});
    driveScroller(sim, 'list', s, { count: 20, inputs: true });
    scrollTo(s, scrollState(sim, 'list'), 'y', 0);
    press('ui_page_down');
    expect(scrollState(sim, 'list').y.o).toBe(160); // a page less a row
    // a project that maps its own button
    const own = sc({ motion: 'instant', actions: { up: 'dpad_up', down: 'dpad_down' } });
    sim.uiInput.update({ dpad_up: 1 });
    driveScroller(sim, 'list', own, { count: 20, inputs: true });
    expect(scrollState(sim, 'list').y.o).toBe(120);
  });

  it('does nothing for buttons when it is not the one the buttons act on', () => {
    const sim = game();
    metrics(sim, 'a');
    sim.uiInput.update({ ui_scroll_down: 1 });
    driveScroller(sim, 'a', sc({ motion: 'instant' }), { count: 20, inputs: false });
    expect(scrollState(sim, 'a').y.o).toBe(0);
  });

  it('eases when smooth, stops at the end, and goes at once for Reduce motion', () => {
    const sim = game();
    metrics(sim, 'a');
    const s = sc();
    scrollTo(s, scrollState(sim, 'a'), 'y', 1000);
    expect(scrollState(sim, 'a').y.t).toBe(600);
    driveScroller(sim, 'a', s, { count: 20, inputs: false });
    const first = scrollState(sim, 'a').y.o;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(600);
    for (let i = 0; i < 400; i++) driveScroller(sim, 'a', s, { count: 20, inputs: false });
    expect(scrollState(sim, 'a').y.o).toBe(600);
    scrollTo(s, scrollState(sim, 'a'), 'y', 0);
    driveScroller(sim, 'a', s, { count: 20, inputs: false, reduceMotion: true });
    expect(scrollState(sim, 'a').y.o).toBe(0);
  });

  it('keeps its position, rows and ends in variables and tells the game', () => {
    const sim = game();
    metrics(sim, 'a');
    const s = sc({ motion: 'instant', bind: 'list_pos' });
    const seen: string[] = [];
    sim.events.on('ui-scrolled', () => void seen.push('scrolled'));
    sim.events.on('ui-scroll-bottom', () => void seen.push('bottom'));
    driveScroller(sim, 'a', s, { count: 20, inputs: false });
    expect(sim.runtime.vars['list_pos']).toBe(0);
    expect(sim.runtime.vars['list_pos.top']).toBe(1);
    scrollToEdge(sim, 'a', s, 'bottom');
    driveScroller(sim, 'a', s, { count: 20, inputs: false });
    expect(sim.runtime.vars['list_pos']).toBe(1);
    expect(sim.runtime.vars['list_pos.bottom']).toBe(1);
    expect(sim.runtime.vars['list_pos.row']).toBe(16);
    expect(seen).toEqual(['scrolled', 'bottom']);
    scrollToRow(sim, 'a', s, 4);
    driveScroller(sim, 'a', s, { count: 20, inputs: false });
    expect(scrollValues(s, scrollState(sim, 'a'), 20)).toMatchObject({ row: 4, rows: 5, hidden_before: 3, hidden_after: 12, top: 0, bottom: 0 });
  });

  it('a chat log sticks to the bottom as rows arrive, until the player scrolls up', () => {
    const sim = game();
    metrics(sim, 'chat', 10);
    const s = sc({ motion: 'instant', stick: 'end' });
    scrollToEdge(sim, 'chat', s, 'bottom');
    driveScroller(sim, 'chat', s, { count: 10, inputs: false });
    metrics(sim, 'chat', 11);
    driveScroller(sim, 'chat', s, { count: 11, inputs: false });
    expect(scrollState(sim, 'chat').y.o).toBe(11 * 40 - 200);
    scrollBy(s, scrollState(sim, 'chat'), 'y', -100);
    driveScroller(sim, 'chat', s, { count: 11, inputs: false });
    metrics(sim, 'chat', 12);
    driveScroller(sim, 'chat', s, { count: 12, inputs: false });
    expect(scrollState(sim, 'chat').y.o).toBe(11 * 40 - 200 - 100); // left where the player put it
  });

  it('a credits roll scrolls by itself and starts again when it loops', () => {
    const sim = game();
    metrics(sim, 'roll', 20);
    const s = sc({ auto: 60, autoLoop: true, motion: 'instant' });
    for (let i = 0; i < 60; i++) driveScroller(sim, 'roll', s, { count: 20, inputs: false });
    expect(scrollState(sim, 'roll').y.o).toBeCloseTo(60, 0);
    let looped = false;
    let last = 0;
    for (let i = 0; i < 60 * 12; i++) {
      driveScroller(sim, 'roll', s, { count: 20, inputs: false });
      const o = scrollState(sim, 'roll').y.o;
      if (o < last) looped = true;
      last = o;
    }
    expect(looped).toBe(true);
    const noLoop = sc({ auto: 600, motion: 'instant' });
    metrics(sim, 'once', 20);
    for (let i = 0; i < 600; i++) driveScroller(sim, 'once', noLoop, { count: 20, inputs: false });
    expect(scrollState(sim, 'once').y.o).toBe(600);
  });

  it('a horizontal carousel snaps to its rows and does not scroll across', () => {
    const sim = game();
    Object.assign(scrollState(sim, 'car').metrics, { viewW: 300, viewH: 100, contentW: 1200, contentH: 100, row: 150 });
    const s = sc({ dir: 'horizontal', snap: 'rows', motion: 'instant' });
    scrollBy(s, scrollState(sim, 'car'), 'x', 100);
    expect(scrollState(sim, 'car').x.t).toBe(150);
    sim.uiInput.update({ ui_scroll_right: 1 });
    driveScroller(sim, 'car', s, { count: 8, inputs: true });
    expect(scrollState(sim, 'car').x.o).toBe(300);
    sim.uiInput.update({ ui_scroll_down: 1 });
    driveScroller(sim, 'car', s, { count: 8, inputs: true });
    expect(scrollState(sim, 'car').y.o).toBe(0);
  });
});

describe('nested scrollers and rows that come and go', () => {
  it('brings a widget into view in the inner scroller, then the inner scroller into the outer one', () => {
    const sim = game();
    const inner = sc({ motion: 'instant' });
    const outer = sc({ motion: 'instant', follow: 'center' });
    // the outer one: 1000 tall in 400; the inner one sits at 500..700 of it and shows 200 of its 800
    Object.assign(scrollState(sim, 'outer').metrics, { viewW: 300, viewH: 400, contentW: 300, contentH: 1000, row: 100, items: { inner: [0, 500, 300, 700], other: [0, 0, 300, 100] } });
    Object.assign(scrollState(sim, 'inner').metrics, { viewW: 300, viewH: 200, contentW: 300, contentH: 800, row: 40, items: { deep: [0, 520, 300, 560] } });
    bringIntoView(sim, 'deep', [{ key: 'inner', scroller: inner }, { key: 'outer', scroller: outer }]);
    expect(scrollState(sim, 'inner').y.t).toBe(360); // nearest: the row's bottom at the bottom of the window
    expect(scrollState(sim, 'outer').y.t).toBe(400); // centred: the inner box's middle (600) at the window's middle
  });

  it('keeps a focused row in view when rows are added above it, and leaves a scrolled-away list alone', () => {
    const sim = game();
    const s = sc({ motion: 'instant' });
    metrics(sim, 'l');
    const chain = [{ key: 'l', scroller: s }];
    expect(followFocus(sim, 'r10', chain)).toBe(true);
    expect(scrollState(sim, 'l').y.t).toBe(240); // 10 * 40 + 40 - 200
    expect(followFocus(sim, 'r10', chain)).toBe(false); // nothing moved
    scrollTo(s, scrollState(sim, 'l'), 'y', 0); // the player wheels away
    expect(followFocus(sim, 'r10', chain)).toBe(false);
    expect(scrollState(sim, 'l').y.t).toBe(0);
    // two rows turn up above it: it is now at 12 * 40
    scrollState(sim, 'l').metrics.items['r10'] = [0, 480, 300, 520];
    expect(followFocus(sim, 'r10', chain)).toBe(true);
    expect(scrollState(sim, 'l').y.t).toBe(320);
  });
});
