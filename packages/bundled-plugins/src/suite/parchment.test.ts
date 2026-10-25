import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { putRecord } from '@tilewright/plugin-sdk';
import { ItemSchema } from '@tilewright/plugin-inventory';
import { MapNodeSchema, Simulation, UiDocSchema, UiScreenSchema, WorldMapSchema, openRole, type VariableValue } from '@tilewright/runtime';
import { actionDef, activateWidget, host, hover, openScreens, setChoice, setUiBridge, walkView, withPluginScreens, type UiBridge, type ViewNode } from '@tilewright/behaviors';
import { MIN_TRAVEL, NEW_GAME, PAUSE_RESTART, PAUSE_TRAVEL, SLOTS, mapMarks, parchmentPlugin, regionName, waypoints } from '@tilewright/plugin-parchment';
import '@tilewright/bundled-plugins';

/** The Parchment UI kit as a game plays it: every page opened and pressed through the same functions the playbot uses. */

beforeAll(() => {
  host.register(parchmentPlugin);
  host.install('parchment');
});
afterAll(() => host.uninstall('parchment'));

function game(): { sim: Simulation; settings: Record<string, VariableValue>; events: [string, Record<string, unknown>][] } {
  const sim = new Simulation(1);
  sim.assets.ui = withPluginScreens(UiDocSchema.parse({}));
  const settings: Record<string, VariableValue> = { master: 0.8, music: 0.8, sfx: 0.8, voice: 0.8, difficulty: 'normal', screenShake: true, cameraZoom: 1, showFps: false, fullscreen: false, skin: '', language: 'en' };
  const events: [string, Record<string, unknown>][] = [];
  for (const name of ['save-request', 'load-request', 'restart-request', 'quit-request', 'travel-place-request', 'message']) sim.events.on(name, (e) => events.push([name, e]));
  const bridge: UiBridge = { getSetting: (k) => settings[k], setSetting: (k, v) => void (settings[k] = v), can: () => true, title: () => ({ text: 'The Test Game', subtitle: 'a trial' }) };
  setUiBridge(sim, bridge);
  return { sim, settings, events };
}

const nodes = (sim: Simulation): ViewNode[] => {
  const out: ViewNode[] = [];
  for (const { view } of openScreens(sim)) walkView(view, (n) => out.push(n));
  return out;
};
const visible = (sim: Simulation): ViewNode[] => nodes(sim).filter((n) => n.visible);
const byId = (sim: Simulation, id: string): ViewNode => {
  const hit = visible(sim).find((n) => n.node.id === id);
  if (!hit) throw new Error(`no visible widget "${id}"; there are: ${visible(sim).map((n) => n.node.id).join(', ')}`);
  return hit;
};
const rowsOf = (sim: Simulation, id: string): ViewNode[] => visible(sim).filter((n) => n.node.id === id);
const texts = (sim: Simulation): string[] => visible(sim).filter((n) => n.node.type === 'text').map((n) => n.text).filter(Boolean);
const open = (sim: Simulation, role: string): void => void expect(openRole(sim, role), `the ${role} screen`).toBe(true);
const stack = (sim: Simulation): string[] => [...sim.runtime.ui.stack];
const back = (sim: Simulation): void => void actionDef('uiScreen')!.run({ runtime: sim.runtime, assets: sim.assets, events: sim.events } as never, { op: 'back', screen: '' }, { picked: undefined });

describe('the kit', () => {
  it('has a valid screen for every part it plays, with unique names and widget ids, and only things that exist', () => {
    const mine = [...host.ext.screens.values()].filter((d) => d.plugin === 'parchment');
    expect(mine.map((d) => d.role ?? '(page)').sort()).toEqual(['(page)', '(page)', '(page)', 'controls', 'hud', 'inventory', 'load', 'map', 'pause', 'save', 'settings', 'title']);
    const names = new Set<string>();
    for (const d of mine) {
      expect(UiScreenSchema.safeParse(d.screen).success, d.id).toBe(true);
      expect(names.has(d.screen.name), `${d.screen.name} twice`).toBe(false);
      names.add(d.screen.name);
      const ids = new Set<string>();
      const walk = (n: (typeof d.screen)['root']): void => {
        expect(ids.has(n.id), `${d.id}: ${n.id} twice`).toBe(false);
        ids.add(n.id);
        if (n.type === 'plugin') expect(host.ext.widgets.has(n.source), `${d.id}: widget ${n.source}`).toBe(true);
        if ((n.type === 'list' || n.type === 'grid') && n.source && !/^(table:|slots:|menu:)/.test(n.source)) expect([...host.ext.listSources.keys(), 'items', 'places', 'saves', 'controls', 'turns'], `${d.id}: source ${n.source}`).toContain(n.source);
        for (const k of ['click', 'hover', 'change'] as const) for (const a of n.on[k]) expect(actionDef(a.type), `${d.id}: action ${a.type}`).toBeDefined();
        n.children.forEach(walk);
      };
      walk(d.screen.root);
    }
    // the roles are played by the kit, ahead of the engine's own
    const doc = withPluginScreens(UiDocSchema.parse({}));
    for (const role of ['title', 'pause', 'inventory', 'map', 'hud', 'save', 'load', 'settings', 'controls']) expect(doc.screens.find((s) => s.role === role)!.from?.plugin, role).toBe('parchment');
  });
});

describe('the binder (inventory)', () => {
  function stocked() {
    const g = game();
    putRecord(g.sim.assets, 'items', 'sword', ItemSchema.parse({ id: 'sword', name: 'Iron sword', description: 'Plain and sharp.', use: { setVariable: 'equip_weapon', setValue: 'Iron sword', consume: false, message: 'You take up the sword.' } }));
    putRecord(g.sim.assets, 'items', 'bread', ItemSchema.parse({ id: 'bread', name: 'Bread', description: 'Tasty.', use: { heal: 2 } }));
    g.sim.runtime.vars['item:sword'] = 1;
    g.sim.runtime.vars['item:bread'] = 3;
    return g;
  }

  it('is a book of two pages: the paper doll and stats on the left, a four-column grid of cards on the right', () => {
    const { sim } = stocked();
    open(sim, 'inventory');
    expect(stack(sim)).toEqual(['Inventory']);
    const grid = byId(sim, 'binder.grid').node;
    expect([grid.type, grid.columns, grid.style.scroll]).toEqual(['grid', 4, true]);
    expect(byId(sim, 'binder.doll').node.source).toBe('parchment-doll');
    expect(texts(sim)).toEqual(expect.arrayContaining(['Equipment', 'Satchel', 'Stats']));
    // the two pages sit side by side in a row with the spine between them
    const book = byId(sim, 'binder.book').node;
    expect(book.layout).toBe('row');
    expect(book.children.map((c) => c.id)).toEqual(['binder.left', 'binder.spine', 'binder.right']);
    expect(rowsOf(sim, 'binder.card').map((n) => n.scope['item.name'])).toEqual(['Bread', 'Iron sword']);
  });

  it('shows what is carried as cards; pointing at one tells about it; clicking uses it and marks it chosen', () => {
    const { sim } = stocked();
    open(sim, 'inventory');
    expect(texts(sim)).not.toContain('Plain and sharp.');
    const sword = rowsOf(sim, 'binder.card').find((n) => n.scope['item.id'] === 'sword')!;
    hover(sim, sword);
    expect(sim.runtime.vars.binder_name).toBe('Iron sword');
    expect(sim.runtime.vars.binder_detail).toBe('Plain and sharp. - press E to use');
    expect(texts(sim)).toEqual(expect.arrayContaining(['Iron sword', 'Plain and sharp. - press E to use']));
    expect(rowsOf(sim, 'binder.card.chosen')).toHaveLength(0);
    activateWidget(sim, sword);
    expect(sim.runtime.vars.binder_pick).toBe('sword');
    expect(sim.runtime.vars.equip_weapon).toBe('Iron sword'); // using the sword put it in the weapon slot
    expect(rowsOf(sim, 'binder.card.chosen')).toHaveLength(1);
    // the slot of the paper doll now says so
    const weapon = rowsOf(sim, 'binder.slot').find((n) => n.scope['slot.id'] === 'weapon')!;
    expect(weapon.scope['slot.item']).toBe('Iron sword');
    expect(rowsOf(sim, 'binder.slot').map((n) => n.scope['slot.label'])).toEqual(SLOTS.map((s) => s.label));
    expect(rowsOf(sim, 'binder.slot').find((n) => n.scope['slot.id'] === 'head')!.scope['slot.item']).toBe('-');
  });

  it('lists the stats: the player’s health and every variable called stat_<name>', () => {
    const { sim } = stocked();
    sim.runtime.vars.stat_attack = 4;
    sim.runtime.vars.stat_fire_resist = 12;
    sim.runtime.vars.stat_proud = true; // a flag is not a stat
    open(sim, 'inventory');
    expect(rowsOf(sim, 'binder.stat').map((n) => [n.scope['stat.name'], n.scope['stat.value']])).toEqual([['Attack', 4], ['Fire resist', 12]]);
  });

  it('says when nothing is carried', () => {
    const { sim } = game();
    open(sim, 'inventory');
    expect(texts(sim)).toContain('You are carrying nothing.');
  });
});

describe('the map', () => {
  const place = (id: string, x: number, y: number, over: object = {}) => MapNodeSchema.parse({ id, label: id[0]!.toUpperCase() + id.slice(1), scene: `${id}.scene.json`, x, y, unlock: { kind: 'always' }, ...over });

  function world() {
    const g = game();
    g.sim.assets.worldMap = WorldMapSchema.parse({
      title: 'The Realm',
      nodes: [
        place('hub', 500, 300),
        place('inn', 520, 330), // a few steps from the hub: not worth a journey
        place('cave', 250, 150),
        place('tower', 800, 120, { unlock: { kind: 'variable', name: 'tower', atLeast: 1 } }), // seen as a "?"
        place('vault', 800, 500, { unlock: { kind: 'variable', name: 'vault', atLeast: 1 }, hidden: true }), // not found yet
      ],
      links: [{ a: 'hub', b: 'cave' }, { a: 'hub', b: 'tower' }, { a: 'hub', b: 'inn' }],
    });
    g.sim.runtime.scene = 'hub.scene.json';
    return g;
  }

  it('lists the places to travel to: not the one the player is in, not those too close, not those only guessed at or not found', () => {
    const { sim } = world();
    expect(waypoints(sim).map((w) => w.node.id)).toEqual(['cave']);
    expect(Math.hypot(520 - 500, 330 - 300)).toBeLessThan(MIN_TRAVEL);
    sim.runtime.vars.tower = 1;
    sim.runtime.vars.vault = 1;
    expect(waypoints(sim).map((w) => w.node.id).sort()).toEqual(['cave', 'tower', 'vault']);
  });

  it('draws only what has been found: lit waypoints, a dim place too close, "?" for a guess, nothing for the unfound, and where you are', () => {
    const { sim } = world();
    expect(mapMarks(sim).map((m) => [m.id, m.look, m.label])).toEqual([
      ['hub', 'here', 'Hub'],
      ['inn', 'near', 'Inn'],
      ['cave', 'lit', 'Cave'],
      ['tower', 'unknown', '?'],
    ]);
  });

  it('has a chapter list (the rows of a table called Chapters, up to the variable chapter), the picture and the waypoints', () => {
    const { sim, events } = world();
    sim.assets.tables.set('Chapters', { name: 'Chapters', columns: [{ id: 'name', type: 'text' }], rows: [{ id: 'c1', name: 'The road' }, { id: 'c2', name: 'The cave' }, { id: 'c3', name: 'The tower' }] } as never);
    sim.runtime.vars.chapter = 2;
    open(sim, 'map');
    expect(texts(sim)).toContain('The Realm');
    expect(rowsOf(sim, 'map.chapter').map((n) => [n.scope['chapter.name'], n.scope['chapter.current']])).toEqual([['The road', 0], ['The cave', 1]]);
    expect(byId(sim, 'map.picture').node.source).toBe('parchment-map');
    expect(rowsOf(sim, 'map.waypoint').map((n) => n.scope['place.name'])).toEqual(['Cave']);
    // choosing a waypoint travels there and closes the map
    activateWidget(sim, rowsOf(sim, 'map.waypoint')[0]!);
    expect(events.filter((e) => e[0] === 'travel-place-request').map((e) => e[1].place)).toEqual(['cave']);
    expect(stack(sim)).toEqual([]);
  });

  it('says so when there is nothing to travel to, and when the story has not begun', () => {
    const { sim } = game();
    open(sim, 'map');
    expect(texts(sim)).toEqual(expect.arrayContaining(['The story has not begun.', 'Nowhere to go from here.']));
  });
});

describe('the pause menu', () => {
  it('has a description under the menu that follows the chosen row, whether pointed at or chosen with the keys', () => {
    const { sim } = game();
    open(sim, 'pause');
    expect(rowsOf(sim, 'pause.resume')).toHaveLength(1);
    expect(texts(sim)).not.toContain('Back to the game.');
    hover(sim, byId(sim, 'pause.resume'));
    expect(texts(sim)).toContain('Back to the game.');
    hover(sim, byId(sim, 'pause.restart'));
    expect(texts(sim)).toContain('Start this area again (it asks first).');
  });

  it('Travel and Restart are pages that replace the list; Back goes to the pause menu, not out of the menu', () => {
    const { sim, events } = game();
    open(sim, 'pause');
    activateWidget(sim, byId(sim, 'pause.travel'));
    expect(stack(sim)).toEqual(['Pause', PAUSE_TRAVEL]);
    expect(texts(sim)).toContain('Nowhere to go from here yet.');
    back(sim);
    expect(stack(sim)).toEqual(['Pause']);
    activateWidget(sim, byId(sim, 'pause.restart'));
    expect(stack(sim)).toEqual(['Pause', PAUSE_RESTART]);
    expect(texts(sim)).toContain('Restart?');
    activateWidget(sim, byId(sim, 'restart.no'));
    expect(stack(sim)).toEqual(['Pause']);
    expect(events.some((e) => e[0] === 'restart-request')).toBe(false);
    activateWidget(sim, byId(sim, 'pause.restart'));
    activateWidget(sim, byId(sim, 'restart.yes'));
    expect(events.map((e) => e[0])).toEqual(['restart-request']);
    expect(stack(sim)).toEqual([]);
  });

  it('Travel lists the places that are worth a journey and goes there, closing the menu', () => {
    const { sim, events } = game();
    sim.assets.worldMap = WorldMapSchema.parse({ nodes: [MapNodeSchema.parse({ id: 'a', label: 'Alder', scene: 'a.scene.json', x: 100, y: 100, unlock: { kind: 'always' } }), MapNodeSchema.parse({ id: 'b', label: 'Birch', scene: 'b.scene.json', x: 600, y: 100, unlock: { kind: 'always' } })], links: [{ a: 'a', b: 'b' }] });
    sim.runtime.scene = 'a.scene.json';
    open(sim, 'pause');
    activateWidget(sim, byId(sim, 'pause.travel'));
    expect(rowsOf(sim, 'travel.place').map((n) => [n.scope['place.name'], n.scope['place.hint']])).toEqual([['Birch', 'a long way']]);
    activateWidget(sim, rowsOf(sim, 'travel.place')[0]!);
    expect(events.find((e) => e[0] === 'travel-place-request')![1].place).toBe('b');
    expect(stack(sim)).toEqual([]);
  });

  it('Resume closes it, and Settings, Save and Load open the engine’s own pages', () => {
    const { sim } = game();
    open(sim, 'pause');
    activateWidget(sim, byId(sim, 'pause.resume'));
    expect(stack(sim)).toEqual([]);
    for (const [row, name] of [['pause.settings', 'Settings'], ['pause.save', 'Save game'], ['pause.load', 'Load game'], ['pause.inventory', 'Inventory']] as const) {
      open(sim, 'pause');
      activateWidget(sim, byId(sim, row));
      expect(stack(sim), row).toEqual(['Pause', name]);
      sim.runtime.ui.stack = [];
    }
  });
});

describe('the title and a difficulty that is locked for the save', () => {
  it('New game asks how hard; the choice is set, the game begins, and the difficulty is locked for the save', () => {
    const { sim, settings } = game();
    open(sim, 'title');
    expect(texts(sim)).toEqual(expect.arrayContaining(['The Test Game', 'a trial']));
    activateWidget(sim, byId(sim, 'title.new'));
    expect(stack(sim)).toEqual(['Title', NEW_GAME]);
    expect(texts(sim)).toContain('How hard?');
    expect(sim.runtime.vars.difficulty_locked).toBeUndefined();
    activateWidget(sim, byId(sim, 'new.hard'));
    expect(settings.difficulty).toBe('hard');
    expect(sim.runtime.vars.difficulty_locked).toBe(1);
    expect(stack(sim)).toEqual([]);
  });

  it('Back from the question goes to the title, and nothing was chosen', () => {
    const { sim, settings } = game();
    open(sim, 'title');
    activateWidget(sim, byId(sim, 'title.new'));
    back(sim);
    expect(stack(sim)).toEqual(['Title']);
    expect(settings.difficulty).toBe('normal');
    expect(sim.runtime.vars.difficulty_locked).toBeUndefined();
  });

  it('Settings can change the difficulty until a game has begun, and then shows it locked', () => {
    const { sim, settings } = game();
    open(sim, 'settings');
    const choice = byId(sim, 'difficulty.choice');
    expect(choice.enabled).toBe(true);
    expect(visible(sim).some((n) => n.node.id === 'difficulty.locked')).toBe(false);
    sim.runtime.vars.difficulty_locked = 1;
    expect(byId(sim, 'difficulty.choice').enabled).toBe(false);
    expect(byId(sim, 'difficulty.locked').text).toBe('locked for this save');
    setChoice(sim, byId(sim, 'difficulty.choice'), 'easy');
    // (a choice that is not usable is not offered by the screen; the setting is changed only by the New game page)
    expect(settings.difficulty).toBe('easy');
  });
});

describe('the heads-up display', () => {
  it('shows a gauge, a counter, the region name, a prompt, a boss bar, narrator text and message slips, each only when it has something to say', () => {
    const { sim } = game();
    open(sim, 'hud');
    expect(visible(sim).map((n) => n.node.id)).toEqual(expect.arrayContaining(['hud.gauge', 'hud.gauge.bar', 'hud.region', 'hud.slips']));
    for (const id of ['hud.counter', 'hud.boss', 'hud.prompt', 'hud.narrator']) expect(visible(sim).some((n) => n.node.id === id), id).toBe(false);
    sim.runtime.vars.gold = 12;
    sim.runtime.vars.prompt = 'Press E to open';
    sim.runtime.vars.boss_name = 'The Warden';
    sim.runtime.vars.boss_hp = 30;
    sim.runtime.vars.boss_max = 60;
    sim.runtime.vars.narrator = 'The wind carried a name.';
    expect(texts(sim)).toEqual(expect.arrayContaining(['12', 'Press E to open', 'The Warden', 'The wind carried a name.']));
    expect(byId(sim, 'hud.boss.bar').fraction).toBe(0.5);
    expect(byId(sim, 'hud.narrator').node.anim[0]).toMatchObject({ on: 'show', kind: 'fade' });
  });

  it('is a heads-up display: the game goes on behind it and Back is not taken by it', () => {
    const hud = [...host.ext.screens.values()].find((d) => d.plugin === 'parchment' && d.role === 'hud')!.screen;
    expect([hud.modal, hud.dim]).toEqual([false, 0]);
  });

  it('knows which region the player stands in', () => {
    const { sim } = game();
    sim.runtime.regions = [{ id: 'r1', name: 'The Marsh', x: 0, y: 0, w: 10, h: 10, cameraBounds: false, music: '', darkness: 0, bossActive: false }];
    expect(regionName(sim)).toBe('');
    const player = sim.world.spawn({ name: 'Player', tags: ['player'], components: { transform: { x: 4, y: 4, h: 0, facing: 2 } } });
    expect(regionName(sim)).toBe('The Marsh');
    player.set('transform', { x: 40, y: 4, h: 0, facing: 2 });
    expect(regionName(sim)).toBe('');
  });
});
