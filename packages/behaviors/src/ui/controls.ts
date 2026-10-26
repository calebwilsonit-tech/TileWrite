import { UiNodeSchema, type PopupSpec, type SliderSpec, type Simulation, type UiNode, type VariableValue } from '@tilewright/runtime';
import { holdSteps, type Hold } from './scrolling';

/**
 * The logic of the controls the engine draws itself: sliders, pop-up lists (drop-downs, context menus, pickers), text and number
 * fields, tick boxes, key bindings and tabs. Each is made of parts - ordinary widgets or UI prefabs - and these functions work out the
 * numbers the parts are given (`slider.fraction`, `option.chosen`...), where they go, and what the player's input changes. No
 * drawing here: the game draws the parts (screens-dom.ts), and the tests and the playbot read and press them directly.
 */

export type Scope = Record<string, VariableValue>;

// ---------- the state a control keeps (not saved) ----------

export interface SliderRun {
  /** Which thumb the keys move on a range slider (1 or 2). */
  active: 1 | 2;
  dragging: boolean;
  holds: Record<string, Hold>;
}
export interface PopupRun {
  open: boolean;
  query: string;
  /** The option the highlight is on (its value). */
  highlight: string;
  /** Where the focus goes back to on closing. */
  returnTo: string;
  openedAt: number;
}
export interface FieldRun {
  editing: boolean;
  /** The words as typed so far (committed to the variable on Enter or leaving). */
  draft: string;
}

const STORE = 'ui.controls';
interface Store {
  sliders: Map<string, SliderRun>;
  popups: Map<string, PopupRun>;
  fields: Map<string, FieldRun>;
}
function store(sim: Simulation): Store {
  let s = sim.runtime.scratch.get(STORE) as Store | undefined;
  if (!s) {
    s = { sliders: new Map(), popups: new Map(), fields: new Map() };
    sim.runtime.scratch.set(STORE, s);
  }
  return s;
}
export function sliderRun(sim: Simulation, key: string): SliderRun {
  const m = store(sim).sliders;
  let r = m.get(key);
  if (!r) {
    r = { active: 1, dragging: false, holds: {} };
    m.set(key, r);
  }
  return r;
}
export function popupRun(sim: Simulation, key: string): PopupRun {
  const m = store(sim).popups;
  let r = m.get(key);
  if (!r) {
    r = { open: false, query: '', highlight: '', returnTo: '', openedAt: -1 };
    m.set(key, r);
  }
  return r;
}
export function fieldRun(sim: Simulation, key: string): FieldRun {
  const m = store(sim).fields;
  let r = m.get(key);
  if (!r) {
    r = { editing: false, draft: '' };
    m.set(key, r);
  }
  return r;
}
/** The key of the pop-up list that is open, if any. */
export function openPopupKey(sim: Simulation): string {
  for (const [k, p] of store(sim).popups) if (p.open) return k;
  return '';
}
export const closeAllPopups = (sim: Simulation): void => {
  for (const p of store(sim).popups.values()) p.open = false;
};
/** The key of the field being typed in, if any. */
export function editingFieldKey(sim: Simulation): string {
  for (const [k, f] of store(sim).fields) if (f.editing) return k;
  return '';
}

/** The widget the screen should give the focus to next (a closed pop-up gives it back to its box). Read once. */
export function requestFocus(sim: Simulation, key: string): void {
  sim.runtime.scratch.set('ui.focusRequest', key);
}
export function takeFocusRequest(sim: Simulation): string {
  const k = (sim.runtime.scratch.get('ui.focusRequest') as string | undefined) ?? '';
  if (k) sim.runtime.scratch.delete('ui.focusRequest');
  return k;
}

// ---------- the built-in parts: only defaults, the designer replaces any of them ----------

const cache = new Map<string, UiNode>();
function builtin(id: string, patch: Record<string, unknown>): UiNode {
  let n = cache.get(id);
  if (!n) {
    n = UiNodeSchema.parse({ id: `builtin.${id}`, name: id, ...patch });
    cache.set(id, n);
  }
  return n;
}
const BOX = { fill: 'var(--tw-panel, #14161b)', border: 'var(--tw-border, #d9c6a0)', borderWidth: 2 } as const;

/** The built-in part for a role, or null when there is none (the parts a designer adds are all optional). */
export function builtinPart(kind: string, role: string): UiNode | null {
  switch (`${kind}.${role}`) {
    case 'slider.track':
      return builtin('slider.track', { w: 100, h: 8, wMode: 'fill', hMode: 'fixed', style: { ...BOX, borderWidth: 1, radius: 60 } });
    case 'slider.fill':
      return builtin('slider.fill', { w: 100, h: 8, hMode: 'fixed', style: { fill: 'var(--tw-accent, #ffd98a)', radius: 60 } });
    case 'slider.thumb':
    case 'slider.thumb2':
      return builtin(`slider.thumb`, { w: 18, h: 18, style: { fill: 'var(--tw-text, #f4efe6)', border: 'var(--tw-border, #d9c6a0)', borderWidth: 2, radius: 60, shadow: true }, states: { focus: { border: 'var(--tw-accent, #ffd98a)', borderWidth: 3 }, hover: { fill: 'var(--tw-highlight, #6aa8ff)' }, pressed: { fill: 'var(--tw-accent, #ffd98a)' }, disabled: { opacity: 0.4 } } });
    case 'slider.tick':
      return builtin('slider.tick', { w: 2, h: 12, style: { fill: 'var(--tw-border, #d9c6a0)' } });
    case 'slider.value':
      return builtin('slider.value', { type: 'text', text: '{slider.text}', wMode: 'auto', hMode: 'auto', style: { fontSize: 14 } });
    case 'scrollbar.track':
      return builtin('scrollbar.track', { w: 10, h: 100, wMode: 'fill', hMode: 'fill', style: { fill: '#0006', radius: 60 } });
    case 'scrollbar.thumb':
      return builtin('scrollbar.thumb', { w: 10, h: 40, wMode: 'fill', hMode: 'fill', style: { fill: 'var(--tw-border, #d9c6a0)', radius: 60 }, states: { hover: { fill: 'var(--tw-accent, #ffd98a)' }, pressed: { fill: 'var(--tw-accent, #ffd98a)' } } });
    case 'scrollbar.arrowStart':
    case 'scrollbar.arrowEnd':
      return builtin('scrollbar.arrow', { type: 'text', text: '{scroll.arrow}', wMode: 'auto', hMode: 'auto', style: { fontSize: 12 } });
    case 'scrollbar.page':
      return builtin('scrollbar.page', { w: 4, h: 4, style: { fill: 'var(--tw-border, #d9c6a0)', radius: 60 } });
    case 'scroll.before':
    case 'scroll.after':
      return builtin('scroll.edge', { type: 'text', text: '{scroll.arrow}', wMode: 'auto', hMode: 'auto', style: { fontSize: 14 } });
    case 'popup.box':
      return builtin('popup.box', { type: 'panel', w: 200, h: 32, wMode: 'fill', hMode: 'fixed', layout: 'row', align: 'center', padding: 6, style: BOX, states: { hover: { fill: 'var(--tw-highlight, #6aa8ff)' }, focus: { border: 'var(--tw-accent, #ffd98a)' }, disabled: { opacity: 0.4 } }, children: [{ id: 'builtin.popup.box.text', name: 'Chosen', type: 'text', text: '{popup.text}', wMode: 'fill', hMode: 'auto' }, { id: 'builtin.popup.box.arrow', name: 'Arrow', type: 'text', text: '▾', wMode: 'auto', hMode: 'auto' }] });
    case 'popup.list':
      return builtin('popup.list', { type: 'panel', w: 200, h: 120, wMode: 'fill', hMode: 'auto', layout: 'column', gap: 0, padding: 4, style: { ...BOX, radius: 6, shadow: true } });
    case 'popup.option':
      return builtin('popup.option', { type: 'panel', w: 200, h: 30, wMode: 'fill', hMode: 'fixed', layout: 'row', align: 'center', padding: 6, gap: 8, style: { radius: 4 }, states: { hover: { fill: 'var(--tw-highlight, #6aa8ff)' }, focus: { fill: 'var(--tw-highlight, #6aa8ff)' }, disabled: { opacity: 0.4 } }, children: [{ id: 'builtin.popup.option.mark', name: 'Chosen mark', type: 'text', text: '✓', wMode: 'auto', hMode: 'auto', visible: '{option.chosen} = 1' }, { id: 'builtin.popup.option.text', name: 'Option', type: 'text', text: '{option.label}', wMode: 'fill', hMode: 'auto' }, { id: 'builtin.popup.option.detail', name: 'Description', type: 'text', text: '{option.detail}', wMode: 'auto', hMode: 'auto', visible: '{option.detail}', style: { opacity: 0.7, fontSize: 12 } }] });
    case 'popup.group':
      return builtin('popup.group', { type: 'text', text: '{option.group}', wMode: 'fill', hMode: 'auto', style: { opacity: 0.7, fontSize: 12, bold: true } });
    case 'popup.search':
      return builtin('popup.search', { type: 'panel', w: 200, h: 28, wMode: 'fill', hMode: 'fixed', layout: 'row', align: 'center', padding: 6, style: { ...BOX, borderWidth: 1, radius: 4 }, children: [{ id: 'builtin.popup.search.text', name: 'Search', type: 'text', text: '🔍 {popup.query}', wMode: 'fill', hMode: 'auto' }] });
    case 'popup.empty':
      return builtin('popup.empty', { type: 'text', text: 'Nothing matches.', wMode: 'fill', hMode: 'auto', style: { opacity: 0.7 } });
    case 'toggle.box':
      return builtin('toggle.box', { type: 'panel', w: 22, h: 22, layout: 'column', align: 'center', padding: 0, style: { ...BOX, radius: 4 }, states: { hover: { fill: 'var(--tw-highlight, #6aa8ff)' }, focus: { border: 'var(--tw-accent, #ffd98a)' }, disabled: { opacity: 0.4 } }, children: [{ id: 'builtin.toggle.box.mark', name: 'Tick', type: 'text', text: '✓', wMode: 'auto', hMode: 'auto', visible: '{toggle.on} = 1', style: { align: 'center' } }] });
    case 'toggle.label':
      return builtin('toggle.label', { type: 'text', text: '{toggle.text}', wMode: 'auto', hMode: 'auto' });
    case 'field.box':
      return builtin('field.box', { type: 'panel', w: 200, h: 32, wMode: 'fill', hMode: 'fixed', layout: 'row', align: 'center', padding: 6, style: { ...BOX, radius: 4 }, states: { hover: { fill: 'var(--tw-highlight, #6aa8ff)' }, focus: { border: 'var(--tw-accent, #ffd98a)' }, pressed: { border: 'var(--tw-accent, #ffd98a)' }, disabled: { opacity: 0.4 } }, children: [{ id: 'builtin.field.box.text', name: 'Words', type: 'text', text: '{field.text}', wMode: 'auto', hMode: 'auto', visible: '{field.empty} = 0' }, { id: 'builtin.field.box.hint', name: 'Hint', type: 'text', text: '{field.placeholder}', wMode: 'auto', hMode: 'auto', visible: '{field.empty} = 1', style: { opacity: 0.5 } }] });
    case 'field.up':
    case 'field.down':
      return builtin('field.step', { type: 'text', text: '{field.arrow}', wMode: 'auto', hMode: 'auto', style: { fontSize: 14 } });
    case 'keybind.name':
      return builtin('keybind.name', { type: 'text', text: '{bind.name}', wMode: 'fill', hMode: 'auto' });
    case 'keybind.key':
      return builtin('keybind.key', { type: 'text', text: '{bind.key}', wMode: 'auto', hMode: 'auto', style: { opacity: 0.85 } });
    case 'tabs.tab':
      return builtin('tabs.tab', { type: 'panel', w: 90, h: 32, wMode: 'auto', hMode: 'fixed', layout: 'row', align: 'center', padding: 10, style: { ...BOX, radius: 6 }, states: { hover: { fill: 'var(--tw-highlight, #6aa8ff)' }, focus: { border: 'var(--tw-accent, #ffd98a)' } }, children: [{ id: 'builtin.tabs.tab.text', name: 'Tab', type: 'text', text: '{tab.name}', wMode: 'auto', hMode: 'auto' }] });
    default:
      return null;
  }
}

// ---------- sliders ----------

export const SLIDER_DEFAULTS: SliderSpec = {
  angle: 0,
  value2: '',
  snapPoints: '',
  curve: 'linear',
  curveTable: '',
  format: '',
  decimals: 0,
  bigStep: 0,
  actions: { less: 'move_left', more: 'move_right', bigLess: 'ui_page_up', bigMore: 'ui_page_down' },
  holdDelay: 0.4,
  holdRate: 10,
  holdAccel: 2,
  ticks: 'none',
  parts: {},
  wheel: true,
};

/** Numbers separated by commas or spaces. */
export const numberList = (text: string): number[] =>
  text
    .split(/[,;\s]+/)
    .filter((t) => t !== '')
    .map((t) => Number(t))
    .filter((n) => Number.isFinite(n));

/** The "position:value" pairs of a curve table, sorted, both from 0 to 1. */
export function curvePairs(text: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of text.split(',')) {
    const [a, b] = part.split(':').map((t) => Number(t.trim()));
    if (a !== undefined && b !== undefined && Number.isFinite(a) && Number.isFinite(b)) out.push([Math.max(0, Math.min(1, a)), Math.max(0, Math.min(1, b))]);
  }
  out.sort((p, q) => p[0] - q[0]);
  if (out.length === 0 || out[0]![0] > 0) out.unshift([0, 0]);
  if (out[out.length - 1]![0] < 1) out.push([1, 1]);
  return out;
}

const interp = (pairs: [number, number][], x: number): number => {
  for (let i = 1; i < pairs.length; i++) {
    const [x0, y0] = pairs[i - 1]!;
    const [x1, y1] = pairs[i]!;
    if (x <= x1) return x1 === x0 ? y1 : y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
  }
  return pairs[pairs.length - 1]![1];
};

/** Position on the track (0 to 1) to the value between min and max, by the slider's curve. */
export function sliderValueAt(spec: SliderSpec, min: number, max: number, f: number): number {
  const p = Math.max(0, Math.min(1, f));
  if (spec.curve === 'log') {
    if (min > 0 && max > min) return min * Math.pow(max / min, p);
    return min + ((max - min) * (Math.pow(1000, p) - 1)) / 999;
  }
  if (spec.curve === 'table') return min + (max - min) * interp(curvePairs(spec.curveTable), p);
  return min + (max - min) * p;
}

/** The value to the position on the track. */
export function sliderPositionOf(spec: SliderSpec, min: number, max: number, value: number): number {
  if (max <= min) return 0;
  const v = Math.max(min, Math.min(max, value));
  if (spec.curve === 'log') {
    if (min > 0) return Math.log(v / min) / Math.log(max / min);
    return Math.log(1 + ((v - min) / (max - min)) * 999) / Math.log(1000);
  }
  if (spec.curve === 'table') {
    const pairs = curvePairs(spec.curveTable).map(([a, b]) => [b, a] as [number, number]).sort((p, q) => p[0] - q[0]);
    return interp(pairs, (v - min) / (max - min));
  }
  return (v - min) / (max - min);
}

/** A value stuck to the steps (or to the snap points, when the slider has them), inside min and max. */
export function snapSliderValue(spec: SliderSpec, min: number, max: number, step: number, value: number): number {
  const points = numberList(spec.snapPoints).filter((p) => p >= min && p <= max);
  if (points.length > 0) return points.reduce((best, p) => (Math.abs(p - value) < Math.abs(best - value) ? p : best), points[0]!);
  const s = step > 0 ? step : 1;
  const v = Math.round((value - min) / s) * s + min;
  return Math.round(Math.max(min, Math.min(max, v)) * 1e6) / 1e6;
}

/** The next value up or down: the next snap point, or a step (a big step is `bigStep`, ten steps when it is not set). */
export function stepSliderValue(spec: SliderSpec, min: number, max: number, step: number, value: number, dir: -1 | 1, big: boolean): number {
  const points = numberList(spec.snapPoints)
    .filter((p) => p >= min && p <= max)
    .sort((a, b) => a - b);
  if (points.length > 0) {
    const next = dir > 0 ? points.find((p) => p > value + 1e-9) : [...points].reverse().find((p) => p < value - 1e-9);
    return next ?? (dir > 0 ? points[points.length - 1]! : points[0]!);
  }
  const size = big ? (spec.bigStep > 0 ? spec.bigStep : step * 10) : step;
  return snapSliderValue(spec, min, max, step, value + dir * size);
}

/** Where the pointer is along a slider's direction, 0 at the start of the track and 1 at the end. `rect` is the slider's box in pixels. */
export function pointerPosition(angle: number, rect: { w: number; h: number }, px: number, py: number): number {
  const a = (angle * Math.PI) / 180;
  const dx = Math.cos(a);
  const dy = Math.sin(a);
  const length = Math.abs(dx) * rect.w + Math.abs(dy) * rect.h;
  if (length <= 0) return 0;
  const cx = px - rect.w / 2;
  const cy = py - rect.h / 2;
  return Math.max(0, Math.min(1, (cx * dx + cy * dy) / length + 0.5));
}

/** The words a value is shown as ("{value}%"). */
export function formatSlider(spec: SliderSpec, value: number): string {
  const text = String(Math.round(value * 10 ** spec.decimals) / 10 ** spec.decimals);
  return spec.format ? spec.format.replace(/\{value\}/g, text) : text;
}

export interface SliderView {
  value: number;
  value2: number | null;
  /** Position on the track (0 to 1) of each thumb. */
  at: number;
  at2: number | null;
  text: string;
  text2: string;
  min: number;
  max: number;
  active: 1 | 2;
}

export function sliderView(spec: SliderSpec, min: number, max: number, value: number, value2: number | null, active: 1 | 2): SliderView {
  const lo = value2 === null ? value : Math.min(value, value2);
  const hi = value2 === null ? null : Math.max(value, value2);
  return { value: lo, value2: hi, at: sliderPositionOf(spec, min, max, lo), at2: hi === null ? null : sliderPositionOf(spec, min, max, hi), text: formatSlider(spec, lo), text2: hi === null ? '' : formatSlider(spec, hi), min, max, active };
}

/** The values parts of a slider can read. */
export function sliderScope(v: SliderView, dragging: boolean): Scope {
  return {
    'slider.value': v.value,
    'slider.value2': v.value2 ?? v.value,
    'slider.fraction': v.at,
    'slider.fraction2': v.at2 ?? v.at,
    'slider.percent': Math.round(v.at * 100),
    'slider.min': v.min,
    'slider.max': v.max,
    'slider.text': v.value2 === null ? v.text : `${v.text} - ${v.text2}`,
    'slider.text1': v.text,
    'slider.text2': v.text2,
    'slider.range': v.value2 === null ? 0 : 1,
    'slider.active': v.active,
    'slider.dragging': dragging ? 1 : 0,
  };
}

export interface Placed {
  role: string;
  node: UiNode;
  scope: Scope;
  place: Record<string, string>;
  mount: 'axis' | 'overlay';
}

const SLIDER_ROLES = new Set(['track', 'fill', 'thumb', 'thumb2', 'tick', 'value']);

const pct = (f: number): string => `${Math.round(f * 10000) / 100}%`;

/** The parts a slider is made of, with where each goes along the track (the track's own left-to-right: the slider turns it by its angle). */
export function sliderPlacement(spec: SliderSpec, v: SliderView, steps: number, pick: (role: string) => UiNode | null): Placed[] {
  const out: Placed[] = [];
  const base = sliderScope(v, false);
  const add = (role: string, place: Record<string, string>, extra: Scope = {}, mount: 'axis' | 'overlay' = 'axis'): void => {
    const node = pick(role);
    if (node) out.push({ role, node, scope: { ...base, ...extra }, place, mount });
  };
  add('track', { left: '0%', width: '100%', top: '50%', transform: 'translateY(-50%)' });
  const from = v.at2 === null ? 0 : v.at;
  const to = v.at2 === null ? v.at : v.at2;
  add('fill', { left: pct(from), width: pct(Math.max(0, to - from)), top: '50%', transform: 'translateY(-50%)' });
  if (spec.ticks !== 'none') {
    const positions =
      spec.ticks === 'points'
        ? numberList(spec.snapPoints).map((p) => sliderPositionOf(spec, v.min, v.max, p))
        : Array.from({ length: Math.min(200, steps) + 1 }, (_, i) => i / Math.max(1, Math.min(200, steps)));
    positions.forEach((p, i) => add('tick', { left: pct(p), top: '50%', transform: 'translate(-50%, -50%)' }, { 'slider.tick': i + 1, 'slider.tickAt': p }));
  }
  add('thumb', { left: pct(v.at), top: '50%', transform: 'translate(-50%, -50%)' }, { 'slider.thumb': 1, 'slider.isActive': v.active === 1 ? 1 : 0 });
  if (v.at2 !== null) add('thumb2', { left: pct(v.at2), top: '50%', transform: 'translate(-50%, -50%)' }, { 'slider.thumb': 2, 'slider.isActive': v.active === 2 ? 1 : 0 });
  // the value as words and any extras are the designer's to add: they are drawn only when a part is named for them ('' is the built-in one)
  if (spec.parts.value !== undefined) add('value', { right: '0', top: '-1.6em' }, {}, 'overlay');
  for (const role of Object.keys(spec.parts)) if (!SLIDER_ROLES.has(role)) add(role, { inset: '0' }, {}, 'overlay');
  return out;
}

// ---------- pop-up lists ----------

export const POPUP_DEFAULTS: PopupSpec = {
  place: 'below',
  screen: '',
  multi: false,
  search: false,
  value: '',
  label: '',
  icon: '',
  detail: '',
  group: '',
  stepClosed: true,
  open: 'interact',
  width: 'box',
  maxRows: 8,
  manyText: '{count} chosen',
  none: '',
  parts: {},
  filter: '',
  animOpen: 'fade',
  animClose: 'none',
};

export interface PopupOption {
  value: string;
  label: string;
  icon: string;
  detail: string;
  group: string;
  scope: Scope;
}

/** The options after the search words and the project's filter. */
export function filterOptions(options: PopupOption[], query: string): PopupOption[] {
  const q = query.trim().toLowerCase();
  if (!q) return options;
  return options.filter((o) => o.label.toLowerCase().includes(q) || o.detail.toLowerCase().includes(q) || o.group.toLowerCase().includes(q));
}

/** The values chosen on a multi-choice list (a comma-separated variable) and writing them back. */
export const chosenValues = (v: VariableValue | undefined): string[] =>
  v === undefined || v === '' || v === null
    ? []
    : String(v)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
export const joinValues = (list: string[]): string => list.join(',');

/** The next highlighted option, moving up or down (round the ends, or stopping at them). */
export function moveHighlight(options: PopupOption[], current: string, delta: -1 | 1, wrap = true): string {
  if (options.length === 0) return '';
  const i = options.findIndex((o) => o.value === current);
  if (i < 0) return options[delta > 0 ? 0 : options.length - 1]!.value;
  const j = i + delta;
  if (j < 0) return options[wrap ? options.length - 1 : 0]!.value;
  if (j >= options.length) return options[wrap ? 0 : options.length - 1]!.value;
  return options[j]!.value;
}

/** Where the list goes, from the box and the room there is: top and left of the list, and its width, all in pixels of the screen. Keeps it inside. */
export function placePopup(place: PopupSpec['place'], box: { x: number; y: number; w: number; h: number }, list: { w: number; h: number }, screen: { w: number; h: number }, width: 'box' | 'fit'): { x: number; y: number; w: number; flipped: boolean } {
  const w = width === 'box' ? box.w : Math.max(list.w, 1);
  const room = { below: screen.h - (box.y + box.h), above: box.y };
  let y = 0;
  let x = box.x;
  let flipped = false;
  if (place === 'centred') {
    x = (screen.w - w) / 2;
    y = (screen.h - list.h) / 2;
  } else if (place === 'beside') {
    x = box.x + box.w + 4 + w <= screen.w ? box.x + box.w + 4 : box.x - w - 4;
    y = box.y;
  } else if (place === 'above') {
    flipped = room.above < list.h && room.below > room.above;
    y = flipped ? box.y + box.h : box.y - list.h;
  } else {
    flipped = room.below < list.h && room.above > room.below;
    y = flipped ? box.y - list.h : box.y + box.h;
  }
  return { x: Math.max(0, Math.min(screen.w - w, x)), y: Math.max(0, Math.min(Math.max(0, screen.h - list.h), y)), w, flipped };
}

// ---------- fields ----------

const ALLOW: Record<string, RegExp> = { any: /./s, letters: /[\p{L} ]/u, digits: /[0-9.\-]/, name: /[\p{L}\p{N} _-]/u };

/** Keep only what the field allows, and no more than it holds. */
export function cleanTyped(text: string, allow: 'any' | 'letters' | 'digits' | 'name', max: number): string {
  const re = ALLOW[allow] ?? ALLOW.any!;
  return [...text].filter((c) => re.test(c)).slice(0, max).join('');
}

/** A number typed into a number field: inside min and max and on the step, or null when it is not a number. */
export function parseNumberField(text: string, min: number, max: number, step: number): number | null {
  const t = text.trim();
  if (t === '' || t === '-' || t === '.') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return snapSliderValue({ ...SLIDER_DEFAULTS }, min, max, step, n);
}

export { holdSteps };
