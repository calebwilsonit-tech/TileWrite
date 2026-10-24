import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION, type VariableValue } from '../project/schema';

/**
 * How the game's own screen looks: a theme (font, colours, roundness, size) and where each piece of the heads-up
 * display sits. Plain data in `assets/ui.json`. A piece placed on the "default" anchor stays where the game puts it;
 * any other anchor pins it to a corner, an edge or the middle of the screen with an offset.
 */

export const ANCHORS = ['default', 'tl', 'tc', 'tr', 'cl', 'c', 'cr', 'bl', 'bc', 'br'] as const;
export type Anchor = (typeof ANCHORS)[number];
export const ANCHOR_NAMES: Record<Anchor, string> = {
  default: 'where the game puts it',
  tl: 'top left',
  tc: 'top middle',
  tr: 'top right',
  cl: 'middle left',
  c: 'middle',
  cr: 'middle right',
  bl: 'bottom left',
  bc: 'bottom middle',
  br: 'bottom right',
};

export const FONTS = {
  serif: "Georgia, 'Times New Roman', serif",
  sans: "'Segoe UI', Roboto, Arial, sans-serif",
  mono: "Consolas, 'Courier New', monospace",
  rounded: "'Trebuchet MS', 'Segoe UI', sans-serif",
} as const;
export type FontName = keyof typeof FONTS;

const Colour = z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Colours look like #ffd98a');

export const UiThemeSchema = z.object({
  font: z.enum(['serif', 'sans', 'mono', 'rounded']).default('serif'),
  text: Colour.default('#f4efe6'),
  accent: Colour.default('#ffd98a'),
  panel: Colour.default('#14161b'),
  border: Colour.default('#d9c6a0'),
  highlight: Colour.default('#6aa8ff'),
  /** Roundness of panels, boxes and slots in pixels. */
  radius: z.number().min(0).max(28).default(10),
  /** Size of the menus, conversation box and every piece of the heads-up display. */
  scale: z.number().min(0.75).max(2).default(1),
});
export type UiTheme = z.infer<typeof UiThemeSchema>;

export const BUILTIN_WIDGETS = ['hearts', 'lightbar', 'slots', 'bosses', 'toasts'] as const;
export const WIDGET_KINDS = [...BUILTIN_WIDGETS, 'counter', 'bar', 'text'] as const;
export type WidgetKind = (typeof WIDGET_KINDS)[number];
export const WIDGET_NAMES: Record<WidgetKind, string> = {
  hearts: 'Hearts',
  lightbar: 'Light bar',
  slots: 'Quick slots',
  bosses: 'Boss health bars',
  toasts: 'Messages',
  counter: 'Counter (a label and a number)',
  bar: 'Bar (fills as a number grows)',
  text: 'Text (with {variables})',
};

export const UiWidgetSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{1,32}$/, 'Names use letters, numbers, - and _'),
  kind: z.enum(WIDGET_KINDS),
  anchor: z.enum(ANCHORS).default('default'),
  /** Distance in pixels from the anchor's edge (or from the middle for a middle anchor). */
  x: z.number().int().min(-2000).max(2000).default(0),
  y: z.number().int().min(-2000).max(2000).default(0),
  scale: z.number().min(0.5).max(3).default(1),
  visible: z.boolean().default(true),
  // the game's own pieces (counter, bar, text)
  label: z.string().default(''),
  /** The flag or counter shown. */
  variable: z.string().default(''),
  /** A bar is full at this number (or at the number in `maxVariable`). */
  max: z.number().min(1).default(10),
  maxVariable: z.string().default(''),
  color: Colour.default('#6aa8ff'),
  text: z.string().default(''),
});
export type UiWidget = z.infer<typeof UiWidgetSchema>;

export const UiLayoutSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  theme: UiThemeSchema.default(UiThemeSchema.parse({})),
  widgets: z.array(UiWidgetSchema).default([]),
});
export type UiLayout = z.infer<typeof UiLayoutSchema>;

export const builtinWidget = (kind: (typeof BUILTIN_WIDGETS)[number]): UiWidget => UiWidgetSchema.parse({ id: kind, kind });

/** The layout of a game that never opened the editor: the game's own pieces where the game puts them. */
export function defaultUiLayout(): UiLayout {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, theme: UiThemeSchema.parse({}), widgets: BUILTIN_WIDGETS.map(builtinWidget) };
}

/** The layout with every built-in piece present (a file that left one out still shows it). */
export function completeLayout(l: UiLayout | null | undefined): UiLayout {
  const base = l ?? defaultUiLayout();
  const have = new Set(base.widgets.map((w) => w.kind));
  const missing = BUILTIN_WIDGETS.filter((k) => !have.has(k)).map(builtinWidget);
  return { ...base, widgets: [...base.widgets, ...missing] };
}

/** A fresh counter, bar or text for the editor's "add" buttons, with an id nobody uses yet. */
export function newCustomWidget(kind: 'counter' | 'bar' | 'text', taken: readonly string[]): UiWidget {
  let n = 1;
  while (taken.includes(`${kind}${n}`)) n++;
  const label = kind === 'counter' ? 'Coins' : kind === 'bar' ? 'Progress' : '';
  return UiWidgetSchema.parse({ id: `${kind}${n}`, kind, anchor: 'tr', x: 12, y: 12 + 30 * (n - 1), label, text: kind === 'text' ? 'Coins: {coins}' : '' });
}

/** CSS custom properties for a theme (set on the game's root element). */
export function themeVars(t: UiTheme): Record<string, string> {
  return {
    '--tw-font': FONTS[t.font],
    '--tw-text': t.text,
    '--tw-accent': t.accent,
    '--tw-panel': t.panel,
    '--tw-border': t.border,
    '--tw-highlight': t.highlight,
    '--tw-radius': `${t.radius}px`,
    '--tw-scale': String(t.scale),
  };
}

const horizontal = (a: Anchor): 'l' | 'c' | 'r' => (a.endsWith('l') ? 'l' : a.endsWith('r') ? 'r' : 'c');
const vertical = (a: Anchor): 't' | 'c' | 'b' => (a.startsWith('t') ? 't' : a.startsWith('b') ? 'b' : 'c');

/**
 * Where a piece sits, as CSS (the game and the editor's preview both use this, so they agree). A piece on the default
 * anchor only gets its size. Offsets are measured inward from the anchor's edge; the middle uses the offset from the centre.
 */
export function widgetCss(w: Pick<UiWidget, 'anchor' | 'x' | 'y' | 'scale'>, themeScale = 1): Record<string, string> {
  const size = w.scale * themeScale;
  if (w.anchor === 'default') return size === 1 ? {} : { zoom: String(size) };
  const h = horizontal(w.anchor);
  const v = vertical(w.anchor);
  const css: Record<string, string> = { position: 'absolute', 'align-self': 'auto', width: 'max-content' };
  let tx = '0';
  let ty = '0';
  if (h === 'l') css.left = `${w.x}px`;
  else if (h === 'r') css.right = `${w.x}px`;
  else {
    css.left = `calc(50% + ${w.x}px)`;
    tx = '-50%';
  }
  if (v === 't') css.top = `${w.y}px`;
  else if (v === 'b') css.bottom = `${w.y}px`;
  else {
    css.top = `calc(50% + ${w.y}px)`;
    ty = '-50%';
  }
  css.transform = `translate(${tx}, ${ty}) scale(${size})`;
  css['transform-origin'] = `${h === 'l' ? 'left' : h === 'r' ? 'right' : 'center'} ${v === 't' ? 'top' : v === 'b' ? 'bottom' : 'center'}`;
  return css;
}

/** Which of the nine places a point on the screen is closest to (as fractions of the screen). */
export function anchorAt(fx: number, fy: number): Exclude<Anchor, 'default'> {
  const col = fx < 1 / 3 ? 'l' : fx > 2 / 3 ? 'r' : 'c';
  const row = fy < 1 / 3 ? 't' : fy > 2 / 3 ? 'b' : 'c';
  if (row === 'c' && col === 'c') return 'c';
  if (row === 'c') return `c${col}` as 'cl' | 'cr';
  return `${row}${col}` as Exclude<Anchor, 'default' | 'c' | 'cl' | 'cr'>;
}

/**
 * The offsets that put a piece whose box has its top left at (left, top) and size (w, h) on a screen of size
 * (w, h) when pinned to `anchor`. This is the opposite of `widgetCss`, so dragging in the editor lands where it shows.
 */
export function offsetsFor(anchor: Exclude<Anchor, 'default'>, box: { left: number; top: number; w: number; h: number }, screen: { w: number; h: number }): { x: number; y: number } {
  const h = horizontal(anchor);
  const v = vertical(anchor);
  const x = h === 'l' ? box.left : h === 'r' ? screen.w - (box.left + box.w) : box.left + box.w / 2 - screen.w / 2;
  const y = v === 't' ? box.top : v === 'b' ? screen.h - (box.top + box.h) : box.top + box.h / 2 - screen.h / 2;
  return { x: Math.round(x), y: Math.round(y) };
}

/** Put `{name}` in a text as the value of that flag or counter. */
export function fillVariables(text: string, vars: Record<string, VariableValue>): string {
  return text.replace(/\{([A-Za-z0-9_:.-]+)\}/g, (_m, name: string) => {
    const v = vars[name];
    return v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 100) / 100) : String(v);
  });
}

/** Mistakes in the interface layout, in plain English. */
export function checkUiLayout(l: UiLayout, known: { variables?: ReadonlySet<string> } = {}): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const unknown = (name: string): boolean => !!known.variables && known.variables.size > 0 && !known.variables.has(name);
  for (const w of l.widgets) {
    if (ids.has(w.id)) out.push(`Two pieces of the screen are both called "${w.id}".`);
    ids.add(w.id);
    const name = (BUILTIN_WIDGETS as readonly string[]).includes(w.kind) ? WIDGET_NAMES[w.kind] : `"${w.label || w.id}"`;
    if (w.kind === 'counter' || w.kind === 'bar') {
      if (w.variable === '') out.push(`${name} has no flag or counter chosen, so it would always show 0.`);
      else if (unknown(w.variable)) out.push(`${name} shows "${w.variable}", which nothing in your game ever sets.`);
    }
    if (w.kind === 'text' && w.text.trim() === '') out.push(`${name} has no words in it.`);
    if (w.kind === 'text') for (const m of w.text.matchAll(/\{([A-Za-z0-9_:.-]+)\}/g)) if (unknown(m[1]!)) out.push(`${name} shows {${m[1]}}, which nothing in your game ever sets.`);
  }
  const shown = (kind: string): boolean => l.widgets.some((w) => w.kind === kind && w.visible);
  if (!shown('hearts')) out.push('The hearts are hidden, so the player cannot see their health.');
  if (!shown('toasts')) out.push('Messages are hidden, so "Received an item" and other notices will not be seen.');
  return out;
}
