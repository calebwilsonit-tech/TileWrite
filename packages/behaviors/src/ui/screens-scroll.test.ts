import { describe, expect, it } from 'vitest';
import { Simulation, UiDocSchema, currentFlags, legacyFlags, newWidget, openScreen, type CompatFlags, type UiNode, type UiScreen } from '@tilewright/runtime';
import { activateWidget, findOnScreens, rowsOf, type ViewNode } from './screens-logic';
import { scrollState, scrollTo } from './scrolling';
import { ScrollerSchema } from '@tilewright/runtime';

let n = 0;
const w = (type: Parameters<typeof newWidget>[0], patch: Partial<UiNode> = {}): UiNode => ({ ...newWidget(type, `w${++n}`), ...patch }) as UiNode;
const screen = (children: UiNode[]): UiScreen =>
  ({ id: 's', name: 'S', root: w('panel', { name: 'root', anchor: 'fill', layout: 'column', children }), modal: true, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false }) as UiScreen;
const game = (children: UiNode[], flags: CompatFlags = currentFlags(), prefabs: { name: string; widget: UiNode }[] = []): Simulation => {
  const sim = new Simulation(1);
  sim.compat = flags;
  sim.assets.ui = UiDocSchema.parse({ screens: [screen(children)], prefabs });
  openScreen(sim, 'S');
  return sim;
};
const view = (sim: Simulation, name: string): ViewNode => findOnScreens(sim, name)!;
const sc = (patch: Record<string, unknown> = {}) => ScrollerSchema.parse(patch);
const rows = (count: number): UiNode => w('list', { name: 'Rows', source: 'var:n', h: 200, children: [w('button', { name: 'Row', text: 'Row {index}', h: 40 })] });
const withMetrics = (sim: Simulation, key: string, count: number, view = 200, rowH = 40): void => {
  const m = scrollState(sim, key).metrics;
  Object.assign(m, { viewW: 300, viewH: view, contentW: 300, contentH: count * rowH, row: rowH });
};

describe('scrolling is the engine’s only when the project has the flag', () => {
  it('a project without the flag keeps its scrolling panel as it was', () => {
    const sim = game([w('panel', { name: 'Box', style: { scroll: true } })], legacyFlags());
    expect(view(sim, 'Box').scroll).toBeUndefined();
  });

  it('with the flag a panel set to scroll, or one given a scroller, scrolls', () => {
    const sim = game([w('panel', { name: 'Old', style: { scroll: true } }), w('panel', { name: 'New', scroller: sc({ dir: 'horizontal' }) }), w('panel', { name: 'Plain' })]);
    expect(view(sim, 'Old').scroll?.scroller.dir).toBe('vertical');
    expect(view(sim, 'New').scroll?.scroller.dir).toBe('horizontal');
    expect(view(sim, 'Plain').scroll).toBeUndefined();
  });
});

describe('the scrollbar is made of parts', () => {
  it('has a track and a thumb, sized and placed by what is in view', () => {
    const sim = game([rows(20)]);
    sim.runtime.vars.n = 20;
    const key = view(sim, 'Rows').key;
    // no bar was asked for: none is made
    expect(view(sim, 'Rows').parts ?? []).toHaveLength(0);
    const sim2 = game([w('list', { name: 'Rows', source: 'var:n', h: 200, scroller: sc({ bar: { size: 12 } }), children: [w('button', { text: 'r' })] })]);
    sim2.runtime.vars.n = 20;
    withMetrics(sim2, view(sim2, 'Rows').key, 20);
    scrollTo(sc(), scrollState(sim2, view(sim2, 'Rows').key), 'y', 300, true);
    const v = view(sim2, 'Rows');
    expect(v.parts!.map((p) => p.part!.role)).toEqual(['track', 'thumb']);
    const thumb = v.parts!.find((p) => p.part!.role === 'thumb')!;
    expect(thumb.part!.place.right).toBe('0');
    expect(thumb.part!.place.width).toBe('12px');
    expect(thumb.part!.place.height).toContain('0.25'); // 200 of 800 in view
    expect(thumb.scope['scroll.thumb']).toBeCloseTo(0.375, 2); // halfway, with a quarter-length thumb: 0.5 * 0.75
    expect(v.scroll!.scrollable).toBe(true);
    void key;
  });

  it('is on any side, with arrows and a mark for every page, and every part can be the designer’s own', () => {
    const prefabs = [
      { name: 'Gem', widget: w('panel', { name: 'gem', w: 16, h: 16 }) },
      { name: 'Rail', widget: w('panel', { name: 'rail' }) },
      { name: 'Up', widget: w('text', { text: '^' }) },
    ];
    const sim = game([w('list', { name: 'Rows', source: 'var:n', h: 200, scroller: sc({ dir: 'horizontal', bar: { side: 'bottom', arrows: true, pageMarks: true, show: 'always', parts: { thumb: 'Gem', track: 'Rail', arrowStart: 'Up' } } }), children: [w('button', { text: 'r' })] })], currentFlags(), prefabs);
    sim.runtime.vars.n = 20;
    Object.assign(scrollState(sim, view(sim, 'Rows').key).metrics, { viewW: 300, viewH: 100, contentW: 1200, contentH: 100, row: 60 });
    const v = view(sim, 'Rows');
    const roles = v.parts!.map((p) => p.part!.role);
    expect(roles).toEqual(['track', 'thumb', 'arrowStart', 'arrowEnd', 'page', 'page', 'page', 'page']);
    expect(v.parts!.find((p) => p.part!.role === 'thumb')!.node.name).toBe('Gem');
    expect(v.parts!.find((p) => p.part!.role === 'track')!.node.name).toBe('Rail');
    expect(v.parts!.find((p) => p.part!.role === 'arrowStart')!.node.name).toBe('Up');
    expect(v.parts!.find((p) => p.part!.role === 'track')!.part!.place).toMatchObject({ bottom: '0', height: '10px' });
    const last = v.parts!.filter((p) => p.part!.role === 'page');
    expect(last.map((p) => p.scope['scroll.pageHere'])).toEqual([1, 0, 0, 0]);
  });

  it('is not there when the content fits, or when the bar is set to never', () => {
    const sim = game([w('list', { name: 'Rows', source: 'var:n', h: 200, scroller: sc({ bar: {} }), children: [w('button', { text: 'r' })] })]);
    sim.runtime.vars.n = 2;
    withMetrics(sim, view(sim, 'Rows').key, 2);
    expect(view(sim, 'Rows').parts!.every((p) => !p.visible)).toBe(true);
    const never = game([w('list', { name: 'Rows', source: 'var:n', h: 200, scroller: sc({ bar: { show: 'never' } }), children: [w('button', { text: 'r' })] })]);
    never.runtime.vars.n = 20;
    withMetrics(never, view(never, 'Rows').key, 20);
    expect(view(never, 'Rows').parts ?? []).toHaveLength(0);
  });

  it('the arrows scroll a row, and "more above and below" widgets show when there is more that way', () => {
    const prefabs = [{ name: 'More', widget: w('text', { name: 'more', text: '{scroll.hidden_after} more' }) }];
    const sim = game([w('list', { name: 'Rows', source: 'var:n', h: 200, scroller: sc({ motion: 'instant', bar: { arrows: true }, after: { prefab: 'More' }, before: { prefab: '' } }), children: [w('button', { text: 'r' })] })], currentFlags(), prefabs);
    sim.runtime.vars.n = 20;
    const key = view(sim, 'Rows').key;
    withMetrics(sim, key, 20);
    let v = view(sim, 'Rows');
    const after = v.parts!.find((p) => p.part!.role === 'after')!;
    const before = v.parts!.find((p) => p.part!.role === 'before')!;
    expect(after.visible).toBe(true);
    expect(after.text).toBe('15 more');
    expect(before.visible).toBe(false); // at the top: nothing above
    activateWidget(sim, v.parts!.find((p) => p.part!.role === 'arrowEnd')!);
    expect(scrollState(sim, key).y.t).toBe(40);
    scrollTo(sc(), scrollState(sim, key), 'y', 600, true);
    scrollState(sim, key).y.o = 600;
    v = view(sim, 'Rows');
    expect(v.parts!.find((p) => p.part!.role === 'after')!.visible).toBe(false);
    expect(v.parts!.find((p) => p.part!.role === 'before')!.visible).toBe(true);
  });

  it('an edge widget can have a condition of its own', () => {
    const sim = game([w('list', { name: 'Rows', source: 'var:n', h: 200, scroller: sc({ after: { prefab: '', when: '{scroll.hidden_after} > 10' } }), children: [w('button', { text: 'r' })] })]);
    sim.runtime.vars.n = 20;
    const key = view(sim, 'Rows').key;
    withMetrics(sim, key, 20);
    expect(view(sim, 'Rows').parts!.find((p) => p.part!.role === 'after')!.visible).toBe(true); // 15 hidden
    scrollState(sim, key).y.o = 400;
    expect(view(sim, 'Rows').parts!.find((p) => p.part!.role === 'after')!.visible).toBe(false); // 5 hidden
  });
});

describe('long lists make only the rows in view', () => {
  it('a long list makes a few rows with spacers for the rest, and follows the scroll', () => {
    const sim = game([w('list', { name: 'Rows', source: 'var:n', h: 200, scroller: sc({ lazy: true, rowSize: 40, motion: 'instant' }), children: [w('button', { name: 'Row', text: 'Row {index}', h: 40 })] })]);
    sim.runtime.vars.n = 200;
    const key = view(sim, 'Rows').key;
    withMetrics(sim, key, 200);
    let v = view(sim, 'Rows');
    const made = v.children.filter((c) => c.node.name === 'Row');
    expect(made.length).toBeLessThan(12);
    expect(made[0]!.text).toBe('Row 1');
    expect(v.children[v.children.length - 1]!.node.type).toBe('spacer');
    expect(v.children[v.children.length - 1]!.node.h).toBe((200 - made.length) * 40);
    expect(v.scroll!.values.count).toBe(200);
    scrollState(sim, key).y.o = 4000;
    v = view(sim, 'Rows');
    expect(v.children[0]!.node.type).toBe('spacer');
    const row = v.children.find((c) => c.node.name === 'Row')!;
    expect(row.text).toBe('Row 99'); // 4000 / 40 = 100, less the two rows of room
    expect(rowsOf(sim, v.node)).toHaveLength(200);
  });
});
