import type { UiNode, UiScreen } from '@tilewright/plugin-sdk';
import { screenKit } from '@tilewright/plugin-sdk';

const { action, choice, closeScreen, heading, menuScreen, openScreen, repeat, resetIds, row, setting, slider, spacer, text, tickBox, widget } = screenKit;

/**
 * The menus of a game, as ordinary designer screens. A project that has no screen for a role plays with these; a project can
 * copy any of them (Project settings, Screens) and change it, and `revision` says when a copy has an update to compare with.
 *
 * Revision 1 reproduces the fixed menus the engine drew before screens could be replaced.
 */

/** What each screen is used as, with the help text shown where a person picks a role. */
export const ROLES: { id: string; label: string; help: string }[] = [
  { id: 'title', label: 'Title', help: 'The first screen of a game: New game, Continue, Load, Settings, Quit.' },
  { id: 'pause', label: 'Pause', help: 'Opens on the pause button (Esc or the pad’s Start) and freezes the game.' },
  { id: 'inventory', label: 'Inventory', help: 'Opens on the inventory button.' },
  { id: 'map', label: 'World map', help: 'Opens on the map button, and from the Pause menu when the project has a world map.' },
  { id: 'save', label: 'Save game', help: 'Choose a slot to save to.' },
  { id: 'load', label: 'Load game', help: 'Choose a save to continue from.' },
  { id: 'settings', label: 'Settings', help: 'Volumes, difficulty, display and language.' },
  { id: 'controls', label: 'Controls', help: 'Change which key or button does what.' },
  { id: 'hud', label: 'Heads-up display', help: 'Always on while the game runs: health, quick slots, light, boss bars and counters.' },
];

const BACK_HINT = 'W / S to choose, E to select, Esc or P to go back';

/** Leave every menu after something that ends them (loading a game, travelling): the pause menu, the screen that led here, the title. */
const leave = (role: string): ReturnType<typeof closeScreen>[] => [closeScreen(`role:${role}`), closeScreen('role:pause'), closeScreen('role:title')];

function title(): UiScreen {
  const heading1 = text('title.name', '{game.title}', { name: 'Game title', style: { color: 'var(--tw-accent)', fontSize: 40, align: 'center' }, wMode: 'fill' });
  const sub = text('title.subtitle', '{game.subtitle}', { name: 'Subtitle', style: { align: 'center', opacity: 0.8 }, wMode: 'fill', visible: '{game.subtitle}' });
  return menuScreen({
    id: 'prebuilt-title',
    name: 'Title',
    role: 'title',
    back: 'nothing',
    dim: 0.92,
    title: widget('panel', 'title.head', { name: 'Heading', layout: 'column', wMode: 'fill', hMode: 'auto', align: 'stretch', padding: 0, gap: 4, style: {}, children: [heading1, sub, spacer('title.space', { hMode: 'fixed', wMode: 'fill', h: 12 })] }),
    rows: [
      row('continue', 'Continue', 'Continue', '{host.latestSave}', [action('loadGame', { slot: 'latest' }), closeScreen('role:title')], { visible: '{host.hasSave}' }),
      row('new-game', 'New game', 'New game', '', [closeScreen('role:title')]),
      row('load', 'Load game', 'Load game', '', [openScreen('role:load')]),
      row('settings', 'Settings', 'Settings', '', [openScreen('role:settings')]),
      row('quit', 'Quit', 'Quit', '', [action('quitGame')], { visible: '{host.quit}' }),
    ],
    hint: 'W / S to choose, E to select',
  });
}

function pause(): UiScreen {
  const entry = row('entry', 'Entry', '{entry.label}', '{entry.detail}', [openScreen('{entry.opens}')]);
  return menuScreen({
    id: 'prebuilt-pause',
    name: 'Pause',
    role: 'pause',
    title: heading('pause.title', 'Paused'),
    rows: [
      row('resume', 'Resume', 'Resume', '', [closeScreen('role:pause')]),
      row('inventory', 'Inventory', 'Inventory', '', [openScreen('role:inventory')]),
      repeat('more', 'More', 'menu:pause', entry),
      row('save', 'Save game', 'Save game', '', [openScreen('role:save')]),
      row('load', 'Load game', 'Load game', '', [openScreen('role:load')]),
      row('settings', 'Settings', 'Settings', '', [openScreen('role:settings')]),
      row('restart', 'Restart this area', 'Restart this area', '', [closeScreen('role:pause'), action('restartArea')]),
      row('quit', 'Quit', 'Quit', '', [action('quitGame')], { visible: '{host.quit}' }),
    ],
    hint: BACK_HINT,
  });
}

function inventory(): UiScreen {
  const item = row('item', 'Item', '{item.name} x{item.count}', '{item.detail}', [action('useItem', { item: '{item.id}' })], {
    on: { click: [action('useItem', { item: '{item.id}' })], hover: [], change: [action('quickSlot', { item: '{item.id}', step: '{delta}' })] },
  });
  return menuScreen({
    id: 'prebuilt-inventory',
    name: 'Inventory',
    role: 'inventory',
    rows: [repeat('items', 'Items', 'items', item, { empty: 'You are carrying nothing.' })],
    hint: 'E: use   A / D: choose its quick slot   Esc: back',
  });
}

function worldMap(): UiScreen {
  const place = row('place', 'Place', '{place.name}', '{place.hint}', [action('travelToPlace', { place: '{place.id}' }), ...leave('map')], { enabled: '{place.here} = 0' });
  return menuScreen({
    id: 'prebuilt-map',
    name: 'Map',
    role: 'map',
    wide: true,
    title: heading('map.title', '{map.title}'),
    rows: [widget('plugin', 'map.picture', { name: 'World map', source: 'world-map', wMode: 'fill', hMode: 'auto', h: 40, style: {} }), repeat('places', 'Places', 'places', place, { empty: 'Nowhere to go yet.' })],
    hint: 'Arrows or W A S D: choose a place   E or click: travel   Esc: back',
  });
}

function saveGame(): UiScreen {
  return menuScreen({
    id: 'prebuilt-save',
    name: 'Save game',
    role: 'save',
    rows: [repeat('slots', 'Slots', 'saves', row('slot', 'Slot', '{save.name}', '{save.detail}', [action('saveGame', { slot: '{save.slot}' })], { visible: '{save.manual} = 1' }))],
    hint: BACK_HINT,
  });
}

function loadGame(): UiScreen {
  return menuScreen({
    id: 'prebuilt-load',
    name: 'Load game',
    role: 'load',
    rows: [repeat('slots', 'Slots', 'saves', row('slot', 'Slot', '{save.name}', '{save.detail}', [action('loadGame', { slot: '{save.slot}' }), ...leave('load')], { enabled: '{save.exists} = 1' }))],
    hint: BACK_HINT,
  });
}

function settings(): UiScreen {
  const volume = (id: string, label: string, key: string): UiNode => setting(id, label, label, slider(`${id}.slider`, `${label} slider`, `settings.${key}`, 0, 1, 0.1));
  const on = (id: string, label: string, key: string, patch: Partial<UiNode> = {}): UiNode => setting(id, label, label, tickBox(`${id}.box`, `${label} tick box`, `settings.${key}`), patch);
  return menuScreen({
    id: 'prebuilt-settings',
    name: 'Settings',
    role: 'settings',
    rows: [
      volume('master', 'Master volume', 'master'),
      volume('music', 'Music volume', 'music'),
      volume('sfx', 'Effects volume', 'sfx'),
      volume('voice', 'Voice volume', 'voice'),
      setting('difficulty', 'Difficulty', 'Difficulty', choice('difficulty.choice', 'Difficulty choice', 'settings.difficulty', 'easy, normal, hard')),
      on('shake', 'Screen shake and hit freeze', 'screenShake'),
      setting('zoom', 'Camera zoom', 'Camera zoom', slider('zoom.slider', 'Camera zoom slider', 'settings.cameraZoom', 0.75, 1.5, 0.25)),
      on('fullscreen', 'Full screen', 'fullscreen', { visible: '{host.fullscreen}' }),
      on('fps', 'Show frame rate', 'showFps'),
      setting('skin', 'Appearance', 'Appearance', choice('skin.choice', 'Appearance choice', 'settings.skin', '', { source: 'choices:skin' }), { visible: '{host.skins} > 1' }),
      setting('language', 'Language', 'Language', choice('language.choice', 'Language choice', 'settings.language', '', { source: 'choices:language' }), { visible: '{host.languages} > 1' }),
      row('controls', 'Controls', 'Controls', '', [openScreen('role:controls')]),
    ],
    hint: BACK_HINT,
  });
}

function controls(): UiScreen {
  const bind = widget('keybind', 'bind', { name: 'Control', text: '{control.action}', label: '{control.label}', wMode: 'fill', hMode: 'auto', h: 36, style: { radius: 8 }, padding: 7, states: { hover: { fill: 'color-mix(in srgb, var(--tw-highlight) 25%, var(--tw-panel))' }, focus: { border: 'var(--tw-highlight)', borderWidth: 1 } } });
  return menuScreen({
    id: 'prebuilt-controls',
    name: 'Controls',
    role: 'controls',
    rows: [repeat('controls', 'Controls', 'controls', bind), row('reset', 'Reset all controls', 'Reset all controls', '', [action('resetControls')])],
    hint: 'E: change the selected control, then press the new key or button',
  });
}

/** Every screen this plugin ships. Bump a screen's revision when its content changes. */
export function prebuiltScreens(): { id: string; screen: UiScreen; role: string; revision: number }[] {
  resetIds();
  return [title(), pause(), inventory(), worldMap(), saveGame(), loadGame(), settings(), controls()].map((screen) => ({ id: screen.id, screen, role: screen.role ?? '', revision: 1 }));
}

/** The words these screens show, for the translation tables. */
export function screenWords(): string[] {
  const out = new Set<string>();
  const walk = (n: UiNode): void => {
    for (const t of [n.text, n.label, n.empty, n.tooltip]) if (t && !/^\{[^}]*\}$/.test(t)) out.add(t);
    n.children.forEach(walk);
  };
  for (const s of prebuiltScreens()) {
    out.add(s.screen.name);
    walk(s.screen.root);
  }
  return [...out];
}
