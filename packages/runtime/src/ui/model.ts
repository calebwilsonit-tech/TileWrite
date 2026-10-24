import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION } from '../project/schema';

/**
 * The UI designer's document: screens made of widgets, reusable UI prefabs, and the map of how screens lead to each other.
 * Plain data in `assets/screens.json`. Everything is optional with a sensible default, so a widget written by hand or by the
 * assistant only needs the fields it cares about.
 */

export const WIDGET_TYPES = [
  'panel',
  'text',
  'button',
  'image',
  'bar',
  'slider',
  'toggle',
  'dropdown',
  'keybind',
  'list',
  'grid',
  'tabs',
  'minimap',
  'hand',
  'turnOrder',
  'spacer',
  'instance',
  'plugin',
] as const;
export type WidgetType = (typeof WIDGET_TYPES)[number];

export const WIDGET_LABELS: Record<WidgetType, string> = {
  panel: 'Panel (a box that holds other things)',
  text: 'Text',
  button: 'Button',
  image: 'Image (a sprite)',
  bar: 'Bar (health, progress, resources)',
  slider: 'Slider (a number the player sets)',
  toggle: 'Tick box (on or off)',
  dropdown: 'Choice list (pick one of several)',
  keybind: 'Key binding (press to change a control)',
  list: 'List (repeats a piece for every row of a table)',
  grid: 'Grid (slots for an inventory, drag and drop)',
  tabs: 'Tabs (pages the player switches between)',
  minimap: 'Minimap',
  hand: 'Card hand (a fan of cards from a table)',
  turnOrder: 'Turn order bar (whose turn is next)',
  spacer: 'Spacer (empty room)',
  instance: 'UI prefab (a reusable piece)',
  plugin: 'Plugin widget (a kind of widget a plugin added)',
};

/** Where in its parent a widget is pinned. */
export const UI_ANCHORS = ['tl', 't', 'tr', 'l', 'c', 'r', 'bl', 'b', 'br', 'fill'] as const;
export type UiAnchor = (typeof UI_ANCHORS)[number];
export const UI_ANCHOR_NAMES: Record<UiAnchor, string> = {
  tl: 'top left',
  t: 'top middle',
  tr: 'top right',
  l: 'middle left',
  c: 'middle',
  r: 'middle right',
  bl: 'bottom left',
  b: 'bottom middle',
  br: 'bottom right',
  fill: 'fill the whole parent',
};

const Css = z.string().max(40);

/** How a widget looks. Every field is optional: what is missing comes from the theme (or from the normal look of the state). */
export const UiStyleSchema = z.object({
  fill: Css.optional(),
  border: Css.optional(),
  borderWidth: z.number().min(0).max(20).optional(),
  radius: z.number().min(0).max(60).optional(),
  color: Css.optional(),
  fontSize: z.number().min(6).max(120).optional(),
  bold: z.boolean().optional(),
  align: z.enum(['left', 'center', 'right']).optional(),
  opacity: z.number().min(0).max(1).optional(),
  shadow: z.boolean().optional(),
});
export type UiStyle = z.infer<typeof UiStyleSchema>;

export const UiAnimSchema = z.object({
  on: z.enum(['show', 'hide', 'hover', 'click']),
  kind: z.enum(['fade', 'slide', 'pop', 'pulse']),
  ms: z.number().min(50).max(3000).default(200),
  dir: z.enum(['left', 'right', 'up', 'down']).default('up'),
});
export type UiAnim = z.infer<typeof UiAnimSchema>;

const ActionSchema = z.object({ type: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) });

export const UiFocusSchema = z.object({
  up: z.string().default(''),
  down: z.string().default(''),
  left: z.string().default(''),
  right: z.string().default(''),
});
export type UiFocus = z.infer<typeof UiFocusSchema>;

const Num = (d: number): z.ZodDefault<z.ZodNumber> => z.number().default(d);
const Actions = z.array(ActionSchema).default([]);

export const UiNodeSchema = z.object({
  id: z.string().min(1),
  name: z.string().default('Widget'),
  type: z.enum(WIDGET_TYPES).default('panel'),
  anchor: z.enum(UI_ANCHORS).default('tl'),
  x: Num(0),
  y: Num(0),
  w: Num(120),
  h: Num(40),
  /** fixed uses w / h pixels, auto fits the contents, fill takes the room left in a row or column. */
  wMode: z.enum(['fixed', 'auto', 'fill']).default('fixed'),
  hMode: z.enum(['fixed', 'auto', 'fill']).default('fixed'),
  /** How the children are arranged: free pins each by its anchor; the others stack them. */
  layout: z.enum(['free', 'row', 'column', 'grid']).default('free'),
  gap: Num(8),
  padding: Num(8),
  align: z.enum(['start', 'center', 'end', 'stretch']).default('start'),
  columns: Num(3),
  style: UiStyleSchema.prefault({}),
  states: z.object({ hover: UiStyleSchema.optional(), pressed: UiStyleSchema.optional(), disabled: UiStyleSchema.optional(), focus: UiStyleSchema.optional() }).prefault({}),
  anim: z.array(UiAnimSchema).default([]),
  /** Words, with {name} replaced by a variable, a table cell or an object field. */
  text: z.string().default(''),
  sprite: z.string().default(''),
  /** What a bar, slider, tick box, choice list or tabs reads and writes: a variable, settings.music, a table cell. */
  value: z.string().default(''),
  max: z.string().default('100'),
  min: Num(0),
  step: Num(1),
  /** Choices for a choice list or the names of tabs, separated by commas. */
  options: z.string().default(''),
  /** For list, grid and hand: where the rows come from (table:Name, items, slots:12). */
  source: z.string().default(''),
  /** The UI prefab repeated for every row. */
  template: z.string().default(''),
  /** For a grid: the player may drag a cell onto another to swap them (the table's rows trade places). */
  drag: z.boolean().default(false),
  /** Shown only while this holds ("gold >= 10", "{health} < 25%"). Empty = always. */
  visible: z.string().default(''),
  enabled: z.string().default(''),
  /** What happens when the player clicks it, changes it or points at it. */
  on: z.object({ click: Actions, hover: Actions, change: Actions }).prefault({}),
  focus: UiFocusSchema.prefault({}),
  tooltip: z.string().default(''),
  /** The UI prefab this is an instance of (type instance). */
  prefab: z.string().default(''),
  /** Settings of an instance that differ from the prefab: widget name -> field -> value. */
  overrides: z.record(z.string(), z.record(z.string(), z.unknown())).default({}),
  /** For a minimap: the tags to show as dots, as tag:colour pairs separated by commas. */
  marks: z.string().default('player:#6fe08a, enemy:#e05a5a'),
  get children() {
    return z.array(UiNodeSchema).default([]);
  },
});
export type UiNode = z.infer<typeof UiNodeSchema>;

export const UiScreenSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  root: UiNodeSchema,
  /**
   * The older single switch: the game waits and the buttons belong to this screen. `pauses` and `blocksInput` below
   * say the two halves separately; when they are not set they follow this one (so projects made before they existed play as before).
   */
  modal: z.boolean().default(false),
  /** The game waits (is frozen) while this screen is open. Unset: follows `modal`. */
  pauses: z.boolean().optional(),
  /** The game's own buttons (walking, jumping) do nothing while this screen is open, and Back belongs to it. Unset: follows `modal`. */
  blocksInput: z.boolean().optional(),
  /** What the Back button (Esc, the pad's B) does on this screen. `auto`: close Pause, do nothing on Title, go to the previous screen on any other that blocks input, and let it pass on one that does not. */
  back: z.enum(['auto', 'previous', 'close', 'screen', 'nothing']).default('auto'),
  /** For `back: 'screen'`: the screen Back goes to. */
  backTo: z.string().default(''),
  /** When several screens are open the one with the higher number is offered the buttons first (equal: the one opened last). */
  priority: z.number().int().default(0),
  /** How much the game behind it is dimmed (0 to 1). */
  dim: z.number().min(0).max(1).default(0),
  transition: z.enum(['none', 'fade', 'slide']).default('none'),
  /** Where the box is drawn on the screen-flow map. */
  mapX: z.number().default(0),
  mapY: z.number().default(0),
  /** Opened when the game starts (a title screen, or a heads-up display). */
  opensOnStart: z.boolean().default(false),
});
export type UiScreen = z.infer<typeof UiScreenSchema>;

/** Does the game wait while this screen is open? */
export const screenPauses = (s: Pick<UiScreen, 'modal' | 'pauses'>): boolean => s.pauses ?? s.modal;
/** Do the game's own buttons stop working, and does Back belong to this screen, while it is open? */
export const screenBlocksInput = (s: Pick<UiScreen, 'modal' | 'blocksInput'>): boolean => s.blocksInput ?? s.modal;

export const UiPrefabSchema = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9 _-]{0,31}$/, 'Names use letters, numbers, spaces, - and _'), widget: UiNodeSchema });
export type UiPrefab = z.infer<typeof UiPrefabSchema>;

export const UiDocSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  screens: z.array(UiScreenSchema).default([]),
  prefabs: z.array(UiPrefabSchema).default([]),
  /** Margin kept free at the edge of the picture (a fraction of its size), so nothing sits under a TV's overscan or a phone's notch. */
  safeArea: z.number().min(0).max(0.15).default(0),
});
export type UiDoc = z.infer<typeof UiDocSchema>;

export const emptyUiDoc = (): UiDoc => ({ schemaVersion: CURRENT_SCHEMA_VERSION, screens: [], prefabs: [], safeArea: 0 });

/** The names the game treats specially: a screen with one of these replaces the built-in one. */
export const RESERVED_SCREENS = { title: 'Title', pause: 'Pause', settings: 'Settings' } as const;

/** A new widget of a type, with a sensible size and look. */
export function newWidget(type: WidgetType, id: string, name?: string): UiNode {
  const parsed = UiNodeSchema.parse({ id, type, name: name ?? defaultName(type) });
  const w = { ...parsed } as UiNode;
  switch (type) {
    case 'panel':
      Object.assign(w, { w: 240, h: 160, layout: 'column', style: { fill: 'var(--tw-panel)', border: 'var(--tw-border)', borderWidth: 2, radius: 10 } });
      break;
    case 'text':
      Object.assign(w, { w: 160, h: 28, wMode: 'auto', hMode: 'auto', text: 'Some text' });
      break;
    case 'button':
      Object.assign(w, { w: 160, h: 44, text: 'Button', style: { fill: 'var(--tw-panel)', border: 'var(--tw-border)', borderWidth: 2, radius: 8, align: 'center' }, states: { hover: { fill: 'var(--tw-highlight)' }, pressed: { opacity: 0.8 }, disabled: { opacity: 0.4 }, focus: { border: 'var(--tw-accent)' } } });
      break;
    case 'image':
      Object.assign(w, { w: 64, h: 64 });
      break;
    case 'bar':
      Object.assign(w, { w: 200, h: 18, value: '', max: '100', style: { fill: '#2a2d36', color: '#6fe08a', radius: 6 } });
      break;
    case 'slider':
      Object.assign(w, { w: 220, h: 28, min: 0, max: '100', step: 1 });
      break;
    case 'toggle':
      Object.assign(w, { w: 200, h: 28, wMode: 'auto', text: 'Option' });
      break;
    case 'dropdown':
      Object.assign(w, { w: 200, h: 32, options: 'One, Two, Three' });
      break;
    case 'keybind':
      Object.assign(w, { w: 260, h: 36, text: 'interact' });
      break;
    case 'list':
      Object.assign(w, { w: 260, h: 220, layout: 'column', source: '', template: '', style: { fill: 'var(--tw-panel)', radius: 8 } });
      break;
    case 'grid':
      Object.assign(w, { w: 280, h: 220, layout: 'grid', columns: 4, source: 'slots:12', template: '' });
      break;
    case 'tabs':
      Object.assign(w, { w: 360, h: 260, options: 'Items, Quests', layout: 'column' });
      break;
    case 'minimap':
      Object.assign(w, { w: 180, h: 180, style: { fill: '#10121a', border: 'var(--tw-border)', borderWidth: 2, radius: 8 } });
      break;
    case 'hand':
      Object.assign(w, { w: 520, h: 180, source: '', template: '' });
      break;
    case 'turnOrder':
      Object.assign(w, { w: 420, h: 56, layout: 'row' });
      break;
    case 'spacer':
      Object.assign(w, { w: 16, h: 16 });
      break;
    case 'instance':
      Object.assign(w, { w: 120, h: 40, wMode: 'auto', hMode: 'auto' });
      break;
  }
  return w;
}

function defaultName(type: WidgetType): string {
  return WIDGET_LABELS[type].split(' (')[0]!;
}

// ---------- walking and editing ----------

export function walkWidgets(root: UiNode, fn: (w: UiNode, parent: UiNode | null) => void, parent: UiNode | null = null): void {
  fn(root, parent);
  for (const c of root.children) walkWidgets(c, fn, w0(root));
}
const w0 = (w: UiNode): UiNode => w;

export function findWidget(root: UiNode, id: string): UiNode | null {
  let found: UiNode | null = null;
  walkWidgets(root, (w) => {
    if (w.id === id) found = w;
  });
  return found;
}

export function parentOf(root: UiNode, id: string): UiNode | null {
  let found: UiNode | null = null;
  walkWidgets(root, (w, p) => {
    if (w.id === id) found = p;
  });
  return found;
}

export function widgetCount(root: UiNode): number {
  let n = 0;
  walkWidgets(root, () => n++);
  return n;
}

/** The ids of every widget in a screen or prefab (to make new ones that are different). */
export function widgetIds(root: UiNode): Set<string> {
  const ids = new Set<string>();
  walkWidgets(root, (w) => ids.add(w.id));
  return ids;
}

export function parseUiDoc(json: unknown): { ok: true; value: UiDoc } | { ok: false; error: string } {
  const r = UiDocSchema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const first = r.error.issues[0];
  return { ok: false, error: `The interface screens file is not valid${first ? ` (${first.path.join('.')}: ${first.message})` : ''}.` };
}

export function stringifyUiDoc(doc: UiDoc): string {
  return JSON.stringify(doc, null, 2) + '\n';
}
