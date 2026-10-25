import { screenKit, type UiNode, type UiScreen } from '@tilewright/plugin-sdk';
import { CHOSEN, PARCHMENT, paper } from './palette';

const { action, closeScreen, openScreen, text, widget } = screenKit;

/**
 * The screens of the kit, built with the same few general things the UI designer offers anybody: panels in rows and columns, text,
 * bars, lists and grids that repeat for the rows of a source, "shown only when" and "usable only when" conditions, and buttons that do
 * the game's own actions. Nothing here is special to the engine; a project can press Customize on any of them and change whatever it
 * wants. (The recipes in docs/recipes say how each page is put together.)
 */

const ink = { color: PARCHMENT.ink };
const ACTION = action;
const setVar = (name: string, value: string): ReturnType<typeof action> => ACTION('setVariable', { name, op: 'set', value });

const words = (id: string, t: string, patch: Partial<UiNode> = {}): UiNode => text(id, t, { ...patch, style: { ...ink, ...(patch.style ?? {}) } });
const heading = (id: string, t: string): UiNode => words(id, t, { name: 'Heading', wMode: 'fill', style: { color: PARCHMENT.heading, fontSize: 26, bold: true, align: 'center' } });
const small = (id: string, t: string, patch: Partial<UiNode> = {}): UiNode => words(id, t, { ...patch, style: { color: PARCHMENT.inkSoft, fontSize: 13, ...(patch.style ?? {}) } });
const flourish = (id: string): UiNode => widget('plugin', id, { name: 'Flourish', source: 'parchment-flourish', wMode: 'fill', hMode: 'auto', style: {} });
const gap = (id: string, h = 8): UiNode => widget('spacer', id, { name: 'Space', wMode: 'fill', hMode: 'fixed', h });
const filler = (id: string): UiNode => widget('spacer', id, { name: 'Space', wMode: 'fill', hMode: 'auto', w: 8, h: 8 });

interface RowOptions {
  /** The widget's name (what it is called in the designer and in tests); the label when that is plain words. */
  name?: string;
  detail?: string;
  /** What the description box under a menu says while this row is chosen. */
  hint?: string;
  visible?: string;
  enabled?: string;
}

/** One row of a menu column: words on the left, a detail on the right, something that happens when it is chosen. */
function entry(id: string, label: string, click: ReturnType<typeof action>[], o: RowOptions = {}): UiNode {
  return widget('panel', id, {
    name: o.name ?? (label.includes('{') ? id : label),
    layout: 'row',
    wMode: 'fill',
    hMode: 'auto',
    align: 'center',
    padding: 8,
    gap: 12,
    style: { radius: 3, ...ink },
    states: { hover: CHOSEN, focus: CHOSEN, disabled: { opacity: 0.4 } },
    on: { click, hover: o.hint !== undefined ? [setVar('menu_hint', o.hint)] : [], change: [] },
    visible: o.visible ?? '',
    enabled: o.enabled ?? '',
    children: [words(`${id}.label`, label, { name: 'Label', style: { fontSize: 19 } }), filler(`${id}.gap`), small(`${id}.detail`, o.detail ?? '', { name: 'Detail', style: { align: 'right' } })],
  });
}

/** A column of rows with a box under it that says what the chosen row does (the box follows the mouse, the keys and the pad). */
function column(id: string, rows: UiNode[]): UiNode[] {
  return [...rows, gap(`${id}.space`, 6), small(`${id}.hint`, '{menu_hint}', { name: 'Description', wMode: 'fill', style: { align: 'center', opacity: 0.9 }, visible: '{menu_hint}' })];
}

/** A repeat: one row per entry of a source. */
function each(id: string, source: string, template: UiNode, patch: Partial<UiNode> = {}): UiNode {
  return widget('list', id, { name: id, source, layout: 'column', wMode: 'fill', hMode: 'auto', gap: 2, padding: 0, style: {}, children: [template], ...patch });
}

interface PageOptions {
  id: string;
  name: string;
  role?: string;
  w: number;
  children: UiNode[];
  back?: UiScreen['back'];
  dim?: number;
  padding?: number;
}

/** A page: a sheet of paper in the middle of the screen with the things of the page on it. */
function page(o: PageOptions): UiScreen {
  const root = widget('panel', `${o.id}.root`, { name: `${o.name} root`, anchor: 'fill', layout: 'free', padding: 0, style: {} });
  const box = widget('panel', `${o.id}.box`, { name: `${o.name} box`, anchor: 'c', w: o.w, wMode: 'fixed', hMode: 'auto', layout: 'column', align: 'stretch', padding: o.padding ?? 22, gap: 6, style: paper({ scroll: true, maxH: 90 }), children: o.children });
  root.children = [box];
  return { id: o.id, name: o.name, root, modal: true, back: o.back ?? 'auto', backTo: '', priority: 0, dim: o.dim ?? 0.7, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false, ...(o.role ? { role: o.role } : {}) };
}

// ---------- the binder: an open book ----------

/** One card of the satchel: pointed at (or chosen with the keys) it tells about the item, clicked it uses it. */
function itemCard(): UiNode {
  const frame = { fill: 'transparent', border: PARCHMENT.gold, borderWidth: 3, radius: 3 };
  return widget('panel', 'binder.card', {
    name: 'Item card',
    layout: 'free',
    w: 92,
    h: 76,
    wMode: 'fixed',
    hMode: 'fixed',
    padding: 0,
    style: { fill: PARCHMENT.paperDark, border: PARCHMENT.border, borderWidth: 1, radius: 3, ...ink },
    states: { hover: { border: PARCHMENT.gold, borderWidth: 3 }, focus: { border: PARCHMENT.gold, borderWidth: 3 } },
    on: {
      click: [ACTION('useItem', { item: '{item.id}' }), setVar('binder_pick', '{item.id}')],
      hover: [setVar('binder_name', '{item.name}'), setVar('binder_detail', '{item.detail}')],
      change: [ACTION('quickSlot', { item: '{item.id}', step: '{delta}' })],
    },
    children: [
      widget('panel', 'binder.card.body', { name: 'Card body', anchor: 'fill', layout: 'column', align: 'center', padding: 6, gap: 4, style: {}, children: [words('binder.card.name', '{item.name}', { name: 'Item name', wMode: 'fill', style: { fontSize: 14, align: 'center', bold: true } }), small('binder.card.count', 'x{item.count}', { name: 'How many', wMode: 'fill', style: { align: 'center' } })] }),
      widget('panel', 'binder.card.chosen', { name: 'Chosen mark', anchor: 'fill', layout: 'free', padding: 0, visible: '{binder_pick} = {item.id}', style: frame }),
    ],
  });
}

function binder(): UiScreen {
  const slotRow = widget('panel', 'binder.slot', { name: 'Slot', layout: 'row', wMode: 'fill', hMode: 'auto', align: 'center', padding: 5, gap: 8, style: { fill: PARCHMENT.paperDark, radius: 3, ...ink }, children: [small('binder.slot.label', '{slot.label}', { name: 'Slot name', style: { bold: true } }), filler('binder.slot.gap'), words('binder.slot.item', '{slot.item}', { name: 'In the slot', style: { fontSize: 15, align: 'right' } })] });
  const statRow = widget('panel', 'binder.stat', { name: 'Stat', layout: 'row', wMode: 'fill', hMode: 'auto', align: 'center', padding: 3, gap: 8, style: ink, children: [words('binder.stat.name', '{stat.name}', { name: 'Stat name', style: { fontSize: 15 } }), filler('binder.stat.gap'), words('binder.stat.value', '{stat.value}', { name: 'Stat value', style: { fontSize: 15, bold: true } })] });
  const left = widget('panel', 'binder.left', {
    name: 'Left page',
    layout: 'column',
    wMode: 'fill',
    hMode: 'auto',
    align: 'stretch',
    padding: 14,
    gap: 6,
    style: { ...ink },
    children: [
      heading('binder.left.title', 'Equipment'),
      flourish('binder.left.flourish'),
      widget('panel', 'binder.doll.row', { name: 'Doll and slots', layout: 'row', wMode: 'fill', hMode: 'auto', align: 'start', padding: 0, gap: 12, style: {}, children: [widget('plugin', 'binder.doll', { name: 'Paper doll', source: 'parchment-doll', w: 130, h: 220, wMode: 'fixed', hMode: 'fixed', style: {} }), each('binder.slots', 'parchment-equipment', slotRow, { name: 'Equipment slots', gap: 3 })] }),
      small('binder.stats.title', 'Stats', { name: 'Stats heading', style: { bold: true, fontSize: 15 } }),
      each('binder.stats', 'parchment-stats', statRow, { name: 'Stats', empty: 'No stats yet.' }),
    ],
  });
  const spine = widget('panel', 'binder.spine', { name: 'Spine', w: 8, wMode: 'fixed', hMode: 'fill', padding: 0, style: { fill: PARCHMENT.border, radius: 3 } });
  const right = widget('panel', 'binder.right', {
    name: 'Right page',
    layout: 'column',
    wMode: 'fill',
    hMode: 'auto',
    align: 'stretch',
    padding: 14,
    gap: 6,
    style: { ...ink },
    children: [
      heading('binder.right.title', 'Satchel'),
      flourish('binder.right.flourish'),
      widget('grid', 'binder.grid', { name: 'Items', source: 'items', layout: 'grid', columns: 4, gap: 6, padding: 2, wMode: 'fill', hMode: 'fixed', h: 250, empty: 'You are carrying nothing.', style: { scroll: true }, children: [itemCard()] }),
      words('binder.detail.name', '{binder_name}', { name: 'Chosen item', wMode: 'fill', visible: '{binder_name}', style: { fontSize: 18, bold: true } }),
      small('binder.detail.text', '{binder_detail}', { name: 'About it', wMode: 'fill', visible: '{binder_detail}' }),
      small('binder.right.hint', 'Click or E to use it   A / D: its quick slot   Esc: close', { name: 'Hint', wMode: 'fill', style: { opacity: 0.8 } }),
    ],
  });
  const book = widget('panel', 'binder.book', { name: 'Book', layout: 'row', wMode: 'fill', hMode: 'auto', align: 'stretch', padding: 0, gap: 0, style: {}, children: [left, spine, right] });
  return page({ id: 'parchment-binder', name: 'Inventory', role: 'inventory', w: 900, padding: 12, children: [book] });
}

// ---------- the map ----------

function map(): UiScreen {
  const chapter = widget('panel', 'map.chapter', { name: 'Chapter', layout: 'row', wMode: 'fill', hMode: 'auto', align: 'center', padding: 6, gap: 6, style: { radius: 3, ...ink }, children: [widget('panel', 'map.chapter.now', { name: 'Current mark', w: 8, h: 8, wMode: 'fixed', hMode: 'fixed', visible: '{chapter.current} = 1', style: { fill: PARCHMENT.heading, radius: 4 } }), words('map.chapter.name', '{chapter.name}', { name: 'Chapter name', style: { fontSize: 16 } })] });
  const waypoint = entry('map.waypoint', '{place.name}', [ACTION('travelToPlace', { place: '{place.id}' }), closeScreen('role:map'), closeScreen('role:pause')], { name: 'Waypoint', detail: '{place.hint}' });
  const left = widget('panel', 'map.left', { name: 'Chapters', layout: 'column', w: 190, wMode: 'fixed', hMode: 'auto', align: 'stretch', padding: 6, gap: 4, style: { ...ink }, children: [words('map.left.title', 'Chapters', { name: 'Chapters heading', style: { bold: true, fontSize: 17, color: PARCHMENT.heading } }), each('map.chapters', 'parchment-chapters', chapter, { name: 'Chapter list', empty: 'The story has not begun.' })] });
  const right = widget('panel', 'map.right', { name: 'Map and waypoints', layout: 'column', wMode: 'fill', hMode: 'auto', align: 'stretch', padding: 4, gap: 6, style: {}, children: [widget('plugin', 'map.picture', { name: 'Parchment map', source: 'parchment-map', wMode: 'fill', hMode: 'auto', h: 300, style: {} }), words('map.waypoints.title', 'Waypoints', { name: 'Waypoints heading', style: { bold: true, fontSize: 17, color: PARCHMENT.heading } }), each('map.waypoints', 'parchment-waypoints', waypoint, { name: 'Waypoint list', empty: 'Nowhere to go from here.' })] });
  return page({ id: 'parchment-map', name: 'Map', role: 'map', w: 940, padding: 14, children: [heading('map.title', '{map.title}'), flourish('map.flourish'), widget('panel', 'map.body', { name: 'Map body', layout: 'row', wMode: 'fill', hMode: 'auto', align: 'start', padding: 0, gap: 12, style: {}, children: [left, right] }), small('map.hint', 'W / S or the arrows: choose a waypoint   E or click: travel   Esc: close', { name: 'Hint', wMode: 'fill' })] });
}

// ---------- the pause menu and its pages ----------

export const PAUSE_TRAVEL = 'Pause: Travel';
export const PAUSE_RESTART = 'Pause: Restart';
export const NEW_GAME = 'Title: New game';

function pause(): UiScreen {
  const more = entry('pause.more', '{entry.label}', [openScreen('{entry.opens}')], { name: 'Entry', detail: '{entry.detail}' });
  const rows = [
    entry('pause.resume', 'Resume', [closeScreen('role:pause')], { hint: 'Back to the game.' }),
    entry('pause.inventory', 'Inventory', [openScreen('role:inventory')], { hint: 'Open the binder: what you wear and carry.' }),
    each('pause.entries', 'menu:pause', more, { name: 'Entries from plugins' }),
    entry('pause.travel', 'Travel', [openScreen(PAUSE_TRAVEL)], { hint: 'Go to a place you have found.' }),
    entry('pause.save', 'Save game', [openScreen('role:save')], { hint: 'Write the game down in a slot.' }),
    entry('pause.load', 'Load game', [openScreen('role:load')], { hint: 'Go on from an earlier save.' }),
    entry('pause.settings', 'Settings', [openScreen('role:settings')], { hint: 'Sound, display, language and controls.' }),
    entry('pause.restart', 'Restart', [openScreen(PAUSE_RESTART)], { hint: 'Start this area again (it asks first).' }),
    entry('pause.quit', 'Quit', [ACTION('quitGame')], { visible: '{host.quit}', hint: 'Leave the game.' }),
  ];
  return page({ id: 'parchment-pause', name: 'Pause', role: 'pause', w: 520, children: [heading('pause.title', 'Paused'), flourish('pause.flourish'), ...column('pause', rows)] });
}

function travel(): UiScreen {
  const place = entry('travel.place', '{place.name}', [ACTION('travelToPlace', { place: '{place.id}' }), closeScreen(PAUSE_TRAVEL), closeScreen('role:pause')], { name: 'Place', detail: '{place.hint}' });
  return page({ id: 'parchment-pause-travel', name: PAUSE_TRAVEL, w: 520, back: 'previous', dim: 0, children: [heading('travel.title', 'Travel'), flourish('travel.flourish'), each('travel.places', 'parchment-waypoints', place, { name: 'Places', empty: 'Nowhere to go from here yet.' }), small('travel.hint', 'Esc: back to the pause menu', { name: 'Hint', wMode: 'fill' })] });
}

function restart(): UiScreen {
  return page({
    id: 'parchment-pause-restart',
    name: PAUSE_RESTART,
    w: 460,
    back: 'previous',
    dim: 0,
    children: [
      heading('restart.title', 'Restart?'),
      flourish('restart.flourish'),
      words('restart.words', 'Start this area again? What you have done here since you last saved is lost.', { name: 'Question', wMode: 'fill', style: { align: 'center', fontSize: 17 } }),
      gap('restart.space', 8),
      entry('restart.no', 'No, keep playing', [ACTION('uiScreen', { op: 'back', screen: '' })], { hint: '' }),
      entry('restart.yes', 'Yes, start again', [closeScreen(PAUSE_RESTART), closeScreen('role:pause'), ACTION('restartArea')]),
    ],
  });
}

// ---------- the title and the difficulty that is locked for a save ----------

function title(): UiScreen {
  const rows = [
    entry('title.continue', 'Continue', [ACTION('loadGame', { slot: 'latest' }), closeScreen('role:title')], { detail: '{host.latestSave}', visible: '{host.hasSave}', hint: 'Go on from your latest save.' }),
    entry('title.new', 'New game', [openScreen(NEW_GAME)], { hint: 'Begin again. You choose how hard it is, once for this save.' }),
    entry('title.load', 'Load game', [openScreen('role:load')], { hint: 'Choose one of your saves.' }),
    entry('title.settings', 'Settings', [openScreen('role:settings')], { hint: 'Sound, display, language and controls.' }),
    entry('title.quit', 'Quit', [ACTION('quitGame')], { visible: '{host.quit}', hint: 'Leave the game.' }),
  ];
  return page({
    id: 'parchment-title',
    name: 'Title',
    role: 'title',
    w: 500,
    back: 'nothing',
    dim: 0.9,
    children: [words('title.name', '{game.title}', { name: 'Game title', wMode: 'fill', style: { color: PARCHMENT.heading, fontSize: 40, bold: true, align: 'center' } }), small('title.subtitle', '{game.subtitle}', { name: 'Subtitle', wMode: 'fill', visible: '{game.subtitle}', style: { align: 'center', fontSize: 16 } }), flourish('title.flourish'), gap('title.top', 6), ...column('title', rows)],
  });
}

/** What choosing a difficulty does: set it, remember that it is locked for this save (the variable is saved with the game), and begin. */
const choose = (value: string): ReturnType<typeof action>[] => [ACTION('setSetting', { name: 'difficulty', value }), setVar('difficulty_locked', '1'), closeScreen(NEW_GAME), closeScreen('role:title')];

function newGame(): UiScreen {
  return page({
    id: 'parchment-new-game',
    name: NEW_GAME,
    w: 500,
    back: 'previous',
    dim: 0,
    children: [
      heading('new.title', 'How hard?'),
      flourish('new.flourish'),
      words('new.words', 'Choose the difficulty of this journey. It cannot be changed once you have begun.', { name: 'Warning', wMode: 'fill', style: { align: 'center', fontSize: 16 } }),
      gap('new.top', 6),
      ...column('new', [
        entry('new.easy', 'Easy', choose('easy'), { hint: 'Gentle: you take less damage.' }),
        entry('new.normal', 'Normal', choose('normal'), { hint: 'As the makers meant it.' }),
        entry('new.hard', 'Hard', choose('hard'), { hint: 'Unforgiving: you take more damage.' }),
      ]),
    ],
  });
}

// ---------- the heads-up display ----------

function hud(): UiScreen {
  const root = widget('panel', 'hud.root', { name: 'HUD root', anchor: 'fill', layout: 'free', padding: 0, style: {} });
  const gauge = widget('panel', 'hud.gauge', { name: 'Gauge', anchor: 'tl', x: 14, y: 12, layout: 'column', wMode: 'auto', hMode: 'auto', padding: 8, gap: 4, style: paper({ borderWidth: 3, shadow: false }), children: [small('hud.gauge.label', 'Health', { name: 'Gauge label' }), widget('bar', 'hud.gauge.bar', { name: 'Health bar', w: 190, h: 14, value: '@Player.health.hp', max: '{@Player.health.max}', style: { fill: PARCHMENT.paperDark, color: '#a8442b', radius: 3, border: PARCHMENT.border, borderWidth: 2 } })] });
  const counter = widget('panel', 'hud.counter', { name: 'Coins', anchor: 'tl', x: 14, y: 78, layout: 'row', wMode: 'auto', hMode: 'auto', padding: 6, gap: 6, visible: '{gold}', style: paper({ borderWidth: 3, shadow: false }), children: [small('hud.counter.label', 'Coins', { name: 'Coins label' }), words('hud.counter.value', '{gold}', { name: 'Coins', style: { bold: true, fontSize: 18 } })] });
  const region = widget('plugin', 'hud.region', { name: 'Region name', anchor: 't', y: 18, source: 'parchment-region', wMode: 'auto', hMode: 'auto', style: {} });
  const boss = widget('panel', 'hud.boss', { name: 'Boss bar', anchor: 't', y: 64, layout: 'column', w: 420, wMode: 'fixed', hMode: 'auto', padding: 6, gap: 3, visible: '{boss_name}', style: paper({ borderWidth: 3, shadow: false }), children: [words('hud.boss.name', '{boss_name}', { name: 'Boss name', wMode: 'fill', style: { align: 'center', bold: true, fontSize: 17, color: PARCHMENT.heading } }), widget('bar', 'hud.boss.bar', { name: 'Boss health', wMode: 'fill', hMode: 'fixed', h: 14, value: 'boss_hp', max: '{boss_max}', style: { fill: PARCHMENT.paperDark, color: '#7a1f1f', radius: 3, border: PARCHMENT.border, borderWidth: 2 } })] });
  const prompt = widget('panel', 'hud.prompt', { name: 'Prompt', anchor: 'b', y: 88, layout: 'row', wMode: 'auto', hMode: 'auto', padding: 6, visible: '{prompt}', style: paper({ borderWidth: 2, shadow: false }), children: [words('hud.prompt.text', '{prompt}', { name: 'Prompt text', style: { fontSize: 17 } })] });
  const narrator = words('hud.narrator', '{narrator}', { name: 'Narrator', anchor: 'b', y: 36, w: 640, wMode: 'fixed', hMode: 'auto', visible: '{narrator}', style: { color: PARCHMENT.paper, fontSize: 20, align: 'center', shadow: true, opacity: 0.95 }, anim: [{ on: 'show', kind: 'fade', ms: 700, dir: 'up' }] });
  const slips = widget('plugin', 'hud.slips', { name: 'Message slips', anchor: 'br', x: 0, y: 0, source: 'parchment-slips', wMode: 'auto', hMode: 'auto', style: {} });
  root.children = [gauge, counter, region, boss, prompt, narrator, slips];
  return { id: 'parchment-hud', name: 'HUD', root, modal: false, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false, role: 'hud' };
}

/** Every screen the kit builds itself (the others it takes from the Prebuilt screens and gives the paper look). */
export function kitScreens(): { screen: UiScreen; role?: string }[] {
  return [binder(), map(), pause(), travel(), restart(), title(), newGame(), hud()].map((screen) => ({ screen, ...(screen.role ? { role: screen.role } : {}) }));
}

/** The words of the kit's own screens, for the translation tables. */
export function kitWords(): string[] {
  const out = new Set<string>();
  const walk = (n: UiNode): void => {
    for (const t of [n.text, n.label, n.empty, n.tooltip]) if (t && !/^\{[^}]*\}$/.test(t)) out.add(t);
    n.children.forEach(walk);
  };
  for (const { screen } of kitScreens()) {
    out.add(screen.name);
    walk(screen.root);
  }
  return [...out];
}
