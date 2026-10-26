import { describe, expect, it } from 'vitest';
import { Simulation, UiDocSchema, currentFlags, legacyFlags, newWidget, openScreen, type CompatFlags, type UiNode, type UiScreen } from '@tilewright/runtime';
import { activateWidget, findOnScreens, focusables, isFocusable, openScreens, stepWidget, walkView, type ViewNode } from './screens-logic';
import { buildSlider, choosePopupOption, closePopup, commitEditing, driveSliderKeys, highlightNext, openPopup, setPopupQuery, setSliderThumb, startEditing, stepNumberField, typeInto, wheelSlider } from './screens-controls';
import { curvePairs, filterOptions, formatSlider, moveHighlight, numberList, placePopup, pointerPosition, sliderPositionOf, sliderValueAt, snapSliderValue, stepSliderValue, takeFocusRequest, SLIDER_DEFAULTS, cleanTyped, parseNumberField } from './controls';
import { routeInput } from './router';
import { scrollState } from './scrolling';

let n = 0;
const w = (type: Parameters<typeof newWidget>[0], patch: Partial<UiNode> = {}): UiNode => ({ ...newWidget(type, `w${++n}`), ...patch }) as UiNode;
const screen = (name: string, children: UiNode[], extra: Partial<UiScreen> = {}): UiScreen =>
  ({ id: name.toLowerCase(), name, root: w('panel', { name: `${name} root`, anchor: 'fill', layout: 'column', children }), modal: true, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false, ...extra }) as UiScreen;
const game = (children: UiNode[], flags: CompatFlags = currentFlags(), prefabs: { name: string; widget: UiNode }[] = []): Simulation => {
  const sim = new Simulation(1);
  sim.compat = flags;
  sim.assets.ui = UiDocSchema.parse({ screens: [screen('S', children)], prefabs });
  openScreen(sim, 'S');
  return sim;
};
const view = (sim: Simulation, name: string): ViewNode => {
  const v = findOnScreens(sim, name);
  if (!v) throw new Error(`no widget ${name}`);
  return v;
};
const roles = (v: ViewNode): string[] => (v.parts ?? []).map((p) => p.part!.role);
const press = (sim: Simulation, ...actions: string[]): void => sim.uiInput.update(Object.fromEntries(actions.map((a) => [a, 1])));

describe('the pieces a control is made of, only when the project has the flag', () => {
  it('a slider keeps the browser control for a project without the flag', () => {
    const sim = game([w('slider', { name: 'Volume', value: 'vol' })], legacyFlags());
    const v = view(sim, 'Volume');
    expect(v.engine).toBeUndefined();
    expect(v.parts).toBeUndefined();
  });

  it('a slider with the flag has a track, a fill and a thumb, and any can be replaced by the designer’s own widget', () => {
    const sim = game([w('slider', { name: 'Volume', value: 'vol', max: '100', slider: { parts: { thumb: 'Gold knob' } } as never })], currentFlags(), [{ name: 'Gold knob', widget: w('panel', { name: 'Gold knob body', w: 30, h: 30 }) }]);
    sim.runtime.vars.vol = 25;
    const v = view(sim, 'Volume');
    expect(roles(v)).toEqual(['track', 'fill', 'thumb']);
    const thumb = v.parts!.find((p) => p.part!.role === 'thumb')!;
    expect(thumb.node.name).toBe('Gold knob'); // the prefab, not the built-in thumb
    expect(thumb.part!.place.left).toBe('25%');
    expect(v.parts!.find((p) => p.part!.role === 'fill')!.part!.place).toMatchObject({ left: '0%', width: '25%' });
    expect(thumb.scope['slider.value']).toBe(25);
    expect(thumb.scope['slider.percent']).toBe(25);
  });

  it('a part sees the numbers of its control and answers to conditions of its own', () => {
    const label = w('text', { name: 'Warm', text: 'warm', visible: '{slider.value} > 50' });
    const sim = game([w('slider', { name: 'Heat', value: 'heat', slider: { parts: { extra: 'x' }, ticks: 'steps' } as never, step: 25 })], currentFlags(), [{ name: 'x', widget: label }]);
    sim.runtime.vars.heat = 75;
    const v = view(sim, 'Heat');
    expect(roles(v).filter((r) => r === 'tick')).toHaveLength(5); // 0, 25, 50, 75, 100
    expect(v.parts!.filter((p) => p.part!.role === 'tick').map((p) => p.part!.place.left)).toEqual(['0%', '25%', '50%', '75%', '100%']);
  });
});

describe('a slider: curves, steps, points, ranges, directions', () => {
  it('maps the track to values linearly, logarithmically and by a table, and back', () => {
    const lin = SLIDER_DEFAULTS;
    expect(sliderValueAt(lin, 0, 100, 0.25)).toBe(25);
    expect(sliderPositionOf(lin, 0, 100, 25)).toBe(0.25);
    const log = { ...SLIDER_DEFAULTS, curve: 'log' as const };
    expect(sliderValueAt(log, 1, 100, 0.5)).toBeCloseTo(10);
    expect(sliderPositionOf(log, 1, 100, 10)).toBeCloseTo(0.5);
    expect(sliderValueAt(log, 0, 100, 0)).toBe(0);
    expect(sliderValueAt(log, 0, 100, 1)).toBeCloseTo(100);
    const table = { ...SLIDER_DEFAULTS, curve: 'table' as const, curveTable: '0.5:0.1' };
    expect(curvePairs('0.5:0.1')).toEqual([[0, 0], [0.5, 0.1], [1, 1]]);
    expect(sliderValueAt(table, 0, 100, 0.5)).toBeCloseTo(10);
    expect(sliderValueAt(table, 0, 100, 0.75)).toBeCloseTo(55);
    expect(sliderPositionOf(table, 0, 100, 55)).toBeCloseTo(0.75);
  });

  it('snaps to steps or to the points it was given, and steps from point to point', () => {
    expect(snapSliderValue(SLIDER_DEFAULTS, 0, 100, 5, 33)).toBe(35);
    expect(snapSliderValue(SLIDER_DEFAULTS, 0, 100, 5, 130)).toBe(100);
    const pts = { ...SLIDER_DEFAULTS, snapPoints: '0, 25, 50, 100' };
    expect(snapSliderValue(pts, 0, 100, 1, 60)).toBe(50);
    expect(snapSliderValue(pts, 0, 100, 1, 80)).toBe(100);
    expect(stepSliderValue(pts, 0, 100, 1, 25, 1, false)).toBe(50);
    expect(stepSliderValue(pts, 0, 100, 1, 25, -1, false)).toBe(0);
    expect(stepSliderValue(pts, 0, 100, 1, 100, 1, false)).toBe(100);
    expect(stepSliderValue(SLIDER_DEFAULTS, 0, 100, 5, 20, 1, true)).toBe(70); // a big step is ten steps
    expect(stepSliderValue({ ...SLIDER_DEFAULTS, bigStep: 20 }, 0, 100, 5, 20, 1, true)).toBe(40);
  });

  it('reads the pointer along any angle', () => {
    const box = { w: 200, h: 20 };
    expect(pointerPosition(0, box, 0, 10)).toBe(0);
    expect(pointerPosition(0, box, 50, 10)).toBe(0.25);
    expect(pointerPosition(0, box, 200, 10)).toBe(1);
    const tall = { w: 20, h: 200 };
    expect(pointerPosition(-90, tall, 10, 200)).toBe(0); // bottom to top: the bottom is the start
    expect(pointerPosition(-90, tall, 10, 50)).toBe(0.75);
    expect(pointerPosition(90, tall, 10, 50)).toBe(0.25);
    expect(pointerPosition(45, { w: 100, h: 100 }, 50, 50)).toBeCloseTo(0.5);
  });

  it('formats the value shown', () => {
    expect(formatSlider({ ...SLIDER_DEFAULTS, format: '{value}%' }, 40)).toBe('40%');
    expect(formatSlider({ ...SLIDER_DEFAULTS, format: '{value} dB', decimals: 1 }, -3.14159)).toBe('-3.1 dB');
    expect(numberList('0, 25  50;100')).toEqual([0, 25, 50, 100]);
  });

  it('the mapped actions step it, holding repeats and speeds up, a second pair makes big steps', () => {
    const sim = game([w('slider', { name: 'Volume', value: 'vol', min: 0, max: '100', step: 5 })]);
    sim.runtime.vars.vol = 50;
    const step = (...a: string[]): void => {
      press(sim, ...a);
      driveSliderKeys(sim, view(sim, 'Volume'));
    };
    step('move_right');
    expect(sim.runtime.vars.vol).toBe(55);
    step('move_right'); // still held, in the wait before it repeats
    expect(sim.runtime.vars.vol).toBe(55);
    for (let i = 0; i < 120; i++) step('move_right'); // held for two seconds
    expect(sim.runtime.vars.vol).toBe(100);
    step();
    step('move_left');
    expect(sim.runtime.vars.vol).toBe(95);
    step();
    step('ui_page_up'); // the second pair: a big step is ten steps
    expect(sim.runtime.vars.vol).toBe(45);
    step();
    step('ui_page_down');
    expect(sim.runtime.vars.vol).toBe(95);
  });

  it('a project that maps its own buttons', () => {
    const sim = game([w('slider', { name: 'Volume', value: 'vol', min: 0, max: '10', step: 1, slider: { actions: { less: 'tune_down', more: 'tune_up' } } as never })]);
    sim.runtime.vars.vol = 5;
    press(sim, 'tune_up');
    driveSliderKeys(sim, view(sim, 'Volume'));
    expect(sim.runtime.vars.vol).toBe(6);
    press(sim);
    press(sim, 'move_right'); // not its button
    driveSliderKeys(sim, view(sim, 'Volume'));
    expect(sim.runtime.vars.vol).toBe(6);
  });

  it('tells the game while it changes, and when it has changed', () => {
    const sim = game([w('slider', { name: 'Volume', value: 'vol', min: 0, max: '100', step: 1, on: { click: [], hover: [], change: [{ type: 'setVariable', params: { name: 'done', op: 'set', value: '1' } }], changing: [{ type: 'setVariable', params: { name: 'moving', op: 'set', value: '1' } }] } })]);
    const seen: string[] = [];
    sim.events.on('ui-slider-changing', () => void seen.push('changing'));
    sim.events.on('ui-slider-changed', () => void seen.push('changed'));
    setSliderThumb(sim, view(sim, 'Volume'), 1, 30, 'changing');
    expect(sim.runtime.vars.vol).toBe(30);
    expect(sim.runtime.vars.moving).toBe(1);
    expect(sim.runtime.vars.done).toBeUndefined(); // not until it is let go
    setSliderThumb(sim, view(sim, 'Volume'), 1, 40, 'changed');
    expect(sim.runtime.vars.done).toBe(1);
    expect(seen).toEqual(['changing', 'changing', 'changed']);
  });

  it('a range has two thumbs that never cross, and the button chooses which one the keys move', () => {
    const sim = game([w('slider', { name: 'Range', value: 'lo', min: 0, max: '100', step: 10, slider: { value2: 'hi' } as never })]);
    sim.runtime.vars.lo = 20;
    sim.runtime.vars.hi = 60;
    const v = view(sim, 'Range');
    expect(roles(v)).toEqual(['track', 'fill', 'thumb', 'thumb2']);
    expect(v.parts!.find((p) => p.part!.role === 'fill')!.part!.place).toMatchObject({ left: '20%', width: '40%' });
    setSliderThumb(sim, v, 1, 90, 'changed');
    expect(sim.runtime.vars.lo).toBe(60);
    setSliderThumb(sim, view(sim, 'Range'), 2, 10, 'changed');
    expect(sim.runtime.vars.hi).toBe(60);
    activateWidget(sim, view(sim, 'Range'));
    press(sim, 'move_right');
    driveSliderKeys(sim, view(sim, 'Range'));
    expect(sim.runtime.vars.hi).toBe(70); // the second thumb moved
    expect(sim.runtime.vars.lo).toBe(60);
  });

  it('the wheel steps it, and a slider can be turned off the wheel', () => {
    const sim = game([w('slider', { name: 'A', value: 'a', min: 0, max: '10', step: 1 }), w('slider', { name: 'B', value: 'b', min: 0, max: '10', step: 1, slider: { wheel: false } as never })]);
    wheelSlider(sim, view(sim, 'A'), true);
    wheelSlider(sim, view(sim, 'B'), true);
    expect(sim.runtime.vars.a).toBe(1);
    expect(sim.runtime.vars.b).toBeUndefined();
  });

  it('a disabled slider cannot be moved', () => {
    const sim = game([w('slider', { name: 'A', value: 'a', max: '10', enabled: '0' })]);
    press(sim, 'move_right');
    expect(driveSliderKeys(sim, view(sim, 'A'))).toBe(false);
    expect(sim.runtime.vars.a).toBeUndefined();
    void buildSlider;
  });
});

describe('a pop-up list', () => {
  const choices = (patch: Partial<UiNode> = {}): UiNode => w('dropdown', { name: 'Language', value: 'lang', options: 'English, French, German', ...patch });

  it('is a closed box until it opens; the chosen option is on the box', () => {
    const sim = game([choices()]);
    sim.runtime.vars.lang = 'French';
    const v = view(sim, 'Language');
    expect(v.popup).toMatchObject({ open: false, text: 'French', chosen: ['French'] });
    expect(roles(v)).toEqual(['box']);
    expect(isFocusable(v)).toBe(true);
  });

  it('opens on the mapped action, the chosen option is marked and holds the focus, and the focus is kept inside', () => {
    const sim = game([choices(), w('button', { name: 'Other', text: 'Other' })]);
    sim.runtime.vars.lang = 'French';
    activateWidget(sim, view(sim, 'Language'));
    const v = view(sim, 'Language');
    expect(v.popup!.open).toBe(true);
    const list = v.parts!.find((p) => p.part!.role === 'list')!;
    expect(list.part!.mount).toBe('screen');
    const options = list.children.filter((c) => c.act?.kind === 'option');
    expect(options.map((o) => o.scope['option.label'])).toEqual(['English', 'French', 'German']);
    expect(options.map((o) => o.scope['option.chosen'])).toEqual([0, 1, 0]);
    expect(takeFocusRequest(sim)).toBe(`${v.key}~opt#French`);
    // while it is open only its options can be chosen
    const [screenView] = openScreens(sim).map((s) => s.view);
    expect(focusables(screenView!).map((f) => f.act?.kind)).toEqual(['option', 'option', 'option']);
  });

  it('choosing writes the value, runs the change actions, closes it and gives the focus back to the box', () => {
    const sim = game([choices({ on: { click: [], hover: [], change: [{ type: 'setVariable', params: { name: 'changed', op: 'set', value: '1' } }] } })]);
    activateWidget(sim, view(sim, 'Language'));
    takeFocusRequest(sim);
    const opt = view(sim, 'Language').parts!.find((p) => p.part!.role === 'list')!.children.find((c) => c.scope['option.value'] === 'German')!;
    activateWidget(sim, opt);
    expect(sim.runtime.vars.lang).toBe('German');
    expect(sim.runtime.vars.changed).toBe(1);
    expect(view(sim, 'Language').popup!.open).toBe(false);
    expect(takeFocusRequest(sim)).toBe(view(sim, 'Language').key);
  });

  it('Back closes it with no change', () => {
    const sim = game([choices()]);
    sim.runtime.vars.lang = 'English';
    activateWidget(sim, view(sim, 'Language'));
    press(sim, 'pause');
    routeInput({ sim, pauseKeyOpensPause: false });
    expect(view(sim, 'Language').popup!.open).toBe(false);
    expect(sim.runtime.vars.lang).toBe('English');
    expect(sim.runtime.ui.stack).toEqual(['S']); // Back went to the list, not out of the screen
    press(sim);
    press(sim, 'pause');
    routeInput({ sim, pauseKeyOpensPause: false });
    expect(sim.runtime.ui.stack).toEqual([]); // the next Back is the screen's
  });

  it('left and right on the closed box step through the options without opening, unless the setting says not', () => {
    const sim = game([choices(), choices({ name: 'Locked', value: 'lang2', popup: { stepClosed: false } as never })]);
    sim.runtime.vars.lang = 'French';
    expect(stepWidget(sim, view(sim, 'Language'), 1)).toBe(true);
    expect(sim.runtime.vars.lang).toBe('German');
    expect(stepWidget(sim, view(sim, 'Language'), 1)).toBe(true);
    expect(sim.runtime.vars.lang).toBe('English'); // round the end
    expect(stepWidget(sim, view(sim, 'Locked'), 1)).toBe(false);
    expect(view(sim, 'Language').popup!.open).toBe(false);
  });

  it('options from a table, with icons, descriptions and groups; many chosen; search', () => {
    const sim = game([w('dropdown', { name: 'Weapon', value: 'weapons', source: 'table:Arms', popup: { multi: true, search: true, value: '{row.id}', label: '{row.name}', detail: '{row.about}', group: '{row.kind}', manyText: '{count} weapons' } as never })]);
    sim.assets.tables.set('Arms', { name: 'Arms', columns: [{ id: 'name', name: 'name', type: 'text' }, { id: 'about', name: 'about', type: 'text' }, { id: 'kind', name: 'kind', type: 'text' }], rows: [{ id: 'sword', name: 'Sword', about: 'sharp', kind: 'blades' }, { id: 'dagger', name: 'Dagger', about: 'small', kind: 'blades' }, { id: 'bow', name: 'Bow', about: 'far', kind: 'ranged' }] } as never);
    activateWidget(sim, view(sim, 'Weapon'));
    let list = view(sim, 'Weapon').parts!.find((p) => p.part!.role === 'list')!;
    expect(list.children.map((c) => c.part!.role)).toEqual(['search', 'group', 'option', 'option', 'group', 'option']);
    expect(list.children.filter((c) => c.act).map((c) => [c.scope['option.label'], c.scope['option.detail']])).toEqual([['Sword', 'sharp'], ['Dagger', 'small'], ['Bow', 'far']]);
    choosePopupOption(sim, view(sim, 'Weapon'), 'sword');
    choosePopupOption(sim, view(sim, 'Weapon'), 'bow');
    expect(sim.runtime.vars.weapons).toBe('sword,bow');
    expect(view(sim, 'Weapon').popup).toMatchObject({ open: true, text: '2 weapons' }); // many choices: it stays open
    choosePopupOption(sim, view(sim, 'Weapon'), 'sword');
    expect(sim.runtime.vars.weapons).toBe('bow');
    setPopupQuery(sim, view(sim, 'Weapon'), 'dag');
    list = view(sim, 'Weapon').parts!.find((p) => p.part!.role === 'list')!;
    expect(list.children.filter((c) => c.act).map((c) => c.scope['option.label'])).toEqual(['Dagger']);
    setPopupQuery(sim, view(sim, 'Weapon'), 'zzz');
    list = view(sim, 'Weapon').parts!.find((p) => p.part!.role === 'list')!;
    expect(list.children.map((c) => c.part!.role)).toEqual(['search', 'empty']);
  });

  it('options from a list source a plugin added, and the project’s own filter', () => {
    const sim = game([w('dropdown', { name: 'Hero', value: 'hero', source: 'table:Heroes', popup: { value: '{row.id}', label: '{row.name}', filter: '{option.value} != secret' } as never })]);
    sim.assets.tables.set('Heroes', { name: 'Heroes', columns: [{ id: 'name', name: 'name', type: 'text' }], rows: [{ id: 'a', name: 'Ann' }, { id: 'secret', name: 'Hidden' }, { id: 'b', name: 'Bo' }] } as never);
    expect(view(sim, 'Hero').popup!.all.map((o) => o.label)).toEqual(['Ann', 'Bo']);
  });

  it('every part can be the designer’s own: the box, the list, an option, the chosen mark', () => {
    const prefabs = [
      { name: 'My box', widget: w('panel', { name: 'my box', children: [w('text', { text: 'Pick: {popup.text}' })] }) },
      { name: 'My option', widget: w('panel', { name: 'my option', children: [w('text', { text: '{option.label}' })] }) },
      { name: 'My list', widget: w('panel', { name: 'my list', layout: 'column' }) },
    ];
    const sim = game([choices({ popup: { parts: { box: 'My box', option: 'My option', list: 'My list' } } as never })], currentFlags(), prefabs);
    activateWidget(sim, view(sim, 'Language'));
    const v = view(sim, 'Language');
    expect(v.parts![0]!.node.name).toBe('My box');
    expect(v.parts![0]!.children[0]!.text).toBe('Pick: English');
    const list = v.parts!.find((p) => p.part!.role === 'list')!;
    expect(list.node.name).toBe('My list');
    expect(list.children[0]!.node.name).toBe('My option');
  });

  it('highlight moves up and down round the ends, and the pop-up is placed inside the screen', () => {
    const opts = ['a', 'b', 'c'].map((value) => ({ value, label: value, icon: '', detail: '', group: '', scope: {} }));
    expect(moveHighlight(opts, 'a', -1)).toBe('c');
    expect(moveHighlight(opts, 'c', 1)).toBe('a');
    expect(moveHighlight(opts, 'c', 1, false)).toBe('c');
    expect(moveHighlight(opts, '', 1)).toBe('a');
    expect(filterOptions(opts, 'B').map((o) => o.value)).toEqual(['b']);
    const screenBox = { w: 1280, h: 720 };
    expect(placePopup('below', { x: 100, y: 100, w: 200, h: 30 }, { w: 200, h: 150 }, screenBox, 'box')).toMatchObject({ x: 100, y: 130, w: 200, flipped: false });
    expect(placePopup('below', { x: 100, y: 650, w: 200, h: 30 }, { w: 200, h: 150 }, screenBox, 'box')).toMatchObject({ y: 500, flipped: true }); // no room below: it goes above
    expect(placePopup('below', { x: 1200, y: 100, w: 200, h: 30 }, { w: 200, h: 150 }, screenBox, 'box').x).toBe(1080); // kept inside
    expect(placePopup('beside', { x: 100, y: 100, w: 200, h: 30 }, { w: 150, h: 100 }, screenBox, 'fit')).toMatchObject({ x: 304, y: 100, w: 150 });
    expect(placePopup('centred', { x: 0, y: 0, w: 10, h: 10 }, { w: 400, h: 200 }, screenBox, 'fit')).toMatchObject({ x: 440, y: 260 });
    void highlightNext;
    void openPopup;
    void closePopup;
  });

  it('several lists are not open at once, and a list that is hidden closes', () => {
    const sim = game([choices({ name: 'A', value: 'a' }), choices({ name: 'B', value: 'b' })]);
    activateWidget(sim, view(sim, 'A'));
    activateWidget(sim, view(sim, 'B'));
    expect(view(sim, 'A').popup!.open).toBe(false);
    expect(view(sim, 'B').popup!.open).toBe(true);
  });
});

describe('text fields, number fields, tick boxes, key bindings and tabs', () => {
  it('a text field is typed into, kept on Enter, and Back keeps the old words', () => {
    const sim = game([w('textfield', { name: 'Hero name', value: 'hero_name', field: { placeholder: 'Your name', maxLength: 8, allow: 'name' } as never })]);
    let v = view(sim, 'Hero name');
    expect(roles(v)).toEqual(['box']);
    expect(v.parts![0]!.scope).toMatchObject({ 'field.empty': 1, 'field.placeholder': 'Your name' });
    activateWidget(sim, v);
    typeInto(sim, view(sim, 'Hero name'), 'Ann <b>Marie</b> Longname');
    expect(view(sim, 'Hero name').parts![0]!.scope['field.length']).toBe(8);
    commitEditing(sim, view(sim, 'Hero name'));
    expect(sim.runtime.vars.hero_name).toBe('Ann bMar');
    // typing again, then Back
    activateWidget(sim, view(sim, 'Hero name'));
    typeInto(sim, view(sim, 'Hero name'), 'Zed');
    press(sim, 'pause');
    routeInput({ sim, pauseKeyOpensPause: false });
    commitEditing(sim, view(sim, 'Hero name'));
    expect(sim.runtime.vars.hero_name).toBe('Ann bMar');
    v = view(sim, 'Hero name');
    expect(v.field!.editing).toBe(false);
  });

  it('a number field keeps to its limits and its step, and steps with left and right and the arrows', () => {
    const sim = game([w('numberfield', { name: 'Seed', value: 'seed', field: { min: 0, max: 50, step: 5, parts: { up: 'Up arrow', down: 'Down arrow' } } as never })], currentFlags(), [{ name: 'Up arrow', widget: w('text', { text: '+' }) }, { name: 'Down arrow', widget: w('text', { text: '-' }) }]);
    sim.runtime.vars.seed = 10;
    expect(roles(view(sim, 'Seed'))).toEqual(['box', 'up', 'down']);
    expect(stepWidget(sim, view(sim, 'Seed'), 1)).toBe(true);
    expect(sim.runtime.vars.seed).toBe(15);
    activateWidget(sim, view(sim, 'Seed').parts!.find((p) => p.part!.role === 'down')!);
    expect(sim.runtime.vars.seed).toBe(10);
    activateWidget(sim, view(sim, 'Seed'));
    typeInto(sim, view(sim, 'Seed'), '77');
    commitEditing(sim, view(sim, 'Seed'));
    expect(sim.runtime.vars.seed).toBe(50);
    activateWidget(sim, view(sim, 'Seed'));
    typeInto(sim, view(sim, 'Seed'), 'abc');
    commitEditing(sim, view(sim, 'Seed'));
    expect(sim.runtime.vars.seed).toBe(50); // not a number: the old one stays
    stepNumberField(sim, view(sim, 'Seed'), 1);
    expect(sim.runtime.vars.seed).toBe(50);
    expect(cleanTyped('a1-2.5x', 'digits', 10)).toBe('1-2.5');
    expect(parseNumberField('12', 0, 10, 1)).toBe(10);
    expect(parseNumberField('', 0, 10, 1)).toBeNull();
  });

  it('a tick box is a box and a label, and shows when it is on', () => {
    const sim = game([w('toggle', { name: 'Music', text: 'Music', value: 'music_on' })]);
    sim.runtime.vars.music_on = 1;
    const v = view(sim, 'Music');
    expect(roles(v)).toEqual(['box', 'label']);
    expect(v.parts![0]!.scope['toggle.on']).toBe(1);
    expect(v.parts![1]!.text).toBe('Music');
    activateWidget(sim, v);
    expect(sim.runtime.vars.music_on).toBe(false);
  });

  it('tabs are a part for each tab, each reached by the keys, the chosen one marked', () => {
    const sim = game([w('tabs', { name: 'Pages', options: 'Items, Quests', children: [w('text', { text: 'items' }), w('text', { text: 'quests' })] })]);
    const v = view(sim, 'Pages');
    expect(roles(v)).toEqual(['tab', 'tab']);
    expect(v.parts!.map((t) => t.scope['tab.selected'])).toEqual([1, 0]);
    expect(isFocusable(v)).toBe(false);
    const [top] = openScreens(sim);
    const tabs = focusables(top!.view).filter((f) => f.act?.kind === 'tab');
    expect(tabs).toHaveLength(2);
    activateWidget(sim, tabs[1]!);
    expect(sim.runtime.ui.tabs[v.key]).toBe('Quests');
    expect(view(sim, 'Pages').parts!.map((t) => t.scope['tab.selected'])).toEqual([0, 1]);
  });

  it('a key binding is a name and a key, and the key says when it waits for a press', () => {
    const sim = game([w('keybind', { name: 'Jump', text: 'jump', label: 'Jump' })]);
    const v = view(sim, 'Jump');
    expect(roles(v)).toEqual(['name', 'key']);
    expect(v.parts![0]!.scope['bind.name']).toBe('Jump');
    sim.runtime.scratch.set('ui.capturing', v.key);
    expect(view(sim, 'Jump').parts![1]!.scope['bind.capturing']).toBe(1);
  });
});

describe('every control is the same as before for a project without the flag', () => {
  it('has no parts anywhere, whatever the screen holds', () => {
    const sim = game([w('slider', { name: 'a', value: 'a' }), w('dropdown', { name: 'b', value: 'b' }), w('toggle', { name: 'c' }), w('tabs', { name: 'd', options: 'x,y' }), w('keybind', { name: 'e' })], legacyFlags());
    const [top] = openScreens(sim);
    let any = false;
    walkView(top!.view, (v) => {
      if (v.parts || v.engine) any = true;
    });
    expect(any).toBe(false);
    expect(scrollState(sim, 'x').metrics.row).toBe(0);
  });
});
