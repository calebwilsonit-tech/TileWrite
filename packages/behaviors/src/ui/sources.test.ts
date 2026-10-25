import { describe, expect, it } from 'vitest';
import { MapNodeSchema, Simulation, UiDocSchema, WorldMapSchema, newWidget, openRole, roleOfScreen, screenForRole, type UiNode, type UiScreen } from '@tilewright/runtime';
import { host as pluginHost, definePlugin } from '../plugins/host';
import { activateWidget, openScreens, rowsOf, setUiBridge } from './screens-logic';
import { screenHash, withPluginScreens } from './defaults';
import { runActionList } from '../events/sheet';
import { contextOf } from '../story/context';

let n = 0;
const w = (type: Parameters<typeof newWidget>[0], patch: Partial<UiNode> = {}): UiNode => ({ ...newWidget(type, `w${++n}`), ...patch });
const screen = (name: string, children: UiNode[], extra: Partial<UiScreen> = {}): UiScreen => ({
  id: name.toLowerCase(),
  name,
  root: w('panel', { name: `${name} root`, anchor: 'fill', layout: 'column', children }),
  modal: false,
  back: 'auto',
  backTo: '',
  priority: 0,
  dim: 0,
  transition: 'none',
  mapX: 0,
  mapY: 0,
  opensOnStart: false,
  ...extra,
});
const game = (screens: UiScreen[] = []): Simulation => {
  const sim = new Simulation(1);
  sim.assets.ui = UiDocSchema.parse({ screens });
  return sim;
};
const list = (source: string): UiNode => w('list', { source, children: [w('text', { text: '{index}' })] });

describe('the sources a list can read from the game', () => {
  it('the save slots, the controls, the quick slots and the places on the map', () => {
    const sim = game();
    setUiBridge(sim, {
      getSetting: () => undefined,
      setSetting: () => undefined,
      saves: () => [
        { slot: 'autosave', exists: true, damaged: false, label: 'hall, 3 min', savedAt: '2026-10-24T10:00:00Z', scene: 'a' },
        { slot: 'slot1', exists: false, damaged: false, label: '', savedAt: '', scene: '' },
        { slot: 'slot2', exists: true, damaged: true, label: '', savedAt: '', scene: '' },
      ],
      controls: () => [{ action: 'jump', label: 'Jump' }],
      bindingText: () => 'Space',
    });
    const saves = rowsOf(sim, list('saves'));
    expect(saves.map((r) => r.id)).toEqual(['autosave', 'slot1', 'slot2']);
    expect(saves[0]!.scope).toMatchObject({ 'save.name': 'Autosave', 'save.exists': 1, 'save.manual': 0 });
    expect(saves[0]!.scope['save.detail']).toBe('hall, 3 min - 2026-10-24 10:00');
    expect(saves[1]!.scope).toMatchObject({ 'save.name': 'Slot 1', 'save.detail': 'empty', 'save.exists': 0, 'save.manual': 1 });
    expect(saves[2]!.scope['save.detail']).toBe('damaged');
    expect(rowsOf(sim, list('controls'))[0]!.scope).toMatchObject({ 'control.action': 'jump', 'control.label': 'Jump', 'control.binding': 'Space' });

    sim.runtime.vars['slot:2'] = 'key';
    sim.runtime.vars['item:key'] = 3;
    const quick = rowsOf(sim, list('quickslots'));
    expect(quick).toHaveLength(4);
    expect(quick[1]!.scope).toMatchObject({ 'slot.number': 2, 'slot.item': 'key', 'slot.count': 3 });
    expect(quick[0]!.scope['slot.item']).toBe('');

    sim.assets.worldMap = WorldMapSchema.parse({
      nodes: [
        MapNodeSchema.parse({ id: 'town', label: 'Town', scene: 'town.scene.json', x: 100, y: 100, unlock: { kind: 'always' } }),
        MapNodeSchema.parse({ id: 'cave', label: 'Cave', scene: 'cave.scene.json', x: 300, y: 100, unlock: { kind: 'variable', name: 'cave', atLeast: 1 } }),
      ],
    });
    sim.runtime.scene = 'town.scene.json';
    let places = rowsOf(sim, list('places'));
    expect(places.map((r) => [r.id, r.scope['place.here']])).toEqual([['town', 1]]);
    sim.runtime.vars.cave = 1;
    places = rowsOf(sim, list('places'));
    expect(places.map((r) => r.scope['place.name'])).toEqual(['Town', 'Cave']);
  });

  it('a plugin adds its own, and a plugin that throws only empties its list', () => {
    const sim = game();
    const demo = definePlugin(
      { id: 'demo-lists', name: 'Demo', version: '1.0.0' },
      {
        install(api) {
          api.listSource({ id: 'pets', label: 'Pets', rows: (_s, arg) => [{ id: 'a', scope: { 'pet.name': `Rex${arg}` } }] });
          api.listSource({ id: 'broken', label: 'Broken', rows: () => { throw new Error('nope'); } });
        },
      },
    );
    pluginHost.register(demo);
    pluginHost.install('demo-lists');
    try {
      expect(rowsOf(sim, list('pets:!'))[0]!.scope['pet.name']).toBe('Rex!');
      expect(rowsOf(sim, list('broken'))).toEqual([]);
      pluginHost.uninstall('demo-lists');
      expect(rowsOf(sim, list('pets'))).toEqual([]);
    } finally {
      pluginHost.uninstall('demo-lists');
    }
  });
});

describe('screens by role', () => {
  it('a screen plays the role it was given, or the one its reserved name has always played', () => {
    expect(roleOfScreen({ name: 'Pause' })).toBe('pause');
    expect(roleOfScreen({ name: 'My menu', role: 'pause' })).toBe('pause');
    expect(roleOfScreen({ name: 'Other' })).toBe('');
    const sim = game([screen('Menu', [], { role: 'pause' }), screen('Title', [])]);
    expect(screenForRole(sim.assets, 'pause')?.name).toBe('Menu');
    expect(screenForRole(sim.assets, 'title')?.name).toBe('Title');
    expect(openRole({ runtime: sim.runtime, assets: sim.assets }, 'pause')).toBe(true);
    expect(sim.runtime.ui.stack).toEqual(['Menu']);
    expect(openRole({ runtime: sim.runtime, assets: sim.assets }, 'map')).toBe(false);
  });

  it('a plugin supplies the screens for the roles a project has none for, and leaves the ones it has', () => {
    const offered = screen('Pause', [w('button', { text: 'Resume' })], { role: 'pause' });
    const credits = screen('Credits', [], { role: 'credits' });
    pluginHost.register(
      definePlugin(
        { id: 'screens-demo', name: 'Screens', version: '1.0.0' },
        {
          install(api) {
            api.screen({ id: 'pause', screen: offered, role: 'pause', revision: 2 });
            api.screen({ id: 'credits', screen: credits, role: 'credits', revision: 1 });
          },
        },
      ),
    );
    pluginHost.install('screens-demo');
    try {
      const empty = UiDocSchema.parse({});
      const filled = withPluginScreens(empty);
      expect(filled.screens.map((s) => s.name)).toEqual(['Pause', 'Credits']);
      expect(filled.screens[0]!.from).toEqual({ plugin: 'screens-demo', screen: 'pause', revision: 2, hash: screenHash(offered) });
      // the project made its own Pause (under another name): the plugin's is not added
      const own = UiDocSchema.parse({ screens: [screen('Menu', [], { role: 'pause' })] });
      expect(withPluginScreens(own).screens.map((s) => s.name)).toEqual(['Menu', 'Credits']);
      // the project is not changed
      expect(empty.screens).toEqual([]);
      // the hash follows the content
      expect(screenHash(offered)).toBe(screenHash(structuredClone(offered)));
      expect(screenHash(offered)).not.toBe(screenHash(screen('Pause', [w('button', { text: 'Other' })])));
    } finally {
      pluginHost.uninstall('screens-demo');
    }
  });
});

describe('buttons that ask the game to do something', () => {
  it('save to a slot, load the latest, restart, travel to a place and reset the controls announce a request', () => {
    const sim = game([screen('Pause', [])]);
    const seen: [string, Record<string, unknown>][] = [];
    for (const name of ['save-request', 'load-request', 'restart-request', 'travel-place-request', 'reset-controls-request']) sim.events.on(name, (e) => seen.push([name, e]));
    runActionList(contextOf(sim), [
      { type: 'saveGame', params: { slot: 'slot2' } },
      { type: 'saveGame', params: {} },
      { type: 'loadGame', params: { slot: 'latest' } },
      { type: 'restartArea', params: {} },
      { type: 'travelToPlace', params: { place: 'cave' } },
      { type: 'resetControls', params: {} },
    ] as never);
    expect(seen.map(([k, e]) => [k, e.slot ?? e.place])).toEqual([
      ['save-request', 'slot2'],
      ['save-request', 'autosave'],
      ['load-request', 'latest'],
      ['restart-request', undefined],
      ['travel-place-request', 'cave'],
      ['reset-controls-request', undefined],
    ]);
  });

  it('a screen can be opened by its role from a button', () => {
    const sim = game([screen('Menu', [], { role: 'pause' }), screen('Start', [w('button', { text: 'Open', on: { click: [{ type: 'uiScreen', params: { op: 'open', screen: 'role:pause' } }], hover: [], change: [] } })])]);
    openRole({ runtime: sim.runtime, assets: sim.assets }, 'pause');
    sim.runtime.ui.stack = ['Start'];
    activateWidget(sim, openScreens(sim)[0]!.view.children[0]!);
    expect(sim.runtime.ui.stack).toEqual(['Start', 'Menu']);
  });
});

describe('the buttons the interface takes', () => {
  it('takes "interact" only when a screen has the focus on a widget that is still there', async () => {
    const { claimedButtons } = await import('./screens-logic');
    const keys = new Set(['a', 'b']);
    expect(claimedButtons({ interact: 1 }, 'a', keys)).toEqual(['interact']);
    expect(claimedButtons({ interact: 0 }, 'a', keys)).toEqual([]); // not pressed
    expect(claimedButtons({}, 'a', keys)).toEqual([]);
    expect(claimedButtons({ interact: 1 }, '', keys)).toEqual([]); // nothing focused
    expect(claimedButtons({ interact: 1 }, 'gone', keys)).toEqual([]); // the focused widget was removed
    expect(claimedButtons({ move_up: 1 }, 'a', keys)).toEqual([]); // walking is never taken
  });
});
