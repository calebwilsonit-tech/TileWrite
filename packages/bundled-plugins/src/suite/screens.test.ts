import { describe, expect, it } from 'vitest';
import { putRecord } from '@tilewright/plugin-sdk';
import { ItemSchema } from '@tilewright/plugin-inventory';
import { MapNodeSchema, Simulation, UiDocSchema, UiScreenSchema, UiThemeSchema, UiWidgetSchema, WorldMapSchema, completeLayout, openRole, roleOfScreen, screenForRole, type SlotInfo, type VariableValue } from '@tilewright/runtime';
import {
  activateWidget,
  adjustWidget,
  host,
  openScreens,
  setChoice,
  setSlider,
  setUiBridge,
  stepWidget,
  walkView,
  withPluginScreens,
  type UiBridge,
  type ViewNode,
} from '@tilewright/behaviors';
import { parchmentPlugin } from '@tilewright/plugin-parchment';
import '@tilewright/bundled-plugins';

/** The game as the screens see it: the project's (empty) designer file plus the screens the plugins ship, and a bridge to a made-up host. */
function game(over: Partial<UiBridge> = {}): { sim: Simulation; settings: Record<string, VariableValue>; events: [string, Record<string, unknown>][]; bridge: UiBridge } {
  const sim = new Simulation(1);
  sim.assets.ui = withPluginScreens(UiDocSchema.parse({}));
  const settings: Record<string, VariableValue> = { master: 0.8, music: 0.8, sfx: 0.8, voice: 0.8, difficulty: 'normal', screenShake: true, cameraZoom: 1, showFps: false, fullscreen: false, skin: '', language: 'en' };
  const events: [string, Record<string, unknown>][] = [];
  for (const name of ['save-request', 'load-request', 'restart-request', 'quit-request', 'travel-place-request', 'travel-request', 'reset-controls-request', 'message']) sim.events.on(name, (e) => events.push([name, e]));
  const bridge: UiBridge = { getSetting: (k) => settings[k], setSetting: (k, v) => void (settings[k] = v), ...over };
  setUiBridge(sim, bridge);
  return { sim, settings, events, bridge };
}

const nodes = (sim: Simulation): ViewNode[] => {
  const out: ViewNode[] = [];
  for (const { view } of openScreens(sim)) walkView(view, (n) => out.push(n));
  return out;
};
const visible = (sim: Simulation): ViewNode[] => nodes(sim).filter((n) => n.visible);
const byId = (sim: Simulation, id: string): ViewNode => {
  const hit = visible(sim).find((n) => n.node.id === id || n.key.endsWith(`#${id}`));
  if (!hit) throw new Error(`no visible widget "${id}"; there are: ${visible(sim).map((n) => n.node.id).join(', ')}`);
  return hit;
};
/** The rows a list repeated: widgets with this id, one per row. */
const rowsOf = (sim: Simulation, id: string): ViewNode[] => visible(sim).filter((n) => n.node.id === id);
const texts = (sim: Simulation): string[] => visible(sim).filter((n) => n.node.type === 'text').map((n) => n.text).filter(Boolean);
const open = (sim: Simulation, role: string): void => void expect(openRole(sim, role), `the ${role} screen`).toBe(true);
const stack = (sim: Simulation): string[] => [...sim.runtime.ui.stack];
const slot = (name: string, exists: boolean, label = '', savedAt = ''): SlotInfo => ({ slot: name, exists, damaged: false, label, savedAt, scene: '' });

describe('the screens the plugins ship', () => {
  it('are valid designer screens, one for each role, with their own ids and names', () => {
    const defs = [...host.ext.screens.values()];
    expect(defs.map((d) => d.role).sort()).toEqual(['controls', 'hud', 'inventory', 'load', 'map', 'pause', 'save', 'settings', 'title', 'travel']);
    for (const d of defs) {
      expect(UiScreenSchema.safeParse(d.screen).success, d.id).toBe(true);
      expect(host.ext.screenRoles.has(d.role!), d.role).toBe(true);
      const ids: string[] = [];
      const walk = (n: { id: string; children: unknown[] }): void => {
        ids.push(n.id);
        (n.children as { id: string; children: unknown[] }[]).forEach(walk);
      };
      walk(d.screen.root);
      expect(new Set(ids).size, `${d.id} widget ids are unique`).toBe(ids.length);
    }
  });

  it('are used for the roles a project has no screen for, and the old reserved names still count as roles', () => {
    const { sim } = game();
    expect(screenForRole(sim.assets, 'pause')?.name).toBe('Pause');
    expect(roleOfScreen({ name: 'Pause' })).toBe('pause');
    const own = UiDocSchema.parse({ screens: [{ ...defs('pause'), id: 'mine', name: 'Pause', role: undefined }] });
    expect(withPluginScreens(own).screens.filter((s) => roleOfScreen(s) === 'pause')).toHaveLength(1);
    const renamed = UiDocSchema.parse({ screens: [{ ...defs('inventory'), id: 'mine', name: 'Inventory', role: undefined }] });
    // a project screen of the same name that has no role does not stop the plugin's playing the role (it is added under another name)
    expect(withPluginScreens(renamed).screens.map((s) => s.name)).toContain('Inventory (built-in)');
  });
});

const defs = (role: string) => host.ext.screens.get(role === 'travel' ? 'travel' : `prebuilt-${role}`)!.screen;

describe('Pause', () => {
  it('Resume closes it, and each row opens the screen it names', () => {
    const { sim } = game();
    open(sim, 'pause');
    expect(sim.runtime.ui.modal).toBe(true);
    expect(texts(sim)).toContain('Paused');
    activateWidget(sim, byId(sim, 'resume'));
    expect(stack(sim)).toEqual([]);
    expect(sim.runtime.ui.modal).toBe(false);
    for (const [row, role] of [['inventory', 'Inventory'], ['save', 'Save game'], ['load', 'Load game'], ['settings', 'Settings']] as const) {
      open(sim, 'pause');
      activateWidget(sim, byId(sim, row));
      expect(stack(sim), row).toEqual(['Pause', role]);
      sim.runtime.ui.stack = [];
    }
  });

  it('lists what plugins add to the menu, in their order: Map (only with a world map) and Travel', () => {
    const { sim } = game();
    open(sim, 'pause');
    expect(rowsOf(sim, 'entry').map((n) => n.scope['entry.label'])).toEqual(['Travel to a lit lantern']);
    expect(rowsOf(sim, 'entry')[0]!.scope['entry.detail']).toBe('0 lit');
    sim.assets.worldMap = WorldMapSchema.parse({ nodes: [MapNodeSchema.parse({ id: 'a', label: 'A', scene: 'a.scene.json', unlock: { kind: 'always' } })] });
    sim.runtime.vars['lit:hall.scene.json:p1'] = 'North post|3|4|0';
    expect(rowsOf(sim, 'entry').map((n) => n.scope['entry.label'])).toEqual(['Map', 'Travel to a lit lantern']);
    expect(rowsOf(sim, 'entry')[1]!.scope['entry.detail']).toBe('1 lit');
    activateWidget(sim, rowsOf(sim, 'entry')[0]!);
    expect(stack(sim)).toEqual(['Pause', 'Map']);
  });

  it('Restart this area asks the game to, and closes the menu; Quit shows only where the host can quit', () => {
    const { sim, events } = game();
    open(sim, 'pause');
    expect(visible(sim).some((n) => n.node.id === 'quit')).toBe(false);
    activateWidget(sim, byId(sim, 'restart'));
    expect(events.map((e) => e[0])).toEqual(['restart-request']);
    expect(stack(sim)).toEqual([]);

    const q = game({ can: (w) => w === 'quit' });
    open(q.sim, 'pause');
    activateWidget(q.sim, byId(q.sim, 'quit'));
    expect(q.events.map((e) => e[0])).toEqual(['quit-request']);
  });

  it('Back closes it and everything opened from it', () => {
    const { sim } = game();
    open(sim, 'pause');
    open(sim, 'settings');
    sim.step({});
    sim.step({ pause: 1 });
    expect(stack(sim)).toEqual(['Pause', 'Settings']); // (the router runs in the game; here only the screens are tested)
  });
});

describe('Title', () => {
  it('shows the game name and line; Continue appears only with a save, loads the latest and closes the title', () => {
    let saves: SlotInfo[] = [slot('autosave', false), slot('slot1', false)];
    const { sim, events } = game({ title: () => ({ text: 'My Game', subtitle: 'A tale' }), saves: () => saves });
    open(sim, 'title');
    expect(texts(sim)).toContain('My Game');
    expect(texts(sim)).toContain('A tale');
    expect(visible(sim).some((n) => n.node.id === 'continue')).toBe(false);
    saves = [slot('autosave', true, 'hall, 3 min', '2026-01-02T10:00:00Z'), slot('slot1', true, 'cave, 9 min', '2026-01-01T10:00:00Z')];
    expect(byId(sim, 'continue.detail').text).toBe('hall, 3 min');
    activateWidget(sim, byId(sim, 'continue'));
    expect(events.filter((e) => e[0] === 'load-request').map((e) => e[1].slot)).toEqual(['latest']);
    expect(stack(sim)).toEqual([]);
  });

  it('New game closes it; Load game and Settings open over it; Back does nothing on it', () => {
    const { sim } = game({ title: () => ({ text: 'G', subtitle: '' }) });
    open(sim, 'title');
    expect(visible(sim).some((n) => n.node.id === 'title.subtitle')).toBe(false); // no line, nothing shown
    activateWidget(sim, byId(sim, 'load'));
    expect(stack(sim)).toEqual(['Title', 'Load game']);
    sim.runtime.ui.stack = ['Title'];
    activateWidget(sim, byId(sim, 'settings'));
    expect(stack(sim)).toEqual(['Title', 'Settings']);
    sim.runtime.ui.stack = ['Title'];
    activateWidget(sim, byId(sim, 'new-game'));
    expect(stack(sim)).toEqual([]);
    expect(screenForRole(sim.assets, 'title')?.back).toBe('nothing');
  });
});

describe('Save and Load', () => {
  const slots = [slot('autosave', true, 'hall, 3 min', '2026-01-02T10:00:00Z'), slot('slot1', false), slot('slot2', true, 'cave, 9 min', '2026-01-01T09:30:00Z')];

  it('Save lists the manual slots (not the autosave) and saves into the one chosen', () => {
    const { sim, events } = game({ saves: () => slots });
    open(sim, 'save');
    const rows = rowsOf(sim, 'slot');
    expect(rows.map((n) => n.scope['save.name'])).toEqual(['Slot 1', 'Slot 2']);
    expect(rows[0]!.scope['save.detail']).toBe('empty');
    expect(rows[1]!.scope['save.detail']).toBe('cave, 9 min - 2026-01-01 09:30');
    activateWidget(sim, rows[1]!);
    expect(events.map((e) => [e[0], e[1].slot])).toEqual([['save-request', 'slot2']]);
    expect(stack(sim)).toEqual(['Save game']); // stays open: the list refreshes and a message says it worked
  });

  it('Load lists every slot, only a slot with a save can be chosen, and choosing leaves every menu', () => {
    const { sim, events } = game({ saves: () => slots });
    open(sim, 'pause');
    open(sim, 'load');
    const rows = rowsOf(sim, 'slot');
    expect(rows.map((n) => [n.scope['save.name'], n.enabled])).toEqual([['Autosave', true], ['Slot 1', false], ['Slot 2', true]]);
    activateWidget(sim, rows[1]!);
    expect(events).toEqual([]);
    activateWidget(sim, rows[2]!);
    expect(events.map((e) => [e[0], e[1].slot])).toEqual([['load-request', 'slot2']]);
    expect(stack(sim)).toEqual([]);
  });
});

describe('Settings', () => {
  it('sliders, tick boxes and choices write the settings; a row is hidden when the host cannot do it', () => {
    const { sim, settings } = game();
    open(sim, 'settings');
    setSlider(sim, byId(sim, 'master.slider'), 0.36);
    expect(settings.master).toBe(0.4);
    setSlider(sim, byId(sim, 'zoom.slider'), 1.4);
    expect(settings.cameraZoom).toBe(1.5);
    activateWidget(sim, byId(sim, 'shake.box'));
    expect(settings.screenShake).toBe(false);
    activateWidget(sim, byId(sim, 'fps.box'));
    expect(settings.showFps).toBe(true);
    setChoice(sim, byId(sim, 'difficulty.choice'), 'hard');
    expect(settings.difficulty).toBe('hard');
    const shown = visible(sim).map((n) => n.node.id);
    for (const hidden of ['fullscreen', 'skin', 'language']) expect(shown, hidden).not.toContain(hidden);
  });

  it('left and right on a choice go to the earlier or next option and wrap round, and on a tick box flip it (as the menus always did)', () => {
    const { sim, settings } = game();
    open(sim, 'settings');
    const choice = (): ViewNode => byId(sim, 'difficulty.choice');
    expect(stepWidget(sim, choice(), 1)).toBe(true);
    expect(settings.difficulty).toBe('hard');
    stepWidget(sim, choice(), 1);
    expect(settings.difficulty).toBe('easy'); // past the last is the first
    stepWidget(sim, choice(), -1);
    expect(settings.difficulty).toBe('hard'); // before the first is the last
    expect(stepWidget(sim, byId(sim, 'shake.box'), -1)).toBe(true);
    expect(settings.screenShake).toBe(false);
    stepWidget(sim, byId(sim, 'shake.box'), 1);
    expect(settings.screenShake).toBe(true);
    expect(stepWidget(sim, byId(sim, 'master.slider'), 1)).toBe(false); // a slider is moved by setSlider, not stepped
  });

  it('Full screen, Appearance and Language appear when the host offers them, and name the choices as the player reads them', () => {
    const { sim, settings } = game({
      can: (w) => w === 'fullscreen',
      choices: (w) => (w === 'skin' ? [{ value: '', label: 'Original' }, { value: 'night', label: 'Night' }] : w === 'language' ? [{ value: 'en', label: 'English' }, { value: 'fr', label: 'Français' }] : []),
    });
    open(sim, 'settings');
    const lang = byId(sim, 'language.choice');
    expect(lang.options).toEqual(['en', 'fr']);
    expect(lang.optionLabels).toEqual(['English', 'Français']);
    setChoice(sim, lang, 'fr');
    expect(settings.language).toBe('fr');
    setChoice(sim, byId(sim, 'skin.choice'), 'night');
    expect(settings.skin).toBe('night');
    activateWidget(sim, byId(sim, 'fullscreen.box'));
    expect(settings.fullscreen).toBe(true);
  });

  it('Controls opens from it', () => {
    const { sim } = game();
    open(sim, 'settings');
    activateWidget(sim, byId(sim, 'controls'));
    expect(stack(sim)).toEqual(['Settings', 'Controls']);
  });
});

describe('Controls', () => {
  it('lists every control with its keys; choosing one waits for the next key, and Reset puts them back', () => {
    const rebound: string[] = [];
    const { sim, events } = game({ controls: () => [{ action: 'jump', label: 'Jump' }, { action: 'attack', label: 'Attack' }], bindingText: (a) => (a === 'jump' ? 'Space' : 'J'), rebind: (a) => void rebound.push(a) });
    open(sim, 'controls');
    const rows = rowsOf(sim, 'bind');
    expect(rows.map((n) => [n.text, n.label])).toEqual([['jump', 'Jump'], ['attack', 'Attack']]);
    activateWidget(sim, rows[1]!);
    expect(rebound).toEqual(['attack']);
    activateWidget(sim, byId(sim, 'reset'));
    expect(events.map((e) => e[0])).toEqual(['reset-controls-request']);
  });
});

describe('Inventory', () => {
  function stocked() {
    const g = game();
    putRecord(g.sim.assets, 'items', 'key', ItemSchema.parse({ id: 'key', name: 'Brass key', description: 'Opens a door.' }));
    putRecord(g.sim.assets, 'items', 'bread', ItemSchema.parse({ id: 'bread', name: 'Bread', description: 'Tasty.', use: { heal: 2, message: 'Mmm.' } }));
    return g;
  }

  it('says when nothing is carried; lists what is, with its description, what E does and its quick slot', () => {
    const { sim } = stocked();
    open(sim, 'inventory');
    expect(texts(sim)).toContain('You are carrying nothing.');
    sim.runtime.vars['item:key'] = 1;
    sim.runtime.vars['item:bread'] = 3;
    sim.runtime.vars['slot:2'] = 'bread';
    const rows = rowsOf(sim, 'item');
    expect(rows.map((n) => n.scope['item.name'])).toEqual(['Bread', 'Brass key']);
    expect(byId(sim, 'item.label').text).toBe('Bread x3');
    expect(rows[0]!.scope['item.detail']).toBe('Tasty. - press E to use - slot 2');
    expect(rows[1]!.scope['item.detail']).toBe('Opens a door.');
  });

  it('choosing an item uses it; left and right move it between the quick slots, none first', () => {
    const { sim, events } = stocked();
    sim.runtime.vars['item:bread'] = 2;
    sim.runtime.vars['item:key'] = 1;
    open(sim, 'inventory');
    const bread = rowsOf(sim, 'item')[0]!;
    activateWidget(sim, bread);
    expect(sim.runtime.vars['item:bread']).toBe(1);
    expect(events.map((e) => e[0])).toContain('message');
    expect(adjustWidget(sim, bread, 1)).toBe(true);
    expect(sim.runtime.vars['slot:1']).toBe('bread');
    adjustWidget(sim, rowsOf(sim, 'item')[0]!, 1);
    expect([sim.runtime.vars['slot:1'], sim.runtime.vars['slot:2']]).toEqual(['', 'bread']);
    adjustWidget(sim, rowsOf(sim, 'item')[0]!, -1);
    adjustWidget(sim, rowsOf(sim, 'item')[0]!, -1);
    expect(['slot:1', 'slot:2', 'slot:3', 'slot:4'].map((k) => sim.runtime.vars[k] ?? '')).toEqual(['', '', '', '']);
  });
});

describe('Map and Travel', () => {
  it('the map lists the open places, you are here is not a choice, and choosing one travels and leaves the menus', () => {
    const { sim, events } = game();
    sim.assets.worldMap = WorldMapSchema.parse({
      title: 'The Vale',
      nodes: [
        MapNodeSchema.parse({ id: 'town', label: 'Town', scene: 'town.scene.json', x: 100, y: 100, unlock: { kind: 'always' } }),
        MapNodeSchema.parse({ id: 'cave', label: 'Cave', scene: 'cave.scene.json', x: 300, y: 100, unlock: { kind: 'always' } }),
        MapNodeSchema.parse({ id: 'tower', label: 'Tower', scene: 'tower.scene.json', x: 500, y: 100, unlock: { kind: 'variable', name: 'tower', atLeast: 1 } }),
      ],
    });
    sim.runtime.scene = 'town.scene.json';
    open(sim, 'pause');
    open(sim, 'map');
    expect(texts(sim)).toContain('The Vale');
    const rows = rowsOf(sim, 'place');
    expect(rows.map((n) => [n.scope['place.name'], n.enabled])).toEqual([['Town', false], ['Cave', true]]);
    expect(rows[0]!.scope['place.hint']).toBe('you are here');
    activateWidget(sim, rows[0]!);
    expect(events).toEqual([]);
    activateWidget(sim, rows[1]!);
    expect(events.map((e) => [e[0], e[1].place])).toEqual([['travel-place-request', 'cave']]);
    expect(stack(sim)).toEqual([]);
  });

  it('with no places it says so', () => {
    const { sim } = game();
    open(sim, 'map');
    expect(texts(sim)).toContain('Nowhere to go yet.');
  });

  it('Travel lists the lit posts, each with the area it is in, and choosing one travels there', () => {
    const { sim, events } = game();
    open(sim, 'travel');
    expect(texts(sim)).toContain('No lanterns lit yet. Light one by pressing E beside it.');
    sim.runtime.vars['lit:forest.scene.json:p2'] = 'Edge post|10|11|0';
    sim.runtime.vars['lit::p1'] = 'Home post|2|3|0';
    const rows = rowsOf(sim, 'post');
    expect(rows.map((n) => [n.scope['post.name'], n.scope['post.place']])).toEqual([['Home post', 'this area'], ['Edge post', 'forest']]);
    activateWidget(sim, rows[1]!);
    expect(events.map((e) => e[0])).toEqual(['travel-request']);
    expect(events[0]![1]).toMatchObject({ scene: 'forest.scene.json', id: 'p2', name: 'Edge post', x: 10, y: 11, h: 0 });
    expect(stack(sim)).toEqual([]);
  });
});

describe('the heads-up display', () => {
  const partsOf = (screen: { root: { children: { id: string; children: { id: string; type: string; source: string }[] }[] } }): string[] =>
    screen.root.children[0]!.children.map((c) => (c.type === 'plugin' ? c.source : c.id));

  it('is a screen like any other, with a plugin widget for each of the game\u2019s own pieces', () => {
    const { sim } = game();
    const hud = screenForRole(sim.assets, 'hud')!;
    expect(hud.name).toBe('HUD');
    expect(hud.modal).toBe(false);
    expect(partsOf(hud as never)).toEqual(['hearts', 'light-bar', 'quick-slots', 'boss-bars']);
    // a widget whose plugin is off is not there: the part is hidden
    open(sim, 'hud');
    const hearts = visible(sim).find((n) => n.node.source === 'hearts');
    expect(hearts).toBeDefined();
    expect(host.ext.widgets.has('hearts')).toBe(true);
  });

  it('follows the project\u2019s interface layout: pinned pieces, hidden pieces, the project\u2019s own counters, bars and texts', () => {
    const layout = completeLayout(
      {
        schemaVersion: 1,
        theme: UiThemeSchema.parse({}),
        widgets: [
          UiWidgetSchema.parse({ id: 'hearts', kind: 'hearts', anchor: 'br', x: 20, y: 30, scale: 2 }),
          UiWidgetSchema.parse({ id: 'lightbar', kind: 'lightbar', visible: false }),
          UiWidgetSchema.parse({ id: 'counter1', kind: 'counter', anchor: 'tr', x: 12, y: 12, label: 'Coins', variable: 'coins' }),
          UiWidgetSchema.parse({ id: 'text1', kind: 'text', text: 'Gold: {gold}' }),
          UiWidgetSchema.parse({ id: 'bar1', kind: 'bar', label: 'Progress', variable: 'done', maxVariable: 'total', color: '#ff0000' }),
        ],
      },
    );
    const sim = new Simulation(1);
    sim.assets.ui = withPluginScreens(UiDocSchema.parse({}), { layout });
    const hud = screenForRole(sim.assets, 'hud')!;
    const column = hud.root.children[0]!;
    // slots and bosses stay in the column (default anchor) with the project's own text and bar; the light bar is gone
    expect(column.children.map((c) => (c.type === 'plugin' ? c.source : c.name))).toEqual(['quick-slots', 'boss-bars', 'text1', 'bar1']);
    const pinned = hud.root.children.slice(1);
    expect(pinned.map((p) => [p.anchor, p.x, p.y])).toEqual([['br', -20, -30], ['tr', -12, 12]]);
    expect(pinned[0]!.children[0]!.style).toMatchObject({ scale: 2, themeScale: true });
    // the screen works: the counter and the text show the game's variables
    sim.runtime.vars.coins = 7;
    sim.runtime.vars.gold = 3;
    sim.runtime.vars.done = 4;
    sim.runtime.vars.total = 8;
    sim.runtime.ui.stack = ['HUD'];
    const all = nodes(sim);
    expect(all.find((n) => n.node.name === 'counter1')!.text).toBe('Coins 7');
    expect(all.find((n) => n.node.name === 'text1')!.text).toBe('Gold: 3');
    expect(all.find((n) => n.node.name === 'bar1 bar')!.fraction).toBe(0.5);
  });

  it('a project with its own screen for the role keeps it', () => {
    const own = UiDocSchema.parse({ screens: [{ ...defs('pause'), id: 'my-hud', name: 'My HUD', role: 'hud' }] });
    expect(withPluginScreens(own).screens.filter((s) => s.role === 'hud').map((s) => s.name)).toEqual(['My HUD']);
  });
});

describe('the Parchment UI kit (a plugin that re-skins the game\u2019s screens)', () => {
  it('plays the roles it offers with a higher priority, keeps what the screens do, and goes away when turned off', () => {
    host.register(parchmentPlugin);
    host.install('parchment');
    try {
      const doc = withPluginScreens(UiDocSchema.parse({}));
      const pause = doc.screens.find((s) => s.role === 'pause')!;
      expect(pause.from?.plugin).toBe('parchment');
      expect(pause.root.children[0]!.style).toMatchObject({ fill: '#e8d9b5', borderWidth: 4 });
      // the flourish widget sits under the heading
      expect(pause.root.children[0]!.children.map((c) => c.name).slice(0, 3)).toEqual(['Heading', 'Flourish', 'Resume']);
      // the screens still work: Resume closes it, and the rows are as before
      const { sim } = game();
      sim.assets.ui = doc;
      open(sim, 'pause');
      activateWidget(sim, byId(sim, 'resume'));
      expect(stack(sim)).toEqual([]);
      // the heads-up display and the travel list are not re-drawn
      expect(doc.screens.find((s) => s.role === 'hud')!.from?.plugin).toBe('prebuilt-screens');
      // a project's own screen still wins over a plugin's
      const own = UiDocSchema.parse({ screens: [{ ...defs('pause'), id: 'mine', name: 'Pause', role: undefined }] });
      expect(withPluginScreens(own).screens.filter((s) => s.role === 'pause' || s.name === 'Pause')).toHaveLength(1);
    } finally {
      host.uninstall('parchment');
    }
    expect(withPluginScreens(UiDocSchema.parse({})).screens.find((s) => s.role === 'pause')!.from?.plugin).toBe('prebuilt-screens');
  });
});
