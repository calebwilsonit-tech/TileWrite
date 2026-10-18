import { describe, expect, it } from 'vitest';
import { Simulation, TableSchema, UiDocSchema, UiNodeSchema, openStartScreens, applySave, evalUiCondition, newWidget, openScreen, serializeGame, type UiNode, type UiScreen, type VariableValue } from '@tilewright/runtime';
import { activateWidget, autoFocus, findOnScreens, focusables, openScreens, rowsOf, setChoice, setSlider, setUiBridge, swapRows, uiBridge, writeTarget, readTarget, resolveScreen, type UiBridge } from './ui/screens-logic';
import { newAction, setActivePacks } from './index';

setActivePacks(undefined);

let n = 0;
const w = (type: Parameters<typeof newWidget>[0], patch: Partial<UiNode> = {}): UiNode => ({ ...newWidget(type, `w${++n}`), ...patch });
const screen = (name: string, children: UiNode[], extra: Partial<UiScreen> = {}): UiScreen => ({
  id: name.toLowerCase(),
  name,
  root: w('panel', { name: `${name} root`, anchor: 'fill', layout: 'column', children }),
  modal: false,
  dim: 0,
  transition: 'none',
  mapX: 0,
  mapY: 0,
  opensOnStart: false,
  ...extra,
});

function game(screens: UiScreen[], prefabs: { name: string; widget: UiNode }[] = []): Simulation {
  const sim = new Simulation(1);
  sim.assets.ui = UiDocSchema.parse({ screens, prefabs });
  return sim;
}

describe('conditions', () => {
  const src = (vars: Record<string, VariableValue>) => ({ vars, tables: new Map(), world: new Simulation(1).world });
  it('compare numbers, words and percentages, with and / or / not', () => {
    const s = src({ gold: 12, hp: 2, max: 10, door: 'open', key: true });
    expect(evalUiCondition(s, '')).toBe(true);
    expect(evalUiCondition(s, '{gold} >= 10')).toBe(true);
    expect(evalUiCondition(s, '{gold} < 10')).toBe(false);
    expect(evalUiCondition(s, '{hp} / {max} < 25%')).toBe(true);
    expect(evalUiCondition(s, '{door} = open && {key}')).toBe(true);
    expect(evalUiCondition(s, '{door} = shut || {gold} > 100')).toBe(false);
    expect(evalUiCondition(s, '!{key}')).toBe(false);
    expect(evalUiCondition(s, '{gold} != 12')).toBe(false);
    expect(evalUiCondition(s, '{missing}')).toBe(false);
  });
});

describe('screens', () => {
  it('open on top of each other, go back, close, and a modal one freezes the game', () => {
    const sim = game([screen('Hud', []), screen('Pause', [], { modal: true }), screen('Settings', [])]);
    const host = { runtime: sim.runtime, assets: sim.assets };
    expect(openScreen(host, 'Hud')).toBe(true);
    expect(openScreen(host, 'Nope')).toBe(false);
    expect(sim.runtime.ui.modal).toBe(false);
    openScreen(host, 'Pause');
    expect(sim.runtime.ui.modal).toBe(true);
    const before = sim.tick;
    sim.step({});
    expect(sim.tick).toBe(before + 1); // the clock still ticks, but nothing moves (the sheet and behaviours are frozen)
    openScreen(host, 'Settings');
    expect(sim.runtime.ui.stack).toEqual(['Hud', 'Pause', 'Settings']);
    sim.runtime.vars.x = 1;
    // actions open and close screens
    const press = w('button', { text: 'Back', on: { click: [{ ...newAction('uiScreen'), params: { op: 'back', screen: '' } }], hover: [], change: [] } });
    sim.assets.ui = UiDocSchema.parse({ screens: [...sim.assets.ui.screens.filter((s) => s.name !== 'Settings'), screen('Settings', [press], {})] });
    activateWidget(sim, findOnScreens(sim, 'Back')!);
    expect(sim.runtime.ui.stack).toEqual(['Hud', 'Pause']);
    sim.runtime.ui.stack = ['Hud'];
    sim.runtime.ui.modal = false;
  });

  it('screens marked "opens when the game starts" come up first', () => {
    const sim = game([screen('Title', [], { opensOnStart: true, modal: true }), screen('Hud', [])]);
    expect(sim.assets.ui.screens.map((s) => s.opensOnStart)).toEqual([true, false]);
  });
});

describe('what is on show', () => {
  it('fills texts from variables, table cells and object fields, and hides by condition', () => {
    const label = w('text', { text: 'Gold: {gold} / {Prices.sword.cost}' });
    const secret = w('text', { text: 'Rich!', visible: '{gold} >= 100' });
    const sim = game([screen('Hud', [label, secret])]);
    sim.assets.tables.set('Prices', TableSchema.parse({ name: 'Prices', columns: [{ id: 'cost', type: 'number' }], rows: [{ id: 'sword', cost: 30 }] }));
    sim.runtime.vars.gold = 12;
    openScreen({ runtime: sim.runtime, assets: sim.assets }, 'Hud');
    let view = openScreens(sim)[0]!.view;
    expect(view.children[0]!.text).toBe('Gold: 12 / 30');
    expect(view.children[1]!.visible).toBe(false);
    sim.runtime.vars.gold = 120;
    view = openScreens(sim)[0]!.view;
    expect(view.children[1]!.visible).toBe(true);
  });

  it('bars and sliders read a number and a maximum; the maximum can be a table cell', () => {
    const bar = w('bar', { value: 'hp', max: '{Stats.hero.maxhp}' });
    const sim = game([screen('Hud', [bar])]);
    sim.assets.tables.set('Stats', TableSchema.parse({ name: 'Stats', columns: [{ id: 'maxhp', type: 'number' }], rows: [{ id: 'hero', maxhp: 40 }] }));
    sim.runtime.vars.hp = 10;
    const v = resolveScreen(sim, sim.assets.ui.screens[0]!).children[0]!;
    expect(v.value).toBe(10);
    expect(v.max).toBe(40);
    expect(v.fraction).toBeCloseTo(0.25);
  });

  it('a list repeats a template for every row of a table, with the cells in view', () => {
    const slot = w('panel', { layout: 'row', children: [w('text', { text: '{row.name} costs {row.cost}' })] });
    const list = w('list', { source: 'table:Shop', children: [slot] });
    const sim = game([screen('Shop', [list])]);
    sim.assets.tables.set('Shop', TableSchema.parse({ name: 'Shop', columns: [{ id: 'name', type: 'text' }, { id: 'cost', type: 'number' }], rows: [{ id: 'a', name: 'Sword', cost: 5 }, { id: 'b', name: 'Bow', cost: 7 }] }));
    const v = resolveScreen(sim, sim.assets.ui.screens[0]!).children[0]!;
    expect(v.children.map((c) => c.children[0]!.text)).toEqual(['Sword costs 5', 'Bow costs 7']);
    expect(v.children.map((c) => c.key.split('/').pop())).toEqual([`${list.id}#a`, `${list.id}#b`]);
    expect(sim.runtime.vars['row.name']).toBeUndefined(); // the scope is put away again
  });

  it('a list can use a UI prefab, with overrides on an instance', () => {
    const prefab = w('panel', { name: 'Card', children: [w('text', { name: 'Title', text: '{row.name}' })] });
    const list = w('list', { source: 'table:Shop', template: 'Card' });
    const one = w('instance', { prefab: 'Card', overrides: { Title: { text: 'Fixed!' } } });
    const sim = game([screen('Shop', [list, one])], [{ name: 'Card', widget: prefab }]);
    sim.assets.tables.set('Shop', TableSchema.parse({ name: 'Shop', columns: [{ id: 'name', type: 'text' }], rows: [{ id: 'a', name: 'Sword' }] }));
    const view = resolveScreen(sim, sim.assets.ui.screens[0]!);
    expect(view.children[0]!.children[0]!.children[0]!.text).toBe('Sword');
    expect(view.children[1]!.children[0]!.text).toBe('Fixed!');
    // changing the prefab changes every use
    sim.assets.ui.prefabs[0]!.widget.children[0]!.text = 'Changed {row.name}';
    expect(resolveScreen(sim, sim.assets.ui.screens[0]!).children[0]!.children[0]!.children[0]!.text).toBe('Changed Sword');
  });

  it('rows can come from slots, carried items, and the turn queue', () => {
    const sim = game([]);
    sim.runtime.vars['item:key'] = 2;
    expect(rowsOf(sim, w('grid', { source: 'slots:6' }))).toHaveLength(6);
    expect(rowsOf(sim, w('list', { source: 'items' })).map((r) => [r.id, r.scope['item.count']])).toEqual([['key', 2]]);
    expect(rowsOf(sim, w('turnOrder'))).toEqual([]);
  });

  it('tabs show the page of the chosen tab', () => {
    const tabs = w('tabs', { options: 'Items, Quests', children: [w('text', { text: 'item page' }), w('text', { text: 'quest page' })] });
    const sim = game([screen('Menu', [tabs])]);
    let v = resolveScreen(sim, sim.assets.ui.screens[0]!).children[0]!;
    expect(v.children.map((c) => c.visible)).toEqual([true, false]);
    setChoice(sim, v, 'Quests');
    v = resolveScreen(sim, sim.assets.ui.screens[0]!).children[0]!;
    expect(v.children.map((c) => c.visible)).toEqual([false, true]);
  });
});

describe('doing things', () => {
  it('a button runs its actions, with the row it sits on in view', () => {
    const buy = w('button', { text: 'Buy', on: { click: [{ ...newAction('setVariable'), params: { name: 'bought', op: 'set', value: '{row.name}' } }], hover: [], change: [] } });
    const list = w('list', { source: 'table:Shop', children: [buy] });
    const sim = game([screen('Shop', [list])]);
    sim.assets.tables.set('Shop', TableSchema.parse({ name: 'Shop', columns: [{ id: 'name', type: 'text' }], rows: [{ id: 'a', name: 'Sword' }, { id: 'b', name: 'Bow' }] }));
    openScreen({ runtime: sim.runtime, assets: sim.assets }, 'Shop');
    const second = openScreens(sim)[0]!.view.children[0]!.children[1]!;
    activateWidget(sim, second);
    expect(sim.runtime.vars.bought).toBe('Bow');
    const seen: string[] = [];
    sim.events.on('ui-click', (e) => seen.push(String(e.widget)));
    activateWidget(sim, second);
    expect(seen).toEqual([buy.id]);
  });

  it('a disabled or hidden button does nothing', () => {
    const b = w('button', { enabled: '{ok}', on: { click: [{ ...newAction('setVariable'), params: { name: 'hit', op: 'set', value: '1' } }], hover: [], change: [] } });
    const sim = game([screen('S', [b])]);
    sim.runtime.vars.ok = false;
    openScreen({ runtime: sim.runtime, assets: sim.assets }, 'S');
    activateWidget(sim, openScreens(sim)[0]!.view.children[0]!);
    expect(sim.runtime.vars.hit).toBeUndefined();
    sim.runtime.vars.ok = true;
    activateWidget(sim, openScreens(sim)[0]!.view.children[0]!);
    expect(sim.runtime.vars.hit).toBe(1);
  });

  it('toggles and sliders write a variable or a setting, and a bridge hands settings to the host', () => {
    const settings: Record<string, VariableValue> = { music: 50, fullscreen: false };
    const bridge: UiBridge = { getSetting: (k) => settings[k], setSetting: (k, v) => void (settings[k] = v) };
    const slider = w('slider', { value: 'settings.music', min: 0, max: '100', step: 5 });
    const tick = w('toggle', { value: 'settings.fullscreen' });
    const flag = w('toggle', { value: 'muted' });
    const sim = game([screen('Settings', [slider, tick, flag])]);
    setUiBridge(sim, bridge);
    expect(uiBridge(sim)).toBe(bridge);
    openScreen({ runtime: sim.runtime, assets: sim.assets }, 'Settings');
    const view = () => openScreens(sim)[0]!.view.children;
    expect(view()[0]!.value).toBe(50);
    setSlider(sim, view()[0]!, 63);
    expect(settings.music).toBe(65);
    setSlider(sim, view()[0]!, 400);
    expect(settings.music).toBe(100);
    activateWidget(sim, view()[1]!);
    expect(settings.fullscreen).toBe(true);
    activateWidget(sim, view()[2]!);
    expect(sim.runtime.vars.muted).toBe(true);
    expect(readTarget(sim, 'settings.music')).toBe(100);
    expect(view()[2]!.value).toBe(1);
  });

  it('drag one inventory cell onto another and the rows swap; the swap is saved and restored', () => {
    const cell = w('panel', { children: [w('text', { text: '{row.item} x{row.qty}' })] });
    const grid = w('grid', { source: 'table:Bag', drag: true, columns: 2, children: [cell] });
    const sim = game([screen('Inv', [grid])]);
    sim.assets.tables.set('Bag', TableSchema.parse({ name: 'Bag', columns: [{ id: 'item', type: 'text' }, { id: 'qty', type: 'number' }], rows: [{ id: 's1', item: 'potion', qty: 3 }, { id: 's2', item: '', qty: 0 }, { id: 's3', item: 'key', qty: 1 }] }));
    openScreen({ runtime: sim.runtime, assets: sim.assets }, 'Inv');
    const text = () => openScreens(sim)[0]!.view.children[0]!.children.map((c) => c.children[0]!.text);
    expect(text()).toEqual(['potion x3', ' x0', 'key x1']);
    const cells = openScreens(sim)[0]!.view.children[0]!.children;
    expect(cells[0]!.row).toEqual({ table: 'Bag', id: 's1' });
    expect(swapRows(sim, 'Bag', 's1', 's2')).toBe(true);
    expect(text()).toEqual([' x0', 'potion x3', 'key x1']);
    expect(swapRows(sim, 'Bag', 's1', 's1')).toBe(false);
    expect(swapRows(sim, 'Bag', 's1', 'nope')).toBe(false);
    // editing a cell by name works the same way and is saved
    writeTarget(sim, 'Bag.s3.qty', 9);
    const save = serializeGame(sim, { stamp: 'x' });
    expect(save.tables.Bag!.map((r) => r.item)).toEqual(['', 'potion', 'key']);
    const fresh = game([screen('Inv', [grid])]);
    fresh.assets.tables.set('Bag', TableSchema.parse({ name: 'Bag', columns: [{ id: 'item', type: 'text' }, { id: 'qty', type: 'number' }], rows: [{ id: 's1', item: 'potion', qty: 3 }, { id: 's2', item: '', qty: 0 }, { id: 's3', item: 'key', qty: 1 }] }));
    applySave(fresh, save);
    expect(fresh.assets.tables.get('Bag')!.rows.map((r) => `${r.item}:${r.qty}`)).toEqual([':0', 'potion:3', 'key:9']);
  });
});

describe('keys and gamepads', () => {
  it('finds what can be aimed at, and fills in the arrows from the layout', () => {
    const a = w('button', { text: 'A' });
    const b = w('button', { text: 'B' });
    const c = w('button', { text: 'C' });
    const col = w('panel', { layout: 'column', children: [a, b] });
    const row = w('panel', { layout: 'row', children: [col, c] });
    const sc = screen('Menu', [row]);
    const done = autoFocus(sc.root);
    const find = (id: string): UiNode => {
      let hit: UiNode | undefined;
      const walk = (x: UiNode): void => {
        if (x.id === id) hit = x;
        x.children.forEach(walk);
      };
      walk(done);
      return hit!;
    };
    expect(find(a.id).focus.down).toBe(b.id);
    expect(find(b.id).focus.up).toBe(a.id);
    expect(find(b.id).focus.right).toBe(c.id);
    expect(find(c.id).focus.left).toBe(b.id);
    const sim = game([sc]);
    openScreen({ runtime: sim.runtime, assets: sim.assets }, 'Menu');
    expect(focusables(openScreens(sim)[0]!.view).map((f) => f.text)).toEqual(['A', 'B', 'C']);
  });
});

describe('the turn order bar', () => {
  it('lists the units in order with a default chip, and marks whose turn it is', () => {
    const bar = w('turnOrder');
    const sim = game([screen('Battle', [bar])]);
    const a = sim.world.spawn({ name: 'Knight', tags: [], components: { turnTaker: { team: 'player' } } });
    const b = sim.world.spawn({ name: 'Goblin', tags: [], components: { turnTaker: { team: 'enemy' } } });
    sim.runtime.turns = { ...sim.runtime.turns, active: true, order: [a.id, b.id], index: 1 };
    const kids = resolveScreen(sim, sim.assets.ui.screens[0]!).children[0]!.children;
    expect(kids.map((k) => k.children[0]!.text)).toEqual(['Knight', 'Goblin']);
    expect(kids.map((k) => k.scope['unit.active'])).toEqual([0, 1]);
    expect(kids.map((k) => k.scope['unit.team'])).toEqual(['player', 'enemy']);
  });
});

describe('screens that open when the game starts', () => {
  it('a modal screen (the title) is on top of a heads-up display even when the display was made later', () => {
    const sim = new Simulation(1);
    const node = (id: string) => UiNodeSchema.parse({ id, name: id });
    sim.assets.ui = UiDocSchema.parse({ screens: [{ id: 'a', name: 'Title', modal: true, opensOnStart: true, root: node('r1') }, { id: 'b', name: 'HUD', opensOnStart: true, root: node('r2') }] });
    openStartScreens(sim);
    expect(sim.runtime.ui.stack).toEqual(['HUD', 'Title']);
    expect(sim.runtime.ui.modal).toBe(true);
  });
});
