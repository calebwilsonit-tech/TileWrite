import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built

/**
 * The settings of the parts of the interface that the engine draws itself, so that nothing in a game looks like a web page:
 * scrolling (any panel, list or grid), sliders, pop-up lists (drop-downs, context menus, pickers), the other form controls and the map.
 *
 * Every field is optional and a widget that has none of them plays exactly as it did before they existed. Names of UI prefabs
 * ("parts") are plain strings: a part is an ordinary widget the designer made, and an empty name means the built-in default.
 */

const Actions = z.array(z.object({ type: z.string().min(1), params: z.record(z.string(), z.unknown()).default({}) })).default([]);
const Name = z.string().max(80);

/** The parts of a control, by role: "track", "thumb", ... -> the name of a UI prefab ('' = the built-in one). */
export const UiPartsSchema = z.record(z.string(), Name);
export type UiParts = z.infer<typeof UiPartsSchema>;

// ---------- scrolling ----------

export const SCROLL_FOLLOW = ['nearest', 'center', 'margin', 'page', 'none'] as const;
export type ScrollFollow = (typeof SCROLL_FOLLOW)[number];

export const ScrollBarSchema = z.object({
  /** When the bar is on show. */
  show: z.enum(['always', 'scroll', 'hover', 'never']).default('scroll'),
  side: z.enum(['right', 'left', 'top', 'bottom']).default('right'),
  /** How wide the bar is (pixels). */
  size: z.number().min(2).max(80).default(10),
  /** The thumb is as long as the part of the content that is on show, or has a fixed length. */
  thumb: z.enum(['visible', 'fixed']).default('visible'),
  thumbSize: z.number().min(4).max(400).default(40),
  /** Parts: track, thumb, arrowStart, arrowEnd, page (a mark for every page). */
  parts: UiPartsSchema.default({}),
  arrows: z.boolean().default(false),
  /** Marks along the track, one for every page of the content. */
  pageMarks: z.boolean().default(false),
});
export type ScrollBar = z.infer<typeof ScrollBarSchema>;

export const ScrollEdgeSchema = z.object({
  /** The UI prefab shown (it sees scroll.hidden_before and scroll.hidden_after: how many rows are out of view). */
  prefab: Name.default(''),
  /** Shown only while this holds ("{scroll.hidden_after} > 0"). Empty: while there is something out of view that way. */
  when: z.string().default(''),
});

export const ScrollerSchema = z.object({
  dir: z.enum(['vertical', 'horizontal', 'both']).default('vertical'),
  /** Room left past the first and the last row (pixels). */
  padStart: z.number().min(0).max(2000).default(0),
  padEnd: z.number().min(0).max(2000).default(0),
  /** Never scroll further than this many pixels from the start (0: the end of the content). */
  limit: z.number().min(0).max(100000).default(0),
  snap: z.enum(['none', 'rows', 'pages', 'grid']).default('none'),
  /** For snap "grid": the size of a cell (pixels). */
  snapSize: z.number().min(0).max(2000).default(0),
  edges: z.enum(['stop', 'elastic']).default('stop'),
  momentum: z.boolean().default(false),
  motion: z.enum(['smooth', 'instant']).default('smooth'),
  /** How fast the wheel, the stick and the held buttons scroll (1 = normal). */
  speed: z.number().min(0.1).max(20).default(1),
  /** What the scroller does when the focus moves to something inside it. */
  follow: z.enum(SCROLL_FOLLOW).default('nearest'),
  /** For "margin": rows kept in view past the focused one. */
  margin: z.number().min(0).max(20).default(1),
  /** The mapped actions that scroll it (names of the project's controls). */
  actions: z
    .object({
      up: z.string().default('ui_scroll_up'),
      down: z.string().default('ui_scroll_down'),
      left: z.string().default('ui_scroll_left'),
      right: z.string().default('ui_scroll_right'),
      pageUp: z.string().default('ui_page_up'),
      pageDown: z.string().default('ui_page_down'),
    })
    .default({ up: 'ui_scroll_up', down: 'ui_scroll_down', left: 'ui_scroll_left', right: 'ui_scroll_right', pageUp: 'ui_page_up', pageDown: 'ui_page_down' }),
  /** Seconds before a held button repeats, repeats a second, and how much faster it gets for every second held (1 = not at all). */
  holdDelay: z.number().min(0).max(3).default(0.4),
  holdRate: z.number().min(1).max(60).default(12),
  holdAccel: z.number().min(1).max(10).default(1.5),
  wheel: z.boolean().default(true),
  drag: z.boolean().default(true),
  bar: ScrollBarSchema.optional(),
  /** "More above" and "more below": widgets with a condition. */
  before: ScrollEdgeSchema.optional(),
  after: ScrollEdgeSchema.optional(),
  /** Stays at the end when rows are added (a chat log), or at the start. */
  stick: z.enum(['none', 'start', 'end']).default('none'),
  /** Scrolls by itself (pixels a second; a credits roll). 0: it does not. */
  auto: z.number().min(0).max(2000).default(0),
  autoLoop: z.boolean().default(false),
  /** Rows are made only when they come into view (long lists). */
  lazy: z.boolean().default(false),
  /** A row's height for `lazy` (pixels). */
  rowSize: z.number().min(0).max(2000).default(0),
  /** Variable names to keep up to date: name (0 to 1), name.row (first row in view), name.rows (rows in view), name.top, name.bottom. */
  bind: z.string().max(60).default(''),
  /** Things to do when it scrolls, reaches the top, reaches the bottom. */
  on: z.object({ scrolled: Actions, top: Actions, bottom: Actions }).default({ scrolled: [], top: [], bottom: [] }),
});
export type Scroller = z.infer<typeof ScrollerSchema>;

// ---------- sliders ----------

export const SliderSchema = z.object({
  /** The direction the slider runs, in degrees: 0 left to right, -90 bottom to top (a vertical slider), anything between. */
  angle: z.number().min(-360).max(360).default(0),
  /** A second thumb: this is what it reads and sets (the slider is then a range). */
  value2: z.string().default(''),
  /** Places the thumb sticks to, as a list of numbers ("0, 25, 50, 100"). Empty: the steps. */
  snapPoints: z.string().default(''),
  curve: z.enum(['linear', 'log', 'table']).default('linear'),
  /** For "table": pairs of position:value from 0 to 1 ("0:0, 0.5:0.1, 1:1"). */
  curveTable: z.string().default(''),
  /** How the value is shown ("{value}%", "{value} dB"). */
  format: z.string().default(''),
  decimals: z.number().int().min(0).max(6).default(0),
  /** The step the second pair of actions makes (0: ten steps). */
  bigStep: z.number().min(0).default(0),
  actions: z
    .object({
      less: z.string().default('move_left'),
      more: z.string().default('move_right'),
      bigLess: z.string().default('ui_page_up'),
      bigMore: z.string().default('ui_page_down'),
    })
    .default({ less: 'move_left', more: 'move_right', bigLess: 'ui_page_up', bigMore: 'ui_page_down' }),
  holdDelay: z.number().min(0).max(3).default(0.4),
  holdRate: z.number().min(1).max(60).default(10),
  holdAccel: z.number().min(1).max(10).default(2),
  /** Marks along the track: at every step, every snap point, or none. */
  ticks: z.enum(['none', 'steps', 'points']).default('none'),
  /** Parts: track, fill, thumb, thumb2, tick, value (text). Any more are free for the designer: they get slider.* values. */
  parts: UiPartsSchema.default({}),
  wheel: z.boolean().default(true),
});
export type SliderSpec = z.infer<typeof SliderSchema>;

// ---------- pop-up lists ----------

export const PopupSchema = z.object({
  /** Where the list opens, from the closed box. "screen" opens a screen of its own instead (named in `screen`). */
  place: z.enum(['below', 'above', 'beside', 'centred', 'screen']).default('below'),
  screen: Name.default(''),
  multi: z.boolean().default(false),
  search: z.boolean().default(false),
  /** The names of what each option is (words, with {option.*} or {row.*}): value, shown words, picture, description, group. */
  value: z.string().default(''),
  label: z.string().default(''),
  icon: z.string().default(''),
  detail: z.string().default(''),
  group: z.string().default(''),
  /** Left and right on the closed box step through the options without opening it. */
  stepClosed: z.boolean().default(true),
  /** The mapped action that opens it. */
  open: z.string().default('interact'),
  /** The list is as wide as the box, or fits its words. */
  width: z.enum(['box', 'fit']).default('box'),
  /** The most rows on show before the list scrolls. */
  maxRows: z.number().int().min(1).max(50).default(8),
  /** Words on the closed box when many are chosen ("{count} chosen"). */
  manyText: z.string().default('{count} chosen'),
  /** Words on the closed box when nothing is chosen. */
  none: z.string().default(''),
  /** Parts: box (the closed box), list, option, mark, search, group, empty. */
  parts: UiPartsSchema.default({}),
  scroller: ScrollerSchema.optional(),
  /** Shown only while this holds, for every option ("{option.value} != locked"). */
  filter: z.string().default(''),
  animOpen: z.enum(['none', 'fade', 'slide', 'pop']).default('fade'),
  animClose: z.enum(['none', 'fade', 'slide', 'pop']).default('none'),
});
export type PopupSpec = z.infer<typeof PopupSchema>;

/** Text fields and number fields. */
export const FieldControlSchema = z.object({
  placeholder: z.string().default(''),
  maxLength: z.number().int().min(1).max(500).default(40),
  /** Letters that may be typed: "any", "letters", "digits", "name" (letters, digits, spaces and - _). */
  allow: z.enum(['any', 'letters', 'digits', 'name']).default('any'),
  /** Shows dots in place of the words. */
  secret: z.boolean().default(false),
  /** For a number field: the lowest and the highest, and how far one step goes. */
  min: z.number().default(0),
  max: z.number().default(100),
  step: z.number().default(1),
  parts: UiPartsSchema.default({}),
  /** Things to do when the player finishes (Enter, or leaves the field). */
  commit: Actions,
});
export type FieldControl = z.infer<typeof FieldControlSchema>;

// ---------- maps ----------

/** One setting of a thing a plugin adds (a map layer, a fog rule, a marker source), so the designer can offer it with no code. */
export interface FieldDef {
  key: string;
  label: string;
  type: 'text' | 'number' | 'bool' | 'choice' | 'colour' | 'picture' | 'condition' | 'table' | 'tag' | 'scene';
  options?: { value: string; label: string }[];
  default?: string | number | boolean;
  help?: string;
}

const Settings = z.record(z.string(), z.unknown()).default({});

export const MAP_LAYER_KINDS = ['terrain', 'picture', 'regions', 'paths', 'fog', 'markers', 'grid', 'labels'] as const;
export const MAP_BLENDS = ['normal', 'multiply', 'screen', 'overlay', 'lighten', 'darken'] as const;

export const MapLayerSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  /** One of MAP_LAYER_KINDS, or the id of a kind a plugin added. */
  kind: z.string().min(1),
  opacity: z.number().min(0).max(1).default(1),
  blend: z.enum(MAP_BLENDS).default('normal'),
  /** Shown only while this holds. */
  visible: z.string().default(''),
  /** Shown only between these zoom levels (0: no limit). */
  zoomMin: z.number().min(0).default(0),
  zoomMax: z.number().min(0).default(0),
  /** The layer's own settings; which ones depends on the kind (see MAP_LAYER_FIELDS). */
  settings: Settings,
});
export type MapLayer = z.infer<typeof MapLayerSchema>;

export const MarkerKindSchema = z.object({
  id: z.string().min(1),
  name: z.string().default(''),
  /** Where the markers come from: tags, prefabs, regions, table, list, hand, or a kind a plugin added. */
  from: z.string().default('hand'),
  /** The tag, prefab name, table:Name, list source or region group the markers come from. */
  source: z.string().default(''),
  /** Where a row puts its marker: the columns or values for across and down (cells of the world). */
  x: z.string().default('x'),
  y: z.string().default('y'),
  /** The UI prefab drawn for each marker (empty: a built-in dot). */
  prefab: Name.default(''),
  /** What state a marker is in (words: "{row.state}", "locked"). Different states can use different prefabs. */
  state: z.string().default(''),
  statePrefabs: z.record(z.string(), Name).default({}),
  /** Shown only while this holds. Sees marker.*, map.zoom and map.distance (cells from the followed object). */
  show: z.string().default(''),
  /** Sorting: markers with the higher number are drawn on top. */
  sort: z.string().default(''),
  /** Markers closer than this on the picture (pixels) merge into one (0: never). */
  cluster: z.number().min(0).default(0),
  clusterPrefab: Name.default(''),
  /** A marker that follows an object while the game runs (the player, enemies). */
  follows: z.boolean().default(false),
  /** Words the marker carries ({row.name}); markers can show them. */
  label: z.string().default(''),
  /** The marker keeps its size when the map zooms, or grows with it. */
  scaleWithZoom: z.boolean().default(false),
  /** The marker can be chosen with the keys, the pad and the mouse. */
  choosable: z.boolean().default(true),
  /** Placed by hand: where, and what they say. */
  hand: z.array(z.object({ id: z.string().min(1), x: z.number(), y: z.number(), label: z.string().default(''), state: z.string().default('') })).default([]),
  /** Extra settings (for a kind of marker source a plugin added). */
  settings: Settings,
});
export type MarkerKind = z.infer<typeof MarkerKindSchema>;

export const MAP_SOURCES = ['current', 'scene', 'scenes', 'table', 'list', 'none'] as const;
export const MAP_PROJECTIONS = ['topdown', 'iso', 'picture'] as const;

export const MapSpecSchema = z.object({
  source: z
    .object({
      kind: z.enum(MAP_SOURCES).default('current'),
      /** For "scene": the scene file. */
      scene: z.string().default(''),
      /** For "scenes": scenes placed on one world layout (cells). */
      scenes: z.array(z.object({ scene: z.string(), x: z.number().default(0), y: z.number().default(0) })).default([]),
      /** For "table" and "list": the table, or list source, whose rows are cells (x, y, tile / height / region). */
      table: z.string().default(''),
      /** The size of the world when the source has none (cells). */
      width: z.number().int().min(1).max(4096).default(64),
      height: z.number().int().min(1).max(4096).default(64),
    })
    .default({ kind: 'current', scene: '', scenes: [], table: '', width: 64, height: 64 }),
  projection: z
    .object({
      kind: z.enum(MAP_PROJECTIONS).default('topdown'),
      /** For "iso": follow the camera's turn, or a fixed angle in degrees. */
      rotation: z.enum(['camera', 'fixed']).default('camera'),
      angle: z.number().default(0),
      /** For "picture": the picture the markers sit on, and how many cells its width and height stand for. */
      picture: z.string().default(''),
    })
    .default({ kind: 'topdown', rotation: 'camera', angle: 0, picture: '' }),
  layers: z.array(MapLayerSchema).default([]),
  markers: z.array(MarkerKindSchema).default([]),
  view: z
    .object({
      zoom: z.number().min(0.05).max(64).default(1),
      zoomMin: z.number().min(0.05).max(64).default(0.25),
      zoomMax: z.number().min(0.05).max(64).default(8),
      /** The centre: "auto" (the whole world fits), "x,y" cells, or "follow:tag" (an object). */
      centre: z.string().default('auto'),
      /** The map turns with the camera, or by a fixed angle (degrees); "none": it does not turn. */
      turn: z.enum(['none', 'camera', 'fixed']).default('none'),
      turnAngle: z.number().default(0),
      /** Pixels one cell takes at zoom 1. */
      cell: z.number().min(1).max(256).default(8),
    })
    .default({ zoom: 1, zoomMin: 0.25, zoomMax: 8, centre: 'auto', turn: 'none', turnAngle: 0, cell: 8 }),
  nav: z
    .object({
      /** How the highlight picks the next marker: by direction on the screen, in list order, or the nearest one. */
      mode: z.enum(['direction', 'order', 'nearest']).default('direction'),
      wrap: z.boolean().default(true),
      /** Where the highlight starts: the first marker, the one where the followed object is, or nowhere. */
      start: z.enum(['first', 'here', 'none']).default('first'),
      actions: z
        .object({
          up: z.string().default('move_up'),
          down: z.string().default('move_down'),
          left: z.string().default('move_left'),
          right: z.string().default('move_right'),
          next: z.string().default('ui_page_down'),
          prev: z.string().default('ui_page_up'),
          zoomIn: z.string().default('ui_zoom_in'),
          zoomOut: z.string().default('ui_zoom_out'),
          select: z.string().default('interact'),
          recentre: z.string().default('ui_recentre'),
        })
        .default({ up: 'move_up', down: 'move_down', left: 'move_left', right: 'move_right', next: 'ui_page_down', prev: 'ui_page_up', zoomIn: 'ui_zoom_in', zoomOut: 'ui_zoom_out', select: 'interact', recentre: 'ui_recentre' }),
      /** Pointer: click chooses, drag pans, wheel zooms, two fingers pinch. */
      click: z.boolean().default(true),
      drag: z.boolean().default(true),
      wheel: z.boolean().default(true),
      pinch: z.boolean().default(true),
      /** Whether keys and pad move the highlight (on) or pan the view (off). */
      keys: z.enum(['highlight', 'pan', 'none']).default('highlight'),
    })
    .default({ mode: 'direction', wrap: true, start: 'first', actions: { up: 'move_up', down: 'move_down', left: 'move_left', right: 'move_right', next: 'ui_page_down', prev: 'ui_page_up', zoomIn: 'ui_zoom_in', zoomOut: 'ui_zoom_out', select: 'interact', recentre: 'ui_recentre' }, click: true, drag: true, wheel: true, pinch: true, keys: 'highlight' }),
  /** What happens: the highlight moved to a marker, a marker was chosen, part of the map was revealed. Each sees marker.* and its row's values. */
  on: z.object({ highlight: Actions, choose: Actions, reveal: Actions }).default({ highlight: [], choose: [], reveal: [] }),
  /** Variable names to keep up to date: name.marker (the id of the highlighted one), name.zoom, name.x, name.y, name.cellx, name.celly. */
  bind: z.string().max(60).default(''),
});
export type MapSpec = z.infer<typeof MapSpecSchema>;

export const emptyMapSpec = (): MapSpec => MapSpecSchema.parse({});

// ---------- the settings each built-in kind reads (also what the designer offers) ----------

const COLOUR_BY = [
  { value: 'tile', label: 'the tile (its own colours)' },
  { value: 'art', label: 'the tile’s own art, small' },
  { value: 'tag', label: 'a tile tag' },
  { value: 'property', label: 'a tile property' },
  { value: 'height', label: 'the height band' },
  { value: 'region', label: 'the region' },
  { value: 'table', label: 'a value from a table' },
];
const REVEAL = [
  { value: 'visited', label: 'cells near where the followed object has been' },
  { value: 'regions', label: 'regions it has entered' },
  { value: 'variable', label: 'a condition (a variable, a table cell)' },
  { value: 'table', label: 'cells listed in a table' },
  { value: 'sight', label: 'cells it can see (line of sight)' },
  { value: 'event', label: 'revealed by a Quick Action or an event' },
];

export const MAP_LAYER_FIELDS: Record<string, FieldDef[]> = {
  terrain: [
    { key: 'colourBy', label: 'Colour by', type: 'choice', options: COLOUR_BY, default: 'tile' },
    { key: 'name', label: 'Tag, property or table column', type: 'text', help: 'For colouring by a tag, a property, or a column of a table.' },
    { key: 'palette', label: 'Colours (value:colour, ...)', type: 'text', help: 'For example "grass:#4a7, stone:#889, 0:#334, 3:#99a". A band of height uses the number.' },
    { key: 'fallback', label: 'Colour of anything not listed', type: 'colour', default: '#6b7f5a' },
    { key: 'outline', label: 'Outline', type: 'choice', options: [{ value: 'none', label: 'none' }, { value: 'edges', label: 'where the colour changes' }, { value: 'cells', label: 'every cell' }], default: 'none' },
    { key: 'outlineColour', label: 'Outline colour', type: 'colour', default: '#00000066' },
    { key: 'shade', label: 'Lighter on higher ground', type: 'bool', default: true },
    { key: 'empty', label: 'Colour of empty cells (blank: see through)', type: 'colour' },
  ],
  picture: [
    { key: 'picture', label: 'Picture', type: 'picture' },
    { key: 'fit', label: 'Placed', type: 'choice', options: [{ value: 'stretch', label: 'stretched over the whole map' }, { value: 'tile', label: 'tiled' }, { value: 'world', label: 'pinned to world cells' }], default: 'stretch' },
    { key: 'x', label: 'Left edge (cells), when pinned', type: 'number', default: 0 },
    { key: 'y', label: 'Top edge (cells), when pinned', type: 'number', default: 0 },
    { key: 'w', label: 'Width (cells), when pinned', type: 'number', default: 0 },
    { key: 'h', label: 'Height (cells), when pinned', type: 'number', default: 0 },
    { key: 'tileSize', label: 'Size of one tile of it (pixels), when tiled', type: 'number', default: 64 },
  ],
  regions: [
    { key: 'style', label: 'Drawn as', type: 'choice', options: [{ value: 'fill', label: 'filled' }, { value: 'outline', label: 'outlined' }, { value: 'both', label: 'filled and outlined' }], default: 'fill' },
    { key: 'colour', label: 'Colour', type: 'colour', default: '#d9a45a55' },
    { key: 'colours', label: 'Colour of a region (name:colour, ...)', type: 'text' },
    { key: 'only', label: 'Only the regions named (commas, blank: all)', type: 'text' },
    { key: 'when', label: 'Each region is drawn only when (sees region.*)', type: 'condition' },
    { key: 'lineWidth', label: 'Outline width', type: 'number', default: 2 },
  ],
  paths: [
    { key: 'from', label: 'Links come from', type: 'choice', options: [{ value: 'markers', label: 'markers of one kind, in order' }, { value: 'table', label: 'a table (a, b)' }, { value: 'places', label: 'the world map’s paths' }], default: 'places' },
    { key: 'kind', label: 'Marker kind, or table', type: 'text' },
    { key: 'colour', label: 'Colour', type: 'colour', default: '#d9c6a0' },
    { key: 'dash', label: 'Dashes (on, off)', type: 'text', default: '10,7' },
    { key: 'lineWidth', label: 'Width', type: 'number', default: 3 },
    { key: 'when', label: 'Each link is drawn only when (sees link.*)', type: 'condition' },
  ],
  fog: [
    { key: 'reveal', label: 'Revealed by', type: 'choice', options: REVEAL, default: 'visited' },
    { key: 'follow', label: 'Object that reveals (tag)', type: 'tag', default: 'player' },
    { key: 'radius', label: 'Radius (cells)', type: 'number', default: 4 },
    { key: 'condition', label: 'Condition', type: 'condition' },
    { key: 'area', label: 'Cells it covers (all, a region name, or x,y,w,h)', type: 'text', default: 'all' },
    { key: 'table', label: 'Table (columns x, y; or region)', type: 'table' },
    { key: 'remember', label: 'Stays revealed after the object leaves', type: 'bool', default: true },
    { key: 'look', label: 'Hidden cells look', type: 'choice', options: [{ value: 'hidden', label: 'hidden (covered)' }, { value: 'dim', label: 'dimmed' }, { value: 'desaturate', label: 'drained of colour' }, { value: 'picture', label: 'a picture' }], default: 'hidden' },
    { key: 'colour', label: 'Cover colour', type: 'colour', default: '#0b0d12' },
    { key: 'picture', label: 'Cover picture', type: 'picture' },
    { key: 'dimAmount', label: 'How much it dims (0 to 1)', type: 'number', default: 0.55 },
    { key: 'saved', label: 'Saved with the game', type: 'bool', default: true },
  ],
  markers: [{ key: 'kinds', label: 'Marker kinds drawn here (commas, blank: all)', type: 'text' }],
  grid: [
    { key: 'every', label: 'A line every (cells)', type: 'number', default: 8 },
    { key: 'colour', label: 'Colour', type: 'colour', default: '#ffffff22' },
    { key: 'lineWidth', label: 'Width', type: 'number', default: 1 },
  ],
  labels: [
    { key: 'from', label: 'Names come from', type: 'choice', options: [{ value: 'regions', label: 'regions' }, { value: 'markers', label: 'markers of one kind' }], default: 'regions' },
    { key: 'kind', label: 'Marker kind', type: 'text' },
    { key: 'colour', label: 'Colour', type: 'colour', default: '#f4efe6' },
    { key: 'size', label: 'Text size', type: 'number', default: 12 },
    { key: 'when', label: 'Each label is shown only when', type: 'condition' },
  ],
};

export const MARKER_FROM = [
  { value: 'hand', label: 'a list I place by hand' },
  { value: 'tags', label: 'objects with a tag' },
  { value: 'prefabs', label: 'objects made from a prefab' },
  { value: 'regions', label: 'the scene’s regions' },
  { value: 'table', label: 'rows of a table' },
  { value: 'list', label: 'rows of a list source' },
  { value: 'places', label: 'places of the world map' },
];

export const defaultMapLayer = (kind: string, id: string): MapLayer => MapLayerSchema.parse({ id, kind, name: kind[0]!.toUpperCase() + kind.slice(1), settings: Object.fromEntries((MAP_LAYER_FIELDS[kind] ?? []).filter((f) => f.default !== undefined).map((f) => [f.key, f.default])) });
