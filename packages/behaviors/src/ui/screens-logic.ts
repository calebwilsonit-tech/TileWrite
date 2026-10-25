import {
  evalUiCondition,
  evalValue,
  fillValues,
  resolveValue,
  writeCell,
  type Entity,
  type Simulation,
  type UiNode,
  type UiScreen,
  type ValueSource,
  type VariableValue,
} from '@tilewright/runtime';
import { placeState, type SlotInfo } from '@tilewright/runtime';
import { runActionList } from '../events/sheet';
import { host } from '../plugins/host';
import { contextOf } from '../story/context';

/**
 * The thinking part of the interface screens, with no pictures: it turns a screen's widgets into a tree of what is on show
 * right now (texts filled in, lists expanded into their rows, hidden things marked), and it does what clicking, ticking and
 * sliding mean. The game draws the tree; the playbot and the tests read and click it directly.
 */

/** What the host (the editor's Play, an exported game) lets the screens read and change: settings, key bindings. */
export interface UiBridge {
  getSetting(key: string): VariableValue | undefined;
  setSetting(key: string, value: VariableValue): void;
  /** Wait for the next key or button and bind it to this action. */
  rebind?(action: string): void;
  /** The key or button an action is bound to, as words. */
  bindingText?(action: string): string;
  /** The picture of a sprite as an image address, for image widgets and icons. */
  spriteUrl?(name: string): string | null;
  /** The save slots as last read (the list source "saves"); the host reads them again when asked. */
  saves?(): SlotInfo[];
  /** Read the save slots again (called when a screen with a list of saves opens). */
  refreshSaves?(): void;
  /** The controls the Controls screen lists (the list source "controls"): action id and its name. */
  controls?(): { action: string; label: string }[];
  /** The game's name and the line under it, while the title screen is up (null otherwise). */
  title?(): { text: string; subtitle: string } | null;
  /** Words for what the host can do, so a screen can hide what it cannot ("fullscreen", "quit"). */
  can?(what: string): boolean;
  /** The languages, appearances and so on a settings choice offers: name -> [value, shown name] pairs. */
  choices?(what: string): { value: string; label: string }[];
}

const BRIDGE = 'ui.bridge';
export const setUiBridge = (sim: Simulation, bridge: UiBridge | null): void => void (bridge ? sim.runtime.scratch.set(BRIDGE, bridge) : sim.runtime.scratch.delete(BRIDGE));
export const uiBridge = (sim: Simulation): UiBridge | undefined => sim.runtime.scratch.get(BRIDGE) as UiBridge | undefined;

const sourceOf = (sim: Simulation): ValueSource => ({ vars: sim.runtime.vars, tables: sim.assets.tables, world: sim.world });

/** The value a widget reads: a variable, `settings.music`, a table cell, an object field. */
export function readTarget(sim: Simulation, name: string): VariableValue | undefined {
  const n = name.trim().replace(/^\{(.*)\}$/, '$1');
  if (n.startsWith('settings.')) return uiBridge(sim)?.getSetting(n.slice(9));
  return resolveValue(sourceOf(sim), n);
}

export function writeTarget(sim: Simulation, name: string, value: VariableValue): void {
  const n = name.trim().replace(/^\{(.*)\}$/, '$1');
  if (!n) return;
  if (n.startsWith('settings.')) return uiBridge(sim)?.setSetting(n.slice(9), value);
  if (n.includes('.') && !n.startsWith('@') && !(n in sim.runtime.vars) && writeCell(sim.assets.tables, sim.runtime.tableEdits, n, value)) return;
  sim.runtime.vars[n] = value;
}

/** Run something with extra named values in view (the row a list is on), and put everything back afterwards. */
export function withScope<T>(sim: Simulation, scope: Record<string, VariableValue>, run: () => T): T {
  const vars = sim.runtime.vars;
  const before = new Map<string, VariableValue | undefined>();
  for (const [k, v] of Object.entries(scope)) {
    before.set(k, vars[k]);
    vars[k] = v;
  }
  try {
    return run();
  } finally {
    for (const [k, v] of before) {
      if (v === undefined) delete vars[k];
      else vars[k] = v;
    }
  }
}

// ---------- the tree of what is on show ----------

export interface ViewNode {
  /** Unique within a screen: the widget's id, with "#row" added for every repeat. */
  key: string;
  node: UiNode;
  /** The values in view for this widget and everything under it (row.*, item.*, unit.*, index). */
  scope: Record<string, VariableValue>;
  text: string;
  visible: boolean;
  enabled: boolean;
  /** Bars: the number. Sliders: the number. Toggles: 1 or 0. */
  value: number;
  max: number;
  fraction: number;
  /** Choice lists and tabs: the choice now, and all the choices. */
  choice: string;
  options: string[];
  /** What each choice is called when it is shown (the same as `options` unless the choices come from the game). */
  optionLabels: string[];
  tooltip: string;
  /** The second text (a key binding's control name), filled in. */
  label: string;
  /** The table row behind a repeat (for dragging cells onto each other). */
  row?: { table: string; id: string };
  children: ViewNode[];
}

const num = (v: VariableValue | undefined, d = 0): number => (typeof v === 'number' ? v : typeof v === 'boolean' ? (v ? 1 : 0) : Number.isFinite(Number(v)) && v !== '' && v !== undefined ? Number(v) : d);

function expandInstance(sim: Simulation, node: UiNode): UiNode {
  if (node.type !== 'instance') return node;
  const prefab = sim.assets.ui.prefabs.find((p) => p.name === node.prefab);
  if (!prefab) return { ...node, type: 'spacer', children: [] };
  const copy = structuredClone(prefab.widget);
  const merged: UiNode = {
    ...copy,
    id: node.id,
    name: node.name,
    anchor: node.anchor,
    x: node.x,
    y: node.y,
    ...(node.wMode !== 'auto' ? { w: node.w, wMode: node.wMode } : {}),
    ...(node.hMode !== 'auto' ? { h: node.h, hMode: node.hMode } : {}),
    visible: node.visible || copy.visible,
    enabled: node.enabled || copy.enabled,
    on: node.on.click.length + node.on.change.length + node.on.hover.length > 0 ? node.on : copy.on,
    focus: node.focus,
  };
  const apply = (w: UiNode): void => {
    const over = node.overrides[w.name];
    if (over) Object.assign(w, structuredClone(over));
    w.children.forEach(apply);
  };
  apply(merged);
  return merged;
}

interface Row {
  id: string;
  scope: Record<string, VariableValue>;
  table?: string;
}

/** What the screens may ask about the host, as values in view (`{host.quit}`, `{game.title}`) while a screen is worked out. */
export function hostScope(sim: Simulation): Record<string, VariableValue> {
  const b = uiBridge(sim);
  const saves = (b?.saves?.() ?? []).filter((s) => s.exists && !s.damaged).sort((a, c) => c.savedAt.localeCompare(a.savedAt));
  const title = b?.title?.() ?? null;
  return {
    'host.quit': b?.can?.('quit') ? 1 : 0,
    'host.fullscreen': b?.can?.('fullscreen') ? 1 : 0,
    'host.skins': b?.choices?.('skin').length ?? 0,
    'host.languages': b?.choices?.('language').length ?? 0,
    'host.hasSave': saves.length > 0 ? 1 : 0,
    'host.latestSave': saves[0]?.label ?? '',
    'host.titleOpen': title ? 1 : 0,
    'game.title': title?.text ?? '',
    'game.subtitle': title?.subtitle ?? '',
    'map.title': sim.assets.strings.t(sim.assets.worldMap?.title || 'Map'),
    ...Object.fromEntries([...host.ext.widgets.keys()].map((id) => [`part.${id}`, 1])),
  };
}

/** The repeats of a list, grid, hand or turn bar: one per row of its source. */
export function rowsOf(sim: Simulation, node: UiNode): Row[] {
  const src = node.type === 'turnOrder' && node.source === '' ? 'turns' : node.source;
  if (src.startsWith('table:')) {
    const name = src.slice(6);
    const t = sim.assets.tables.get(name);
    return (t?.rows ?? []).map((r, i) => {
      const scope: Record<string, VariableValue> = { 'row.id': r.id, index: i + 1 };
      for (const c of t!.columns) scope[`row.${c.id}`] = (r[c.id] ?? '') as VariableValue;
      return { id: r.id, scope, table: name };
    });
  }
  if (src.startsWith('slots:')) {
    const n = Math.max(0, Math.min(200, Math.floor(Number(src.slice(6)) || 0)));
    return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), scope: { slot: i + 1, index: i + 1 } }));
  }
  if (src === 'turns') {
    const t = sim.runtime.turns;
    return (t.active ? t.order : []).map((live, i) => {
      const e = sim.world.get(live);
      const hp = e?.get<{ hp: number }>('state:health')?.hp ?? 0;
      return { id: String(live), scope: { 'unit.name': e?.name ?? '?', 'unit.team': (e?.get<{ team?: string }>('turnTaker')?.team ?? '') as string, 'unit.active': i === t.index ? 1 : 0, 'unit.hp': hp, index: i + 1 } };
    });
  }
  if (src === 'saves') {
    const list = uiBridge(sim)?.saves?.() ?? [];
    const when = (s: SlotInfo): string => s.savedAt.slice(0, 16).replace('T', ' ');
    return list.map((s, i) => ({
      id: s.slot,
      scope: {
        'save.slot': s.slot,
        'save.name': s.slot === 'autosave' ? sim.assets.strings.t('Autosave') : sim.assets.strings.fmt(sim.assets.strings.t('Slot {n}'), { n: s.slot.replace('slot', '') }),
        'save.detail': s.damaged ? sim.assets.strings.t('damaged') : s.exists ? [s.label, when(s)].filter(Boolean).join(' - ') : sim.assets.strings.t('empty'),
        'save.exists': s.exists ? 1 : 0,
        'save.damaged': s.damaged ? 1 : 0,
        'save.manual': s.slot === 'autosave' ? 0 : 1,
        'save.scene': s.scene,
        index: i + 1,
      },
    }));
  }
  if (src === 'controls') {
    const b = uiBridge(sim);
    return (b?.controls?.() ?? []).map((c, i) => ({ id: c.action, scope: { 'control.action': c.action, 'control.label': c.label, 'control.binding': b?.bindingText?.(c.action) ?? '', index: i + 1 } }));
  }
  if (src === 'places') {
    const map = sim.assets.worldMap;
    if (!map) return [];
    const custom = (kind: string, node: Parameters<typeof placeState>[0]): boolean => host.ext.unlockRules.get(kind)?.met(sim.runtime.vars, node) ?? false;
    return map.nodes
      .map((node) => ({ node, state: placeState(node, sim.runtime.vars, sim.runtime.scene, custom) }))
      .filter((p) => p.state === 'open' || p.state === 'here')
      .map((p, i) => ({ id: p.node.id, scope: { 'place.id': p.node.id, 'place.name': p.node.label, 'place.scene': p.node.scene, 'place.here': p.state === 'here' ? 1 : 0, 'place.hint': p.state === 'here' ? sim.assets.strings.t('you are here') : '', 'place.x': p.node.x, 'place.y': p.node.y, index: i + 1 } }));
  }
  if (src.startsWith('menu:')) {
    const menu = src.slice(5);
    return [...host.ext.menuEntries.values()]
      .filter((e) => e.menu === menu && (e.show?.(sim) ?? true))
      .sort((a, b) => (a.order ?? 50) - (b.order ?? 50) || a.id.localeCompare(b.id))
      .map((e, i) => ({ id: e.id, scope: { 'entry.id': e.id, 'entry.label': sim.assets.strings.t(e.label), 'entry.detail': e.detail ? sim.assets.strings.t(e.detail(sim)) : '', 'entry.opens': `role:${e.opens}`, index: i + 1 } }));
  }
  if (src.startsWith('choices:')) {
    return (uiBridge(sim)?.choices?.(src.slice(8)) ?? []).map((c, i) => ({ id: c.value, scope: { 'choice.value': c.value, 'choice.label': c.label, index: i + 1 } }));
  }
  {
    const colon = src.indexOf(':');
    const def = host.ext.listSources.get(colon < 0 ? src : src.slice(0, colon));
    if (def) {
      try {
        return def.rows(sim, colon < 0 ? '' : src.slice(colon + 1)).map((r, i) => ({ id: r.id, scope: { index: i + 1, ...r.scope } }));
      } catch {
        return []; // the plugin's failure is recorded against it by the host; the screen just shows no rows
      }
    }
  }
  if (src.startsWith('var:')) {
    const n = Math.max(0, Math.min(200, Math.floor(num(readTarget(sim, src.slice(4))))));
    return Array.from({ length: n }, (_, i) => ({ id: String(i + 1), scope: { index: i + 1 } }));
  }
  return [];
}

const REPEATERS = new Set(['list', 'grid', 'hand', 'turnOrder']);

function resolveNode(sim: Simulation, raw: UiNode, key: string, scope: Record<string, VariableValue>, depth: number, parentVisible = true): ViewNode {
  const node = expandInstance(sim, raw);
  return withScope(sim, scope, () => {
    const src = sourceOf(sim);
    const strings = sim.assets.strings;
    const visible = parentVisible && evalUiCondition(src, node.visible);
    const enabled = evalUiCondition(src, node.enabled);
    const options = node.options
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    const out: ViewNode = {
      key,
      node,
      scope,
      text: fillValues(strings.t(node.text), src),
      visible,
      enabled,
      value: 0,
      max: 1,
      fraction: 0,
      choice: '',
      options,
      optionLabels: options,
      tooltip: node.tooltip ? fillValues(strings.t(node.tooltip), src) : '',
      label: node.label ? fillValues(strings.t(node.label), src) : '',
      children: [],
    };
    if (node.type === 'bar' || node.type === 'slider') {
      out.value = node.value ? num(readTarget(sim, node.value)) : 0;
      out.max = Math.max(node.type === 'slider' ? node.min + 1e-9 : 1e-9, num(evalValue(src, node.max), 100));
      out.fraction = Math.max(0, Math.min(1, (out.value - (node.type === 'slider' ? node.min : 0)) / (out.max - (node.type === 'slider' ? node.min : 0) || 1)));
    } else if (node.type === 'toggle') {
      const v = node.value ? readTarget(sim, node.value) : undefined;
      out.value = v === true || (typeof v === 'number' && v !== 0) || v === 'true' || v === 'on' ? 1 : 0;
    } else if (node.type === 'dropdown') {
      if (node.source.startsWith('choices:')) {
        const list = uiBridge(sim)?.choices?.(node.source.slice(8)) ?? [];
        out.options = list.map((c) => c.value);
        out.optionLabels = list.map((c) => strings.t(c.label));
      }
      const v = node.value ? readTarget(sim, node.value) : undefined;
      out.choice = v === undefined ? (out.options[0] ?? '') : String(v);
    } else if (node.type === 'tabs') {
      const chosen = sim.runtime.ui.tabs[key] ?? options[0] ?? '';
      out.choice = options.includes(chosen) ? chosen : (options[0] ?? '');
    }
    if (depth > 12) return out;
    if (REPEATERS.has(node.type)) {
      const template = node.template ? instanceStub(`${node.id}.t`, node.template) : (node.children[0] ?? (node.type === 'turnOrder' ? TURN_CHIP : undefined));
      if (template) {
        const rows = rowsOf(sim, node);
        if (rows.length === 0 && node.empty) out.children = [resolveNode(sim, { ...instanceStub(`${node.id}.empty`, ''), type: 'text', name: 'Empty', text: node.empty, wMode: 'auto', hMode: 'auto' }, `${key}#empty`, scope, depth + 1, visible)];
        else out.children = rows.map((r) => {
          const child = template;
          const vn = resolveNode(sim, child, `${key}#${r.id}`, { ...scope, ...r.scope }, depth + 1, visible);
          if (r.table) vn.row = { table: r.table, id: r.id };
          return vn;
        });
      }
    } else if (node.type === 'tabs') {
      out.children = node.children.map((c, i) => resolveNode(sim, c, `${key}/${c.id}`, scope, depth + 1, visible && options[i] === out.choice));
    } else {
      out.children = node.children.map((c) => resolveNode(sim, c, `${key}/${c.id}`, scope, depth + 1, visible));
    }
    return out;
  });
}

/** What a turn order bar repeats when nothing else is chosen: the unit's name in a box that lights up on its turn. */
const TURN_CHIP: UiNode = {
  ...instanceStub('turnchip', ''),
  type: 'panel',
  name: 'Unit',
  w: 96,
  h: 40,
  wMode: 'fixed',
  hMode: 'fixed',
  anchor: 'tl',
  style: { fill: 'var(--tw-panel)', border: 'var(--tw-border)', borderWidth: 2, radius: 8, align: 'center' },
  layout: 'column',
  align: 'center',
  children: [{ ...instanceStub('turnchip.name', ''), type: 'text', name: 'Unit name', text: '{unit.name}', wMode: 'auto', hMode: 'auto' }],
};

function instanceStub(id: string, prefab: string): UiNode {
  return { id, name: 'item', type: 'instance', prefab, anchor: 'tl', x: 0, y: 0, w: 0, h: 0, wMode: 'auto', hMode: 'auto', layout: 'free', gap: 0, padding: 0, align: 'start', columns: 1, style: {}, states: {}, anim: [], text: '', sprite: '', value: '', max: '100', min: 0, step: 1, options: '', source: '', template: '', drag: false, visible: '', enabled: '', on: { click: [], hover: [], change: [] }, focus: { up: '', down: '', left: '', right: '' }, tooltip: '', overrides: {}, marks: '', children: [] };
}

/** What a screen shows right now. */
export function resolveScreen(sim: Simulation, screen: UiScreen): ViewNode {
  return resolveNode(sim, screen.root, screen.root.id, hostScope(sim), 0);
}

/** Every open screen, bottom first. */
export function openScreens(sim: Simulation): { screen: UiScreen; view: ViewNode }[] {
  const out: { screen: UiScreen; view: ViewNode }[] = [];
  for (const name of sim.runtime.ui.stack) {
    const screen = sim.assets.ui.screens.find((s) => s.name === name);
    if (screen) out.push({ screen, view: resolveScreen(sim, screen) });
  }
  return out;
}

export function walkView(v: ViewNode, fn: (n: ViewNode) => void): void {
  fn(v);
  for (const c of v.children) walkView(c, fn);
}

export function findView(v: ViewNode, match: (n: ViewNode) => boolean): ViewNode | null {
  let found: ViewNode | null = null;
  walkView(v, (n) => {
    if (!found && match(n)) found = n;
  });
  return found;
}

/** Find a widget on the open screens by its name or id (the playbot and tests click things this way). */
export function findOnScreens(sim: Simulation, nameOrId: string): ViewNode | null {
  for (const { view } of [...openScreens(sim)].reverse()) {
    const hit = findView(view, (n) => n.visible && (n.node.name === nameOrId || n.node.id === nameOrId || n.text === nameOrId));
    if (hit) return hit;
  }
  return null;
}

// ---------- interface attached to objects ----------

/** The values an object's own interface can read: `self.name`, `self.health.hp`, any simple setting of any part. */
export function selfScope(e: Entity): Record<string, VariableValue> {
  const scope: Record<string, VariableValue> = { 'self.name': e.name };
  let n = 0;
  for (const [comp, value] of e.components) {
    if (comp === 'meta' || typeof value !== 'object' || value === null) continue;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if ((typeof v === 'number' || typeof v === 'string' || typeof v === 'boolean') && n++ < 80) scope[`self.${comp.replace(/^state:/, '')}.${k}`] = v;
    }
  }
  const hp = e.get<{ hp?: number }>('state:health')?.hp;
  if (hp !== undefined) scope['self.hp'] = hp;
  const max = e.get<{ max?: number }>('health')?.max;
  if (max !== undefined) scope['self.maxhp'] = max;
  return scope;
}

export interface WorldUiView {
  entity: Entity;
  view: ViewNode;
  /** Cells above the object's feet. */
  height: number;
}

/** The interface that floats over objects with the World UI behaviour (health bars, speech bubbles, prices, prompts). */
export function worldViews(sim: Simulation): WorldUiView[] {
  const out: WorldUiView[] = [];
  const player = sim.world.withTag('player')[0]?.get<{ x: number; y: number }>('transform');
  for (const e of sim.world.query('worldUi')) {
    const s = { prefab: '', height: 1.4, showWhen: '', maxDistance: 0, ...(e.get<Record<string, unknown>>('worldUi') ?? {}) } as { prefab: string; height: number; showWhen: string; maxDistance: number };
    if (!s.prefab || !sim.assets.ui.prefabs.some((p) => p.name === s.prefab)) continue;
    const t = e.get<{ x: number; y: number }>('transform');
    if (s.maxDistance > 0 && player && t && Math.hypot(player.x - t.x, player.y - t.y) > s.maxDistance) continue;
    const scope = selfScope(e);
    const shown = withScope(sim, scope, () => evalUiCondition(sourceOf(sim), s.showWhen));
    if (!shown) continue;
    out.push({ entity: e, view: resolveNode(sim, instanceStub(`world${e.id}`, s.prefab), `world${e.id}`, scope, 0), height: s.height });
  }
  return out;
}

// ---------- doing things ----------

const INTERACTIVE = new Set(['button', 'toggle', 'slider', 'dropdown', 'keybind', 'tabs']);

/** Can the player aim at it with a key or a gamepad? */
export function isFocusable(n: ViewNode): boolean {
  return n.visible && n.enabled && (INTERACTIVE.has(n.node.type) || n.node.on.click.length > 0 || (n.node.type === 'grid' && false));
}

/**
 * The buttons the interface takes this tick: "interact" when a screen has the keyboard focus on a widget that is still there, because
 * that press will activate the widget and must not also make the game talk to whoever is standing nearby.
 */
export function claimedButtons(snapshot: Readonly<Record<string, number>>, focusKey: string, focusableKeys: ReadonlySet<string>): string[] {
  return (snapshot.interact ?? 0) > 0 && focusKey !== '' && focusableKeys.has(focusKey) ? ['interact'] : [];
}

export function focusables(view: ViewNode): ViewNode[] {
  const out: ViewNode[] = [];
  walkView(view, (n) => {
    if (isFocusable(n) && n.visible) out.push(n);
  });
  return out;
}

function run(sim: Simulation, n: ViewNode, which: 'click' | 'hover' | 'change'): void {
  const actions = n.node.on[which];
  if (actions.length === 0) return;
  withScope(sim, n.scope, () => runActionList(contextOf(sim), actions as never));
}

/** The player clicked, pressed or confirmed on a widget. */
export function activateWidget(sim: Simulation, n: ViewNode): void {
  if (!n.visible || !n.enabled) return;
  sim.events.emit('ui-click', { widget: n.node.id, name: n.node.name, key: n.key });
  switch (n.node.type) {
    case 'toggle':
      if (n.node.value) writeTarget(sim, n.node.value, n.value === 0);
      run(sim, n, 'change');
      break;
    case 'keybind':
      uiBridge(sim)?.rebind?.(n.text);
      break;
    case 'dropdown': {
      const i = n.options.indexOf(n.choice);
      if (n.options.length > 0) setChoice(sim, n, n.options[(i + 1) % n.options.length]!);
      break;
    }
    default:
      break;
  }
  run(sim, n, 'click');
}

/** Left or right on a widget with Change actions (a row of settings, an item's quick slot): they run with `{delta}` set to -1 or 1. */
export function adjustWidget(sim: Simulation, n: ViewNode, delta: -1 | 1): boolean {
  if (!n.visible || !n.enabled || n.node.on.change.length === 0 || n.node.type === 'slider') return false;
  withScope(sim, { ...n.scope, delta }, () => runActionList(contextOf(sim), n.node.on.change as never));
  return true;
}

/**
 * Left or right on a choice (a drop-down) or a tick box: the next or the earlier option, wrapping round, and a tick box flips. The
 * menus always did this (a row of settings changes with the arrow keys and the pad). Returns whether anything changed.
 */
export function stepWidget(sim: Simulation, n: ViewNode, delta: -1 | 1): boolean {
  if (!n.visible || !n.enabled) return false;
  if (n.node.type === 'dropdown' && n.options.length > 0) {
    const i = Math.max(0, n.options.indexOf(n.choice));
    setChoice(sim, n, n.options[(i + delta + n.options.length) % n.options.length]!);
    return true;
  }
  if (n.node.type === 'toggle') {
    if (n.node.value) writeTarget(sim, n.node.value, n.value === 0);
    run(sim, n, 'change');
    return true;
  }
  return false;
}

export function setSlider(sim: Simulation, n: ViewNode, value: number): void {
  const step = n.node.step > 0 ? n.node.step : 1;
  const stepped = Math.round((value - n.node.min) / step) * step + n.node.min;
  const v = Math.max(n.node.min, Math.min(n.node.min + (n.max - n.node.min), stepped));
  if (n.node.value) writeTarget(sim, n.node.value, Math.round(v * 1000) / 1000);
  run(sim, n, 'change');
}

export function setChoice(sim: Simulation, n: ViewNode, choice: string): void {
  if (n.node.type === 'tabs') sim.runtime.ui.tabs[n.key] = choice;
  else if (n.node.value) writeTarget(sim, n.node.value, choice);
  run(sim, n, 'change');
}

export function hover(sim: Simulation, n: ViewNode): void {
  run(sim, n, 'hover');
}

/** Drag one cell of a grid onto another: the two table rows trade everything but their ids. Returns whether anything moved. */
export function swapRows(sim: Simulation, table: string, a: string, b: string): boolean {
  if (a === b) return false;
  const t = sim.assets.tables.get(table);
  if (!t || !t.rows.some((r) => r.id === a) || !t.rows.some((r) => r.id === b)) return false;
  const ra = t.rows.find((r) => r.id === a)!;
  const rb = t.rows.find((r) => r.id === b)!;
  const rows = t.rows.map((r) => {
    if (r.id === a) return { ...rb, id: a };
    if (r.id === b) return { ...ra, id: b };
    return r;
  });
  sim.assets.tables.set(table, { ...t, rows });
  sim.runtime.tableEdits[table] = rows;
  sim.events.emit('ui-swap', { table, from: a, to: b });
  return true;
}

// ---------- keys and gamepads ----------

/** The neighbour a widget names in a direction (by widget id), if it is on show. */
export function explicitNeighbour(view: ViewNode, from: ViewNode, dir: 'up' | 'down' | 'left' | 'right'): ViewNode | null {
  const id = from.node.focus[dir];
  if (!id) return null;
  return findView(view, (n) => n.node.id === id && isFocusable(n));
}

/**
 * Give every focusable widget the arrows to its neighbours from the way its container lays its children out: down and up in
 * a column, left and right in a row, all four in a grid. Returns the screen with the `focus` fields filled in.
 */
export function autoFocus(root: UiNode): UiNode {
  const copy = structuredClone(root);
  const focusableType = (w: UiNode): boolean => INTERACTIVE.has(w.type) || w.on.click.length > 0;
  const firstFocusable = (w: UiNode): UiNode | null => {
    if (focusableType(w)) return w;
    for (const c of w.children) {
      const f = firstFocusable(c);
      if (f) return f;
    }
    return null;
  };
  const lastFocusable = (w: UiNode): UiNode | null => {
    for (const c of [...w.children].reverse()) {
      const f = lastFocusable(c);
      if (f) return f;
    }
    return focusableType(w) ? w : null;
  };
  const visit = (w: UiNode): void => {
    const kids = w.children.filter((c) => !c.visible || true);
    const rep = kids.map((c) => ({ c, first: firstFocusable(c), last: lastFocusable(c) })).filter((x) => x.first);
    if (w.layout === 'column' || w.layout === 'row') {
      const prev = w.layout === 'column' ? 'up' : 'left';
      const next = w.layout === 'column' ? 'down' : 'right';
      rep.forEach((x, i) => {
        const before = rep[i - 1];
        const after = rep[i + 1];
        if (before?.last && x.first) x.first.focus[prev] = before.last.id;
        if (after?.first && x.last) x.last.focus[next] = after.first.id;
      });
    } else if (w.layout === 'grid') {
      const cols = Math.max(1, w.columns);
      rep.forEach((x, i) => {
        const at = (j: number): UiNode | null | undefined => rep[j]?.first;
        if (!x.first) return;
        if (i % cols > 0 && at(i - 1)) x.first.focus.left = at(i - 1)!.id;
        if (i % cols < cols - 1 && at(i + 1)) x.first.focus.right = at(i + 1)!.id;
        if (at(i - cols)) x.first.focus.up = at(i - cols)!.id;
        if (at(i + cols)) x.first.focus.down = at(i + cols)!.id;
      });
    }
    for (const c of w.children) visit(c);
  };
  visit(copy);
  return copy;
}
