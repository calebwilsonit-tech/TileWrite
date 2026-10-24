import { newWidget, type UiNode, type UiScreen, type UiStyle, type WidgetType } from '@tilewright/runtime';

/**
 * Small builders for the screens this plugin ships. They make ordinary designer screens (the same plain data the UI designer
 * saves), so a project can copy any of them and change anything. Nothing here is special to the engine.
 */

type Patch = Partial<UiNode>;

let counter = 0;
const node = (type: WidgetType, id: string, patch: Patch = {}): UiNode => ({ ...newWidget(type, id), ...patch });

/** Reset the numbering so building the same screen twice gives the same ids. */
export const resetIds = (): void => void (counter = 0);
export const nextId = (prefix: string): string => `${prefix}${++counter}`;

export const FOCUS: UiStyle = { fill: 'color-mix(in srgb, var(--tw-highlight) 25%, var(--tw-panel))', border: 'var(--tw-highlight)', borderWidth: 1 };

export const action = (type: string, params: Record<string, unknown> = {}): { type: string; params: Record<string, unknown> } => ({ type, params });
export const openScreen = (screen: string): ReturnType<typeof action> => action('uiScreen', { op: 'open', screen });
export const closeScreen = (screen: string): ReturnType<typeof action> => action('uiScreen', { op: 'close', screen });
export const goBack = (): ReturnType<typeof action> => action('uiScreen', { op: 'back', screen: '' });

export function text(id: string, words: string, patch: Patch = {}): UiNode {
  return node('text', id, { name: id, text: words, wMode: 'auto', hMode: 'auto', ...patch });
}

export function heading(id: string, words: string): UiNode {
  return text(id, words, { name: 'Heading', style: { color: 'var(--tw-accent)', fontSize: 22 }, padding: 0 });
}

export function hint(id: string, words: string): UiNode {
  return text(id, words, { name: 'Hint', style: { fontSize: 12, opacity: 0.7 } });
}

export const spacer = (id: string, patch: Patch = {}): UiNode => node('spacer', id, { name: 'Space', wMode: 'fill', hMode: 'auto', w: 8, h: 8, ...patch });

/** A row of a menu: words on the left, more words on the right, and something that happens when it is chosen. */
export function row(id: string, name: string, label: string, detail: string, click: ReturnType<typeof action>[], patch: Patch = {}): UiNode {
  return node('panel', id, {
    name,
    layout: 'row',
    wMode: 'fill',
    hMode: 'auto',
    align: 'center',
    padding: 7,
    gap: 14,
    style: { radius: 8 },
    states: { hover: FOCUS, focus: FOCUS, disabled: { opacity: 0.4 } },
    on: { click, hover: [], change: [] },
    children: [text(`${id}.label`, label, { name: 'Label' }), spacer(`${id}.gap`), text(`${id}.detail`, detail, { name: 'Detail', style: { opacity: 0.75, align: 'right' } })],
    ...patch,
  });
}

/** A row with a label and a control that fills the rest (a slider, a choice, a tick box). */
export function setting(id: string, name: string, label: string, control: UiNode, patch: Patch = {}): UiNode {
  return node('panel', id, {
    name,
    layout: 'row',
    wMode: 'fill',
    hMode: 'auto',
    align: 'center',
    padding: 7,
    gap: 14,
    style: { radius: 8 },
    children: [text(`${id}.label`, label, { name: 'Label' }), spacer(`${id}.gap`), control],
    ...patch,
  });
}

export const slider = (id: string, name: string, value: string, min: number, max: number, step: number): UiNode =>
  node('slider', id, { name, value, min, max: String(max), step, w: 220, wMode: 'fixed', h: 28, hMode: 'fixed', states: { focus: FOCUS } });

export const choice = (id: string, name: string, value: string, options: string, patch: Patch = {}): UiNode => node('dropdown', id, { name, value, options, w: 200, wMode: 'fixed', h: 30, hMode: 'fixed', states: { focus: FOCUS }, ...patch });

export const tickBox = (id: string, name: string, value: string): UiNode => node('toggle', id, { name, value, text: '', w: 40, wMode: 'auto', hMode: 'auto', states: { focus: FOCUS } });

export function repeat(id: string, name: string, source: string, template: UiNode, patch: Patch = {}): UiNode {
  return node('list', id, { name, source, layout: 'column', wMode: 'fill', hMode: 'auto', gap: 4, padding: 0, style: {}, children: [template], ...patch });
}

/** The box in the middle of a menu screen: a title, the rows, and a hint. */
export function menuScreen(
  o: { id: string; name: string; role: string; title?: UiNode; rows: UiNode[]; hint?: string; wide?: boolean; back?: UiScreen['back']; backTo?: string; dim?: number; opensOnStart?: boolean },
): UiScreen {
  const root = node('panel', `${o.id}.root`, { name: `${o.name} root`, anchor: 'fill', layout: 'free', style: {}, padding: 0 });
  const box = node('panel', `${o.id}.box`, {
    name: `${o.name} box`,
    anchor: 'c',
    w: o.wide ? 920 : 560,
    wMode: 'fixed',
    hMode: 'auto',
    layout: 'column',
    align: 'stretch',
    padding: 18,
    gap: 4,
    style: { fill: 'var(--tw-panel)', border: 'var(--tw-border)', borderWidth: 2, radius: 12, scroll: true, maxH: 86, themeScale: true },
    children: [...(o.title ? [o.title] : [heading(`${o.id}.title`, o.name)]), ...o.rows, ...(o.hint ? [hint(`${o.id}.hint`, o.hint)] : [])],
  });
  root.children = [box];
  return {
    id: o.id,
    name: o.name,
    root,
    modal: true,
    back: o.back ?? 'auto',
    backTo: o.backTo ?? '',
    priority: 0,
    dim: o.dim ?? 0.8,
    transition: 'none',
    mapX: 0,
    mapY: 0,
    opensOnStart: o.opensOnStart ?? false,
    role: o.role,
  };
}

export { node as widget };
