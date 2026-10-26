import { evalUiCondition, fillValues, type FieldControl, type PopupSpec, type Scroller, type Simulation, type SliderSpec, type UiNode, type VariableValue } from '@tilewright/runtime';
import { runActionList } from '../events/sheet';
import { contextOf } from '../story/context';
import {
  POPUP_DEFAULTS,
  SLIDER_DEFAULTS,
  builtinPart,
  chosenValues,
  cleanTyped,
  closeAllPopups,
  fieldRun,
  filterOptions,
  holdSteps,
  joinValues,
  moveHighlight,
  parseNumberField,
  popupRun,
  requestFocus,
  sliderPlacement,
  sliderRun,
  sliderView,
  snapSliderValue,
  stepSliderValue,
  type PopupOption,
  type Scope,
} from './controls';
import { instanceStub, readTarget, resolveNode, rowsOf, withScope, writeTarget, type PartInfo, type ViewNode } from './screens-logic';
import { mainAxis, scrollScope, scrollState, scrollValues, thumbOf, offsetRange, type ScrollValues } from './scrolling';

/**
 * Builds the pieces of the controls the engine draws (the project has `uiControls` / `uiScroll`): works out the numbers each piece
 * is given and where it goes, and does what choosing a piece means. The pieces are ordinary widgets, resolved like any others, so
 * a project's own UI prefab can stand in for any of them.
 */

const num = (v: VariableValue | undefined, d = 0): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

const sourceOf = (sim: Simulation) => ({ vars: sim.runtime.vars, tables: sim.assets.tables, world: sim.world });

/** The widget that draws a part: the project's UI prefab with that name, or the built-in one (null: none). */
export function partNode(kind: string, role: string, prefab: string | undefined): UiNode | null {
  return prefab ? { ...instanceStub(`${kind}.${role}`, prefab), name: prefab } : builtinPart(kind, role);
}

/** Make the view of one part, tied to the control it belongs to. */
function makePart(sim: Simulation, owner: ViewNode, kind: string, role: string, node: UiNode, suffix: string, scope: Scope, place: Record<string, string>, mount: PartInfo['mount'], depth: number, visible: boolean, act?: ViewNode['act']): ViewNode {
  const v = resolveNode(sim, node, `${owner.key}~${suffix}`, { ...owner.scope, ...scope }, depth + 1, visible);
  v.part = { of: owner.key, kind, role, place, mount };
  if (act) v.act = act;
  Object.defineProperty(v, 'owner', { value: owner, enumerable: false, configurable: true });
  return v;
}

const stateOf = (owner: ViewNode): Scope => ({ 'control.enabled': owner.enabled ? 1 : 0 });

function runList(sim: Simulation, n: ViewNode, which: 'click' | 'hover' | 'change' | 'changing', scope: Scope = {}): void {
  const actions = which === 'changing' ? (n.node.on.changing ?? []) : n.node.on[which];
  if (actions.length === 0) return;
  withScope(sim, { ...n.scope, ...scope }, () => runActionList(contextOf(sim), actions as never));
}

// ---------- slider ----------

export function sliderSpecOf(node: UiNode): SliderSpec {
  return { ...SLIDER_DEFAULTS, ...(node.slider ?? {}), actions: { ...SLIDER_DEFAULTS.actions, ...(node.slider?.actions ?? {}) }, parts: node.slider?.parts ?? {} };
}

export function buildSlider(sim: Simulation, out: ViewNode, node: UiNode, depth: number, visible: boolean): void {
  const spec = sliderSpecOf(node);
  const run = sliderRun(sim, out.key);
  const value2 = spec.value2 ? num(readTarget(sim, spec.value2)) : null;
  const view = sliderView(spec, node.min, out.max, out.value, value2, run.active);
  const steps = Math.max(1, Math.round((out.max - node.min) / (node.step > 0 ? node.step : 1)));
  out.engine = true;
  out.fraction = view.at;
  out.slider = { spec, value: view.value, value2: view.value2, at: view.at, at2: view.at2, min: view.min, max: view.max, steps, text: view.text, active: run.active, dragging: run.dragging };
  const placed = sliderPlacement(spec, view, steps, (role) => partNode('slider', role, spec.parts[role]));
  out.parts = placed.map((p) => makePart(sim, out, 'slider', p.role, p.node, `${p.role}${p.scope['slider.tick'] ?? ''}`, { ...p.scope, 'slider.dragging': run.dragging ? 1 : 0, ...stateOf(out) }, p.place, p.mount, depth, visible));
}

/** Set one thumb of a slider. `dragging` runs the "while it changes" actions only; otherwise the "when it has changed" ones as well. */
export function setSliderThumb(sim: Simulation, n: ViewNode, thumb: 1 | 2, value: number, phase: 'changing' | 'changed'): void {
  const info = n.slider;
  if (!info) return;
  const step = n.node.step > 0 ? n.node.step : 1;
  let v = snapSliderValue(info.spec, info.min, info.max, step, value);
  if (info.value2 !== null) v = thumb === 1 ? Math.min(v, info.value2) : Math.max(v, info.value);
  const target = thumb === 1 ? n.node.value : info.spec.value2;
  const before = thumb === 1 ? info.value : (info.value2 ?? info.value);
  if (target && (v !== before || phase === 'changed')) writeTarget(sim, target, Math.round(v * 1e6) / 1e6);
  if (thumb === 1) info.value = v;
  else info.value2 = v;
  if (v !== before) {
    sim.events.emit('ui-slider-changing', { widget: n.node.id, value: v });
    runList(sim, n, 'changing', { 'slider.value': v });
  }
  if (phase === 'changed') {
    sim.events.emit('ui-slider-changed', { widget: n.node.id, value: v });
    runList(sim, n, 'change', { 'slider.value': v });
  }
}

/** The keys and the pad on a focused slider: the mapped actions step it, holding repeats and speeds up, the second pair makes big steps. */
export function driveSliderKeys(sim: Simulation, n: ViewNode, dt = 1 / 60): boolean {
  const info = n.slider;
  if (!info || !n.enabled) return false;
  const run = sliderRun(sim, n.key);
  const ui = sim.uiInput;
  const spec = info.spec;
  let used = false;
  const table: ['less' | 'more' | 'bigLess' | 'bigMore', -1 | 1, boolean][] = [
    ['less', -1, false],
    ['more', 1, false],
    ['bigLess', -1, true],
    ['bigMore', 1, true],
  ];
  for (const [name, dir, big] of table) {
    const h = (run.holds[name] ??= { held: 0, next: 0 });
    const down = ui.down(spec.actions[name]);
    const k = holdSteps(h, down, dt, spec.holdDelay, spec.holdRate, spec.holdAccel);
    if (down) used = true;
    for (let i = 0; i < k; i++) {
      const thumb = info.value2 === null ? 1 : run.active;
      const current = thumb === 1 ? info.value : (info.value2 ?? info.value);
      setSliderThumb(sim, n, thumb, stepSliderValue(spec, info.min, info.max, n.node.step > 0 ? n.node.step : 1, current, dir, big), 'changed');
    }
  }
  return used;
}

/** The mouse wheel over a slider. */
export function wheelSlider(sim: Simulation, n: ViewNode, up: boolean): void {
  const info = n.slider;
  if (!info || !info.spec.wheel || !n.enabled) return;
  const thumb = info.value2 === null ? 1 : sliderRun(sim, n.key).active;
  const current = thumb === 1 ? info.value : (info.value2 ?? info.value);
  setSliderThumb(sim, n, thumb, stepSliderValue(info.spec, info.min, info.max, n.node.step > 0 ? n.node.step : 1, current, up ? 1 : -1, false), 'changed');
}

// ---------- pop-up lists ----------

export function popupSpecOf(node: UiNode): PopupSpec {
  return { ...POPUP_DEFAULTS, ...(node.popup ?? {}), parts: node.popup?.parts ?? {} };
}

const optionKey = (ownerKey: string, value: string): string => `${ownerKey}~opt#${value}`;
export { optionKey };

/** Every option of a choice list: a fixed list, the game's choices, or a row for each of a table or list source. */
function popupOptions(sim: Simulation, out: ViewNode, node: UiNode, spec: PopupSpec): PopupOption[] {
  const strings = sim.assets.strings;
  const fill = (text: string, d: string): string => (text ? fillValues(strings.t(text), sourceOf(sim)) : d);
  if (node.source && !node.source.startsWith('choices:')) {
    return rowsOf(sim, node).map((r) =>
      withScope(sim, { ...out.scope, ...r.scope }, () => {
        const value = fill(spec.value, r.id);
        const label = fill(spec.label, String(r.scope['row.name'] ?? r.scope['row.label'] ?? value));
        return { value, label, icon: fill(spec.icon, ''), detail: fill(spec.detail, ''), group: fill(spec.group, ''), scope: { ...r.scope } };
      }),
    );
  }
  return out.options.map((value, i) => ({ value, label: out.optionLabels[i] ?? value, icon: '', detail: '', group: '', scope: { index: i + 1 } }));
}

export function buildPopup(sim: Simulation, out: ViewNode, node: UiNode, depth: number, visible: boolean): void {
  const spec = popupSpecOf(node);
  const run = popupRun(sim, out.key);
  if (!out.visible || !out.enabled) run.open = false;
  const all = popupOptions(sim, out, node, spec).filter((o) => spec.filter === '' || withScope(sim, { ...out.scope, ...o.scope, 'option.value': o.value, 'option.label': o.label }, () => evalUiCondition(sourceOf(sim), spec.filter)));
  const raw = node.value ? readTarget(sim, node.value) : undefined;
  const chosen = spec.multi ? chosenValues(raw) : raw === undefined ? (all[0] ? [all[0].value] : []) : [String(raw)];
  out.choice = chosen[0] ?? '';
  const shownLabels = chosen.map((c) => all.find((o) => o.value === c)?.label ?? c);
  const text = chosen.length === 0 ? sim.assets.strings.t(spec.none) : chosen.length > 1 || (spec.multi && chosen.length !== 1) ? fillValues(sim.assets.strings.t(spec.manyText), { ...sourceOf(sim), vars: { ...sim.runtime.vars, count: chosen.length } }) : (shownLabels[0] ?? '');
  const filtered = spec.search ? filterOptions(all, run.query) : all;
  const listKey = `${out.key}~list`;
  out.engine = true;
  out.popup = { spec, open: run.open, query: run.query, options: filtered, all, chosen, highlight: run.highlight, text, listKey };
  const parts: ViewNode[] = [];
  const open = run.open ? 1 : 0;
  const boxNode = partNode('popup', 'box', spec.parts.box);
  if (boxNode) parts.push(makePart(sim, out, 'popup', 'box', boxNode, 'box', { 'popup.text': text, 'popup.open': open, 'popup.count': chosen.length, 'popup.query': run.query, ...stateOf(out) }, {}, 'content', depth, visible));
  const listNode = run.open && spec.place !== 'screen' ? partNode('popup', 'list', spec.parts.list) : null;
  if (listNode) {
    const list = makePart(sim, out, 'popup', 'list', listNode, 'list', { 'popup.text': text, 'popup.query': run.query, 'popup.count': filtered.length }, { maxRows: String(spec.maxRows) }, 'screen', depth, visible);
    list.key = listKey;
    const rows: ViewNode[] = [];
    const searchNode = spec.search ? partNode('popup', 'search', spec.parts.search) : null;
    if (searchNode) rows.push(makePart(sim, out, 'popup', 'search', searchNode, 'search', { 'popup.query': run.query }, {}, 'content', depth + 1, visible));
    let lastGroup: string | null = null;
    for (const o of filtered) {
      if (o.group && o.group !== lastGroup) {
        const g = partNode('popup', 'group', spec.parts.group);
        if (g) rows.push(makePart(sim, out, 'popup', 'group', g, `group#${o.group}`, { 'option.group': o.group }, {}, 'content', depth + 1, visible));
      }
      lastGroup = o.group;
      const optNode = partNode('popup', 'option', spec.parts.option);
      if (!optNode) continue;
      const scope: Scope = { ...o.scope, 'option.value': o.value, 'option.label': o.label, 'option.icon': o.icon, 'option.detail': o.detail, 'option.group': o.group, 'option.chosen': chosen.includes(o.value) ? 1 : 0, 'option.highlight': run.highlight === o.value ? 1 : 0 };
      const row = makePart(sim, out, 'popup', 'option', optNode, `opt#${o.value}`, scope, {}, 'content', depth + 1, visible, { kind: 'option', value: o.value });
      row.part!.mount = 'content';
      rows.push(row);
    }
    if (filtered.length === 0) {
      const e = partNode('popup', 'empty', spec.parts.empty);
      if (e) rows.push(makePart(sim, out, 'popup', 'empty', e, 'empty', {}, {}, 'content', depth + 1, visible));
    }
    list.children = [...list.children, ...rows];
    parts.push(list);
  }
  out.parts = parts;
  if (!run.open && sim.runtime.scratch.get('ui.popupScreenFor') === out.key) sim.runtime.scratch.delete('ui.popupScreenFor');
}

/** Open the list (and send the focus into it, to the chosen option). */
export function openPopup(sim: Simulation, n: ViewNode): void {
  const info = n.popup;
  if (!info || !n.enabled) return;
  closeAllPopups(sim);
  const run = popupRun(sim, n.key);
  run.open = true;
  run.query = '';
  run.returnTo = n.key;
  run.openedAt = sim.tick;
  run.highlight = info.chosen[0] ?? info.all[0]?.value ?? '';
  sim.events.emit('ui-popup-open', { widget: n.node.id });
  if (info.spec.place === 'screen' && info.spec.screen) {
    sim.runtime.scratch.set('ui.popupScreenFor', n.key);
    sim.runtime.scratch.set('ui.popupScreenOptions', info.all);
    sim.events.emit('ui-open-screen', { screen: info.spec.screen });
    return;
  }
  requestFocus(sim, optionKey(n.key, run.highlight));
}

export function closePopup(sim: Simulation, key: string, giveBackFocus = true): void {
  const run = popupRun(sim, key);
  if (!run.open) return;
  run.open = false;
  run.query = '';
  if (giveBackFocus) requestFocus(sim, run.returnTo || key);
  sim.events.emit('ui-popup-close', { widget: key });
}

/** The player chose an option: a single choice is written and the list closes; many choices are ticked on and off and the list stays. */
export function choosePopupOption(sim: Simulation, owner: ViewNode, value: string): void {
  const info = owner.popup;
  if (!info) return;
  const spec = info.spec;
  if (spec.multi) {
    const set = info.chosen.includes(value) ? info.chosen.filter((c) => c !== value) : [...info.chosen, value];
    if (owner.node.value) writeTarget(sim, owner.node.value, joinValues(set));
  } else {
    if (owner.node.value) writeTarget(sim, owner.node.value, value);
    closePopup(sim, owner.key);
  }
  sim.events.emit('ui-choice', { widget: owner.node.id, value });
  runList(sim, owner, 'change', { 'option.value': value });
}

/** Left and right on a closed box: the next or earlier option, without opening. */
export function stepPopup(sim: Simulation, n: ViewNode, delta: -1 | 1): boolean {
  const info = n.popup;
  if (!info || info.open || info.all.length === 0 || info.spec.multi) return false;
  const i = Math.max(0, info.all.findIndex((o) => o.value === info.chosen[0]));
  choosePopupOption(sim, n, info.all[(i + delta + info.all.length) % info.all.length]!.value);
  return true;
}

/** Search words typed into an open list. */
export function setPopupQuery(sim: Simulation, n: ViewNode, query: string): void {
  const info = n.popup;
  if (!info || !info.open || !info.spec.search) return;
  const run = popupRun(sim, n.key);
  run.query = query;
  const first = filterOptions(info.all, query)[0];
  run.highlight = first?.value ?? '';
  if (first) requestFocus(sim, optionKey(n.key, first.value));
}

/** The focus moved onto an option: it is the highlighted one. */
export function noteOptionFocus(sim: Simulation, v: ViewNode): void {
  if (v.act?.kind === 'option' && v.owner) popupRun(sim, v.owner.key).highlight = v.act.value;
}

/** Up or down in a list that is open (wrapping at the ends): the option that is highlighted next. */
export function highlightNext(sim: Simulation, n: ViewNode, delta: -1 | 1): string {
  const info = n.popup;
  if (!info) return '';
  const run = popupRun(sim, n.key);
  run.highlight = moveHighlight(info.options, run.highlight, delta);
  return run.highlight;
}

// ---------- text fields and number fields ----------

export const FIELD_DEFAULTS: FieldControl = { placeholder: '', maxLength: 40, allow: 'any', secret: false, min: 0, max: 100, step: 1, parts: {}, commit: [] };

export function fieldSpecOf(node: UiNode): FieldControl {
  return { ...FIELD_DEFAULTS, ...(node.field ?? {}), parts: node.field?.parts ?? {} };
}

export function buildField(sim: Simulation, out: ViewNode, node: UiNode, depth: number, visible: boolean): void {
  const spec = fieldSpecOf(node);
  const number = node.type === 'numberfield';
  const run = fieldRun(sim, out.key);
  if (!out.visible || !out.enabled) run.editing = false;
  const raw = node.value ? readTarget(sim, node.value) : undefined;
  const value = raw === undefined ? '' : String(raw);
  const shown = run.editing ? run.draft : value;
  const dots = spec.secret ? '•'.repeat([...shown].length) : shown;
  const caret = run.editing && Math.floor(sim.tick / 30) % 2 === 0 ? '▏' : run.editing ? ' ' : '';
  const text = `${dots}${caret}`;
  out.engine = true;
  out.field = { spec, editing: run.editing, draft: run.draft, text: dots, number };
  const scope: Scope = { 'field.text': text, 'field.value': value, 'field.empty': shown === '' && !run.editing ? 1 : 0, 'field.placeholder': sim.assets.strings.t(spec.placeholder), 'field.editing': run.editing ? 1 : 0, 'field.length': [...shown].length, 'field.max': spec.maxLength, ...stateOf(out) };
  const parts: ViewNode[] = [];
  const box = partNode('field', 'box', spec.parts.box);
  if (box) parts.push(makePart(sim, out, 'field', 'box', box, 'box', scope, {}, 'content', depth, visible));
  if (number) {
    const up = partNode('field', 'up', spec.parts.up);
    const down = partNode('field', 'down', spec.parts.down);
    if (up && spec.parts.up !== undefined) parts.push(makePart(sim, out, 'field', 'up', up, 'up', { ...scope, 'field.arrow': '▲' }, {}, 'content', depth, visible, { kind: 'step', delta: 1 }));
    if (down && spec.parts.down !== undefined) parts.push(makePart(sim, out, 'field', 'down', down, 'down', { ...scope, 'field.arrow': '▼' }, {}, 'content', depth, visible, { kind: 'step', delta: -1 }));
  }
  out.parts = parts;
}

export function startEditing(sim: Simulation, n: ViewNode): void {
  if (!n.field || !n.enabled) return;
  const raw = n.node.value ? readTarget(sim, n.node.value) : undefined;
  const run = fieldRun(sim, n.key);
  run.editing = true;
  run.draft = raw === undefined ? '' : String(raw);
}

export function typeInto(sim: Simulation, n: ViewNode, text: string): void {
  if (!n.field) return;
  const run = fieldRun(sim, n.key);
  run.draft = cleanTyped(text, n.field.number ? 'digits' : n.field.spec.allow, n.field.spec.maxLength);
}

/** Enter, or leaving the field: the words are kept (a number is made to fit its limits). */
export function commitEditing(sim: Simulation, n: ViewNode): void {
  if (!n.field) return;
  const run = fieldRun(sim, n.key);
  if (!run.editing) return;
  run.editing = false;
  let value: VariableValue = run.draft;
  if (n.field.number) {
    const parsed = parseNumberField(run.draft, n.field.spec.min, n.field.spec.max, n.field.spec.step);
    if (parsed === null) return; // not a number: the old value stays
    value = parsed;
  }
  if (n.node.value) writeTarget(sim, n.node.value, value);
  sim.events.emit('ui-field-committed', { widget: n.node.id, value });
  runList(sim, n, 'change', { 'field.value': value });
  if (n.field.spec.commit.length > 0) withScope(sim, { ...n.scope, 'field.value': value }, () => runActionList(contextOf(sim), n.field!.spec.commit as never));
}

export function cancelEditing(sim: Simulation, n: ViewNode): void {
  fieldRun(sim, n.key).editing = false;
}

/** Step a number field (the arrows, or left and right on it). */
export function stepNumberField(sim: Simulation, n: ViewNode, delta: -1 | 1): boolean {
  if (!n.field || !n.field.number || !n.enabled) return false;
  const spec = n.field.spec;
  const cur = num(n.node.value ? readTarget(sim, n.node.value) : 0);
  const next = snapSliderValue(SLIDER_DEFAULTS, spec.min, spec.max, spec.step, cur + delta * spec.step);
  if (n.node.value) writeTarget(sim, n.node.value, next);
  runList(sim, n, 'change', { 'field.value': next });
  return true;
}

// ---------- tick boxes, key bindings, tabs ----------

export function buildToggle(sim: Simulation, out: ViewNode, node: UiNode, depth: number, visible: boolean): void {
  const parts = node.parts ?? {};
  out.engine = true;
  const scope: Scope = { 'toggle.on': out.value, 'toggle.text': out.text, ...stateOf(out) };
  const box = partNode('toggle', 'box', parts.box);
  const label = partNode('toggle', 'label', parts.label);
  out.parts = [box ? makePart(sim, out, 'toggle', 'box', box, 'box', scope, {}, 'content', depth, visible) : null, label ? makePart(sim, out, 'toggle', 'label', label, 'label', scope, {}, 'content', depth, visible) : null].filter((x): x is ViewNode => x !== null);
}

export function buildKeybind(sim: Simulation, out: ViewNode, node: UiNode, bindingText: string, capturing: boolean, depth: number, visible: boolean): void {
  const parts = node.parts ?? {};
  out.engine = true;
  const scope: Scope = { 'bind.name': out.label || out.text, 'bind.key': capturing ? 'press a key…' : bindingText, 'bind.capturing': capturing ? 1 : 0, ...stateOf(out) };
  const name = partNode('keybind', 'name', parts.name);
  const key = partNode('keybind', 'key', parts.key);
  out.parts = [name ? makePart(sim, out, 'keybind', 'name', name, 'name', scope, {}, 'content', depth, visible) : null, key ? makePart(sim, out, 'keybind', 'key', key, 'key', scope, {}, 'content', depth, visible) : null].filter((x): x is ViewNode => x !== null);
}

export function buildTabs(sim: Simulation, out: ViewNode, node: UiNode, depth: number, visible: boolean): void {
  const parts = node.parts ?? {};
  out.engine = true;
  const tab = partNode('tabs', 'tab', parts.tab);
  if (!tab) return;
  out.parts = out.options.map((o, i) => makePart(sim, out, 'tabs', 'tab', tab, `tab#${o}`, { 'tab.name': o, 'tab.index': i + 1, 'tab.selected': o === out.choice ? 1 : 0, ...stateOf(out) }, {}, 'bar', depth, visible, { kind: 'tab', value: o }));
}

// ---------- scrollbars and edge indicators ----------

const px = (n: number): string => `${Math.round(n * 100) / 100}px`;

/**
 * Work out a scroller's values and its pieces: the bar (track, thumb, arrows, page marks) and the "more above / below" widgets. `count`
 * is how many rows it repeats.
 */
export function buildScroller(sim: Simulation, out: ViewNode, sc: Scroller, count: number, depth: number, visible: boolean): void {
  const st = scrollState(sim, out.key);
  const values: ScrollValues = scrollValues(sc, st, count);
  const main = mainAxis(sc);
  const m = st.metrics;
  const view = main === 'y' ? m.viewH : m.viewW;
  const content = main === 'y' ? m.contentH : m.contentW;
  const range = offsetRange(sc, content, view);
  const scrollable = range.max > range.min;
  const bar = sc.bar;
  const side = bar?.side ?? (main === 'y' ? 'right' : 'bottom');
  out.scroll = { scroller: sc, values, scrollable, recent: sim.tick - st.movedAt < 90 || st.dragging, dragging: st.dragging, side };
  const scope: Scope = { ...scrollScope(values), 'scroll.arrow': main === 'y' ? '▲' : '◀', 'scroll.scrollable': scrollable ? 1 : 0 };
  const parts: ViewNode[] = [];
  if (bar && bar.show !== 'never') {
    const vertical = side === 'right' || side === 'left';
    const size = bar.size;
    const arrow = bar.arrows ? size + 4 : 0;
    const trackPx = Math.max(1, (vertical ? m.viewH : m.viewW) - 2 * arrow);
    const t = thumbOf(st[vertical ? 'y' : 'x'].o, range, view, content, bar.thumb, bar.thumbSize, trackPx);
    const edge: Record<string, string> = vertical ? { [side]: '0', width: px(size) } : { [side]: '0', height: px(size) };
    const trackPlace = vertical ? { ...edge, top: px(arrow), bottom: px(arrow) } : { ...edge, left: px(arrow), right: px(arrow) };
    const along = (f: number): string => `calc(${px(arrow)} + (100% - ${px(2 * arrow)}) * ${Math.round(f * 10000) / 10000})`;
    const thumbPlace = vertical ? { ...edge, top: along(t.start), height: `calc((100% - ${px(2 * arrow)}) * ${Math.round(t.len * 10000) / 10000})` } : { ...edge, left: along(t.start), width: `calc((100% - ${px(2 * arrow)}) * ${Math.round(t.len * 10000) / 10000})` };
    const barScope: Scope = { ...scope, 'scroll.thumb': Math.round(t.start * 1000) / 1000, 'scroll.thumbLength': Math.round(t.len * 1000) / 1000 };
    const show = scrollable && visible;
    const track = partNode('scrollbar', 'track', bar.parts.track);
    const thumb = partNode('scrollbar', 'thumb', bar.parts.thumb);
    if (track) parts.push(makePart(sim, out, 'scrollbar', 'track', track, 'bar-track', barScope, trackPlace, 'overlay', depth, show));
    if (thumb) parts.push(makePart(sim, out, 'scrollbar', 'thumb', thumb, 'bar-thumb', barScope, thumbPlace, 'overlay', depth, show));
    if (bar.arrows) {
      const a0 = partNode('scrollbar', 'arrowStart', bar.parts.arrowStart);
      const a1 = partNode('scrollbar', 'arrowEnd', bar.parts.arrowEnd);
      const place0 = vertical ? { ...edge, top: '0', height: px(arrow) } : { ...edge, left: '0', width: px(arrow) };
      const place1 = vertical ? { ...edge, bottom: '0', height: px(arrow) } : { ...edge, right: '0', width: px(arrow) };
      if (a0) parts.push(makePart(sim, out, 'scrollbar', 'arrowStart', a0, 'bar-a0', { ...barScope, 'scroll.arrow': vertical ? '▲' : '◀' }, place0, 'overlay', depth, show, { kind: 'scroll', dir: -1 }));
      if (a1) parts.push(makePart(sim, out, 'scrollbar', 'arrowEnd', a1, 'bar-a1', { ...barScope, 'scroll.arrow': vertical ? '▼' : '▶' }, place1, 'overlay', depth, show, { kind: 'scroll', dir: 1 }));
    }
    if (bar.pageMarks) {
      const pg = partNode('scrollbar', 'page', bar.parts.page);
      if (pg) for (let i = 0; i < values.pages; i++) parts.push(makePart(sim, out, 'scrollbar', 'page', pg, `bar-page${i + 1}`, { ...barScope, 'scroll.pageIndex': i + 1, 'scroll.pageHere': i + 1 === values.page ? 1 : 0 }, vertical ? { ...edge, top: along(values.pages <= 1 ? 0 : i / (values.pages - 1)), width: px(size) } : { ...edge, left: along(values.pages <= 1 ? 0 : i / (values.pages - 1)), height: px(size) }, 'overlay', depth, show));
    }
  }
  const edgeOf = (which: 'before' | 'after'): void => {
    const spec = sc[which];
    if (!spec) return;
    const node = partNode('scroll', which, spec.prefab);
    if (!node) return;
    const hasMore = which === 'before' ? values.top === 0 : values.bottom === 0;
    const cond = spec.when ? withScope(sim, { ...out.scope, ...scope }, () => evalUiCondition(sourceOf(sim), spec.when)) : hasMore;
    const vertical = main === 'y';
    const place: Record<string, string> = vertical ? (which === 'before' ? { top: '0', left: '50%', transform: 'translateX(-50%)' } : { bottom: '0', left: '50%', transform: 'translateX(-50%)' }) : which === 'before' ? { left: '0', top: '50%', transform: 'translateY(-50%)' } : { right: '0', top: '50%', transform: 'translateY(-50%)' };
    const arrow = vertical ? (which === 'before' ? '▲' : '▼') : which === 'before' ? '◀' : '▶';
    parts.push(makePart(sim, out, 'scroll', which, node, `edge-${which}`, { ...scope, 'scroll.arrow': arrow }, place, 'overlay', depth, visible && cond));
  };
  edgeOf('before');
  edgeOf('after');
  out.parts = [...(out.parts ?? []), ...parts];
}
