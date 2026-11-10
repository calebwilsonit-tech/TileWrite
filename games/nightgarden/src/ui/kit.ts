import { newWidget, type UiNode, type UiScreen, type UiStyle, type WidgetType } from '@tilewright/runtime';

/**
 * The pieces every Nightgarden screen is made of. The numbers and colours here are the ones in DESIGN.md, section 5
 * ("The interface"): read that before changing anything in this file. Screens never write a colour or a size of their own.
 */

/** The theme of the game (assets/ui.json). */
export const THEME = { font: 'rounded', text: '#e6ecff', accent: '#ffd76a', panel: '#141826', border: '#343b5c', highlight: '#f2a93b', radius: 10, scale: 1 } as const;

/** Colours of the interface: the theme's (as CSS variables, so changing the theme changes every screen) and the four plain ones. */
export const COLOR = {
  panel: 'var(--tw-panel)',
  border: 'var(--tw-border)',
  text: 'var(--tw-text)',
  accent: 'var(--tw-accent)',
  highlight: 'var(--tw-highlight)',
  dim: '#8f96b3',
  done: '#55a868',
  firefly: '#ffd76a',
  locked: '#5b6384',
} as const;

/** The five type sizes. */
export const TYPE = { title: 40, heading: 26, row: 18, body: 15, hint: 12 } as const;
/** Spacing, in fours. */
export const SPACE = { rowGap: 4, rowPad: 8, group: 12, box: 20, edge: 16 } as const;
export const RADIUS = { box: 10, row: 8, chip: 6 } as const;
export const MENU_WIDTH = 480;
export const WIDE_WIDTH = 880;

const BOX_FILL = 'color-mix(in srgb, var(--tw-panel) 94%, transparent)';
const CHIP_FILL = 'color-mix(in srgb, var(--tw-panel) 80%, transparent)';
const FOCUS: UiStyle = { fill: 'color-mix(in srgb, var(--tw-highlight) 22%, var(--tw-panel))', border: COLOR.highlight, borderWidth: 1 };

type Patch = Partial<UiNode>;
export type Act = { type: string; params: Record<string, unknown> };

export const widget = (type: WidgetType, id: string, patch: Patch = {}): UiNode => ({ ...newWidget(type, id), name: id, ...patch });
export const act = (type: string, params: Record<string, unknown> = {}): Act => ({ type, params });
export const open = (screen: string): Act => act('uiScreen', { op: 'open', screen });
export const close = (screen: string): Act => act('uiScreen', { op: 'close', screen });
export const back = (): Act => act('uiScreen', { op: 'back', screen: '' });

export const words = (id: string, text: string, size: number = TYPE.body, patch: Patch = {}): UiNode =>
  widget('text', id, { text, wMode: 'auto', hMode: 'auto', padding: 0, ...patch, style: { fontSize: size, ...(patch.style ?? {}) } });

export const heading = (id: string, text: string): UiNode => words(id, text, TYPE.heading, { name: 'Heading', style: { color: COLOR.accent } });
export const sub = (id: string, text: string, patch: Patch = {}): UiNode => words(id, text, TYPE.hint, { name: 'Subtitle', ...patch, style: { color: COLOR.dim, ...(patch.style ?? {}) } });
export const hint = (id: string, text: string): UiNode => words(id, text, TYPE.hint, { name: 'Hint', style: { color: COLOR.dim } });
export const space = (id: string, h: number = SPACE.group): UiNode => widget('spacer', id, { name: 'Space', wMode: 'fill', hMode: 'fixed', w: 8, h });
const grow = (id: string): UiNode => widget('spacer', id, { name: 'Space', wMode: 'fill', hMode: 'auto', w: 8, h: 8 });

/** A line of a menu: words on the left, quieter words on the right, something that happens when it is chosen. */
export function row(id: string, label: string, click: Act[], opts: { detail?: string; visible?: string; enabled?: string } = {}): UiNode {
  return widget('panel', id, {
    name: label.replace(/[{}]/g, '') || id,
    layout: 'row',
    wMode: 'fill',
    hMode: 'auto',
    align: 'center',
    padding: SPACE.rowPad,
    gap: SPACE.group,
    style: { radius: RADIUS.row },
    states: { hover: FOCUS, focus: FOCUS, disabled: { opacity: 0.4 } },
    on: { click, hover: [], change: [] },
    visible: opts.visible ?? '',
    enabled: opts.enabled ?? '',
    children: [words(`${id}.label`, label, TYPE.row, { name: 'Label' }), grow(`${id}.gap`), ...(opts.detail ? [words(`${id}.detail`, opts.detail, TYPE.hint, { name: 'Detail', style: { color: COLOR.dim, align: 'right' } })] : [])],
  });
}

/** A line with a label and a control (a slider, a tick box). */
export function setting(id: string, label: string, control: UiNode, visible = ''): UiNode {
  return widget('panel', id, { name: label, layout: 'row', wMode: 'fill', hMode: 'auto', align: 'center', padding: SPACE.rowPad, gap: SPACE.group, style: { radius: RADIUS.row }, visible, children: [words(`${id}.label`, label, TYPE.row, { name: 'Label' }), grow(`${id}.gap`), control] });
}

export const slider = (id: string, name: string, value: string, min: number, max: number, step: number): UiNode =>
  widget('slider', id, { name, value, min, max: String(max), step, w: 200, wMode: 'fixed', h: 28, hMode: 'fixed', states: { focus: FOCUS } });
export const tick = (id: string, name: string, value: string): UiNode => widget('toggle', id, { name, value, text: '', w: 40, wMode: 'auto', hMode: 'auto', states: { focus: FOCUS } });

/** The box of a menu: a heading, an optional line under it, the rows, and the hint that says the keys. */
export function box(id: string, title: string, rows: UiNode[], opts: { subtitle?: string; hint: string; wide?: boolean; titleNode?: UiNode } ): UiNode {
  return widget('panel', `${id}.box`, {
    name: `${title} box`,
    anchor: 'c',
    w: opts.wide ? WIDE_WIDTH : MENU_WIDTH,
    wMode: 'fixed',
    hMode: 'auto',
    layout: 'column',
    align: 'stretch',
    padding: SPACE.box,
    gap: SPACE.rowGap,
    style: { fill: BOX_FILL, border: COLOR.border, borderWidth: 2, radius: RADIUS.box, scroll: true, maxH: 88, themeScale: true },
    anim: [{ on: 'show', kind: 'fade', ms: 150, dir: 'up' }],
    children: [opts.titleNode ?? heading(`${id}.title`, title), ...(opts.subtitle ? [sub(`${id}.sub`, opts.subtitle)] : []), space(`${id}.top`), ...rows, space(`${id}.bottom`), hint(`${id}.hint`, opts.hint)],
  });
}

/** A menu screen: the game waits, the buttons belong to it, Back leaves it. */
export function menu(o: { id: string; name: string; role?: string; box: UiNode; back?: UiScreen['back']; dim?: number }): UiScreen {
  const root = widget('panel', `${o.id}.root`, { name: `${o.name} root`, anchor: 'fill', layout: 'free', style: {}, padding: 0, children: [o.box] });
  return { id: o.id, name: o.name, root, modal: true, back: o.back ?? 'auto', backTo: '', priority: 0, dim: o.dim ?? 0.86, transition: 'fade', mapX: 0, mapY: 0, opensOnStart: false, ...(o.role ? { role: o.role } : {}) };
}

/** A chip of the heads-up display: a small dark pill with words in it. */
export function chip(id: string, children: UiNode[], patch: Patch = {}): UiNode {
  return widget('panel', id, { layout: 'row', wMode: 'auto', hMode: 'auto', align: 'center', gap: 8, padding: 8, ...patch, style: { fill: CHIP_FILL, radius: RADIUS.chip, themeScale: true, ...(patch.style ?? {}) }, children });
}
