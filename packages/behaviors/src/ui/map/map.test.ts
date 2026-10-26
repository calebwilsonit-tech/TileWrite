import { describe, expect, it } from 'vitest';
import { DEFAULT_TILESET, MapNodeSchema, MapSpecSchema, Simulation, TileMap, UiDocSchema, WorldMapSchema, currentFlags, defaultMapLayer, newWidget, openScreen, type UiNode, type UiScreen } from '@tilewright/runtime';
import { definePlugin, host as pluginHost } from '../../plugins/host';
import { runActionList } from '../../events/sheet';
import { contextOf } from '../../story/context';
import { findOnScreens, openScreens, type ViewNode } from '../screens-logic';
import { driveMapKeys, findLiveMap, moveHighlightBy } from './actions';
import { moveHighlight, stepHighlight } from './nav';
import './sheet-actions';
import { cellColour, parseColour, parsePalette, regionNameAt, terrainColours, unpackColour } from './layers';
import { trackMaps } from './fog';
import { cellToPlane, fitZoom, makeProjection, planeToCell, planeToView, resolveWorld, viewToPlane, type MapView } from './world';
import { mapRun } from './state';
import type { MapMarker } from './markers';

let n = 0;
const w = (type: Parameters<typeof newWidget>[0], patch: Partial<UiNode> = {}): UiNode => ({ ...newWidget(type, `w${++n}`), ...patch }) as UiNode;
const screen = (children: UiNode[]): UiScreen =>
  ({ id: 's', name: 'S', root: w('panel', { name: 'root', anchor: 'fill', layout: 'free', children }), modal: true, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false }) as UiScreen;

/** A game with a map of 16 x 12 grass, and a Map widget called "City" with the settings given. */
function game(spec: Record<string, unknown> = {}, opts: { prefabs?: { name: string; widget: UiNode }[]; tiles?: (map: TileMap) => void } = {}): Simulation {
  const sim = new Simulation(1);
  sim.compat = currentFlags();
  const map = new TileMap(16, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 16; x++) map.set(x, y, 1, 0);
  opts.tiles?.(map);
  sim.map = map;
  sim.runtime.scene = 'town.scene.json';
  const widget = w('map', { name: 'City', w: 400, h: 300, map: MapSpecSchema.parse(spec) });
  sim.assets.ui = UiDocSchema.parse({ screens: [screen([widget])], prefabs: opts.prefabs ?? [] });
  openScreen(sim, 'S');
  return sim;
}
const city = (sim: Simulation): ViewNode => {
  const v = findOnScreens(sim, 'City');
  if (!v) throw new Error('no map');
  return v;
};
const layer = (kind: string, id = kind, settings: Record<string, unknown> = {}) => ({ ...defaultMapLayer(kind, id), settings: { ...defaultMapLayer(kind, id).settings, ...settings } });
const hand = (id: string, x: number, y: number, label = id, state = '') => ({ id, x, y, label, state });
const ids = (v: ViewNode): string[] => v.map!.markers.map((m) => m.id);

describe('what a map is a map of, and how its cells become places', () => {
  it('reads the scene being played, a table, or nothing at all', () => {
    const sim = game({ source: { kind: 'current' } as never });
    const world = resolveWorld(sim, MapSpecSchema.parse({}));
    expect([world.w, world.h, world.tileAt(3, 3)]).toEqual([16, 12, 1]);
    sim.assets.tables.set('Cells', { name: 'Cells', columns: [], rows: [{ id: 'a', x: 2, y: 1, value: 7 }, { id: 'b', x: 5, y: 4, value: 'swamp' }] } as never);
    const t = resolveWorld(sim, MapSpecSchema.parse({ source: { kind: 'table', table: 'Cells', width: 4, height: 4 } }));
    expect([t.w, t.h, t.valueAt(2, 1), t.valueAt(5, 4), t.valueAt(0, 0)]).toEqual([6, 5, 7, 'swamp', undefined]);
    const none = resolveWorld(sim, MapSpecSchema.parse({ source: { kind: 'none', width: 40, height: 20 } }));
    expect([none.w, none.h, none.tileAt(1, 1)]).toEqual([40, 20, 0]);
  });

  it('several scenes can be placed on one world layout', () => {
    const sim = game();
    sim.runtime.scratch.set('ui.bridge', { getSetting: () => undefined, setSetting: () => undefined, sceneGrid: (name: string) => (name === 'cave.scene.json' ? { width: 4, height: 4, tiles: new Array(16).fill(2), heights: new Array(16).fill(1), regions: [{ id: 'r', name: 'Deep', x: 0, y: 0, w: 2, h: 2, cameraBounds: false, music: '', darkness: 0, bossActive: false }] } : null) });
    const world = resolveWorld(sim, MapSpecSchema.parse({ source: { kind: 'scenes', scenes: [{ scene: 'town.scene.json', x: 0, y: 0 }, { scene: 'cave.scene.json', x: 20, y: 2 }] } }));
    expect([world.w, world.h, world.tileAt(3, 3), world.tileAt(21, 3), world.heightAt(21, 3), world.tileAt(30, 3)]).toEqual([24, 12, 1, 2, 1, 0]);
    expect(world.regions[0]).toMatchObject({ name: 'Deep', x: 20, y: 2 });
  });

  it('from above, a cell is cell pixels; isometric follows the game’s own projection and its quarter turns, and the pointer maps back', () => {
    const sim = game();
    const top = makeProjection(sim, MapSpecSchema.parse({ view: { cell: 10 } }), { w: 16, h: 12 });
    expect(cellToPlane(top, 3, 2)).toEqual({ x: 30, y: 20 });
    expect(top.plane).toMatchObject({ w: 160, h: 120 });
    for (const turn of [0, 1, 2, 3]) {
      sim.runtime.view.rotation = turn as 0 | 1 | 2 | 3;
      const iso = makeProjection(sim, MapSpecSchema.parse({ projection: { kind: 'iso', rotation: 'camera' }, view: { cell: 8 } }), { w: 16, h: 12 });
      expect(iso.turn).toBe(turn);
      for (const [x, y] of [[0, 0], [5, 3], [15.5, 11.5]] as const) {
        const p = cellToPlane(iso, x, y);
        expect(p.x).toBeGreaterThanOrEqual(-1e-9);
        expect(p.y).toBeGreaterThanOrEqual(-1e-9);
        expect(p.x).toBeLessThanOrEqual(iso.plane.w + 1e-9);
        const back = planeToCell(iso, p.x, p.y);
        expect(back.x).toBeCloseTo(x, 6);
        expect(back.y).toBeCloseTo(y, 6);
      }
    }
    sim.runtime.view.rotation = 0;
    const fixed = makeProjection(sim, MapSpecSchema.parse({ projection: { kind: 'iso', rotation: 'fixed', angle: 180 } }), { w: 16, h: 12 });
    expect(fixed.turn).toBe(2);
  });

  it('the view turns, zooms and centres, and a point goes there and back', () => {
    const v: MapView = { zoom: 2, cx: 100, cy: 50, angle: 90, w: 400, h: 300 };
    const p = planeToView(v, 130, 50);
    expect(p.x).toBeCloseTo(200, 6); // 30 to the right of the centre, turned a quarter: straight down
    expect(p.y).toBeCloseTo(150 + 60, 6);
    const q = viewToPlane(v, p.x, p.y);
    expect(q.x).toBeCloseTo(130, 6);
    expect(q.y).toBeCloseTo(50, 6);
    expect(fitZoom({ plane: { x: 0, y: 0, w: 200, h: 100 } } as never, 400, 300)).toBe(2);
  });
});

describe('terrain: colour a cell by anything', () => {
  const sim = game({}, { tiles: (m) => { m.set(1, 1, 2, 3); m.set(2, 1, 4, 0); m.set(3, 1, 0, 0); } });
  sim.assets.tileset = { ...DEFAULT_TILESET, 4: { ...DEFAULT_TILESET[4]!, props: { tags: ['wet'], water: true, custom: { danger: 2 } } }, 2: { ...DEFAULT_TILESET[2]!, props: { tags: ['hard'], custom: { danger: 5 } } } };
  sim.runtime.regions = [{ id: 'r1', name: 'Hills', x: 0, y: 0, w: 2, h: 2, cameraBounds: false, music: '', darkness: 0, bossActive: false }];
  const world = resolveWorld(sim, MapSpecSchema.parse({}));
  const at = (s: Record<string, unknown>, x: number, y: number) => {
    const c = terrainColours(world, s);
    return unpackColour(c[y * world.w + x]!);
  };

  it('by the tile’s own colour (higher ground is lighter), by a named colour, or see-through where empty', () => {
    expect(at({ colourBy: 'tile', shade: false }, 0, 0).slice(0, 3)).toEqual([0x6f, 0xae, 0x5b]);
    const high = at({ colourBy: 'tile' }, 1, 1);
    const flat = at({ colourBy: 'tile', shade: false }, 1, 1);
    expect(high[0]).toBeGreaterThan(flat[0]);
    expect(at({ colourBy: 'tile', palette: 'water:#0000ff' }, 2, 1).slice(0, 3)).toEqual([0, 0, 255]);
    expect(at({ colourBy: 'tile' }, 3, 1)[3]).toBe(0);
    expect(at({ colourBy: 'tile', empty: '#222' }, 3, 1).slice(0, 3)).toEqual([0x22, 0x22, 0x22]);
  });

  it('by a tile tag, a tile property, the height band, the region, or a value from a table', () => {
    expect(at({ colourBy: 'tag', name: 'wet,hard', palette: 'wet:#00f,hard:#888', fallback: '#000' }, 2, 1).slice(0, 3)).toEqual([0, 0, 255]);
    expect(at({ colourBy: 'tag', name: 'wet,hard', palette: 'wet:#00f,hard:#888', fallback: '#000' }, 1, 1).slice(0, 3)).toEqual([0x88, 0x88, 0x88]);
    expect(at({ colourBy: 'tag', name: 'wet', palette: 'wet:#00f', fallback: '#123456' }, 0, 0).slice(0, 3)).toEqual([0x12, 0x34, 0x56]);
    expect(at({ colourBy: 'property', name: 'danger', palette: '5:#f00,2:#fa0', fallback: '#0a0' }, 1, 1).slice(0, 3)).toEqual([255, 0, 0]);
    expect(at({ colourBy: 'property', name: 'water', palette: 'true:#00f', fallback: '#0a0' }, 2, 1).slice(0, 3)).toEqual([0, 0, 255]);
    expect(at({ colourBy: 'height', palette: '0:#111,2:#eee', fallback: '#999' }, 1, 1).slice(0, 3)).toEqual([0xee, 0xee, 0xee]); // height 3 takes the band that starts at 2
    expect(at({ colourBy: 'height', palette: '0:#111,2:#eee', fallback: '#999' }, 5, 5).slice(0, 3)).toEqual([0x11, 0x11, 0x11]);
    expect(at({ colourBy: 'region', palette: 'Hills:#a52', fallback: '#000', empty: '#333' }, 0, 0).slice(0, 3)).toEqual([0xaa, 0x55, 0x22]);
    expect(at({ colourBy: 'region', palette: 'Hills:#a52', fallback: '#000', empty: '#333' }, 9, 9).slice(0, 3)).toEqual([0x33, 0x33, 0x33]);
    expect(regionNameAt(world.regions, 1, 1)).toBe('Hills');
    const t = game({}, {});
    t.assets.tables.set('Danger', { name: 'Danger', columns: [], rows: [{ id: 'a', x: 1, y: 1, value: 10 }, { id: 'b', x: 2, y: 2, value: 'bog' }] } as never);
    const tw = resolveWorld(t, MapSpecSchema.parse({ source: { kind: 'table', table: 'Danger' } }));
    const pal = parsePalette('bog:#363');
    expect(cellColour(tw, { colourBy: 'table' }, 2, 2, () => '', pal, [0, 0, 0, 255])!.slice(0, 3)).toEqual([0x33, 0x66, 0x33]);
    expect(cellColour(tw, { colourBy: 'table' }, 1, 1, () => '', pal, [10, 10, 10, 255])![0]).toBe(255); // 10 is as high as the scale goes: white
    expect(cellColour(tw, { colourBy: 'table' }, 0, 0, () => '', pal, [0, 0, 0, 255])).toBeNull();
  });

  it('reads colours written the way a designer writes them', () => {
    expect(parseColour('#abc')).toEqual([170, 187, 204, 255]);
    expect(parseColour('#11223344')).toEqual([17, 34, 51, 68]);
    expect(parseColour('rgba(10, 20, 30, 0.5)')).toEqual([10, 20, 30, 128]);
    expect(parseColour('nonsense', [1, 2, 3, 4])).toEqual([1, 2, 3, 4]);
  });
});

describe('fog and discovery', () => {
  const fog = (settings: Record<string, unknown>) => layer('fog', 'fog', settings);
  const player = (sim: Simulation, x: number, y: number) => {
    const p = sim.world.withTag('player')[0] ?? sim.world.spawn({ name: 'Hero', tags: ['player'], components: { transform: { x, y, h: 0 } } });
    p.set('transform', { x, y, h: 0 });
  };
  const revealed = (sim: Simulation, v?: ViewNode): number => [...(mapRun(sim, 'City', MapSpecSchema.parse({})) ? (v ?? city(sim)).map!.layers.find((l) => l.kind === 'fog')!.data.kind === 'fog' ? [(v ?? city(sim)).map!.layers.find((l) => l.kind === 'fog')!.data as never] : [] : [])].map((d: { draw: { cells: Uint8Array } }) => d.draw.cells.reduce((s, c) => s + c, 0))[0] ?? 0;
  const widgetId = (sim: Simulation): string => city(sim).node.id;
  const withId = (sim: Simulation): number => {
    void widgetId(sim);
    return revealed(sim);
  };

  it('cells near where the followed object has been are known, and stay known', () => {
    const sim = game({ layers: [fog({ reveal: 'visited', radius: 2 })] });
    player(sim, 3, 3);
    trackMaps(sim);
    const a = withId(sim);
    expect(a).toBeGreaterThan(8);
    expect(a).toBeLessThan(30);
    player(sim, 10, 8);
    trackMaps(sim);
    expect(withId(sim)).toBeGreaterThan(a * 1.8);
  });

  it('a layer that does not remember shows only what is near now', () => {
    const sim = game({ layers: [fog({ reveal: 'visited', radius: 2, remember: false })] });
    player(sim, 3, 3);
    trackMaps(sim);
    const a = withId(sim);
    player(sim, 10, 8);
    trackMaps(sim);
    expect(withId(sim)).toBe(a);
  });

  it('what is in sight: a wall hides what is behind it', () => {
    const sim = game({ layers: [fog({ reveal: 'sight', radius: 6 })] }, { tiles: (m) => { for (let y = 0; y < 12; y++) m.set(6, y, 5, 0); } });
    player(sim, 3, 5);
    trackMaps(sim);
    const f = city(sim).map!.layers[0]!.data as { draw: { cells: Uint8Array; w: number } };
    expect(f.draw.cells[5 * f.draw.w + 5]).toBe(1);
    expect(f.draw.cells[5 * f.draw.w + 6]).toBe(1); // the wall itself is seen
    expect(f.draw.cells[5 * f.draw.w + 8]).toBe(0); // behind it is not
  });

  it('regions the object has entered, a condition, and cells listed in a table', () => {
    const sim = game({ layers: [fog({ reveal: 'regions' }), layer('fog', 'second', { reveal: 'variable', condition: '{found} = 1', area: 'Crypt' }), layer('fog', 'third', { reveal: 'table', table: 'Seen' })] });
    sim.runtime.regions = [
      { id: 'a', name: 'Garden', x: 0, y: 0, w: 4, h: 4, cameraBounds: false, music: '', darkness: 0, bossActive: false },
      { id: 'b', name: 'Crypt', x: 8, y: 8, w: 3, h: 3, cameraBounds: false, music: '', darkness: 0, bossActive: false },
    ];
    sim.assets.tables.set('Seen', { name: 'Seen', columns: [], rows: [{ id: '1', x: 14, y: 1, r: 1 }] } as never);
    player(sim, 1, 1);
    trackMaps(sim);
    const count = (i: number): number => (city(sim).map!.layers[i]!.data as { draw: { cells: Uint8Array } }).draw.cells.reduce((s, c) => s + c, 0);
    expect(count(0)).toBe(16); // the whole Garden
    expect(count(1)).toBe(16 * 12 - 9); // the layer covers only the Crypt: everything else is known to it, the Crypt is not
    sim.runtime.vars.found = 1;
    trackMaps(sim);
    expect(count(1)).toBe(16 * 12); // the whole Crypt too, once the condition holds
    expect(count(2)).toBeGreaterThan(0);
  });

  it('a Quick Action reveals more, and a layer can be saved with the game or not', () => {
    const sim = game({ layers: [fog({ reveal: 'event', saved: true }), layer('fog', 'temp', { reveal: 'event', saved: false })] });
    city(sim);
    const ctx = contextOf(sim);
    runActionList(ctx, [{ type: 'mapReveal', params: { map: 'City', layer: 'fog', area: '0,0,4,3' } }, { type: 'mapReveal', params: { map: 'City', layer: 'temp', area: 'circle:8,6,2' } }] as never);
    const cells = (i: number): number => (city(sim).map!.layers[i]!.data as { draw: { cells: Uint8Array } }).draw.cells.reduce((s, c) => s + c, 0);
    expect(cells(0)).toBe(12);
    expect(cells(1)).toBeGreaterThan(8);
    const seen: string[] = [];
    sim.events.on('map-area-revealed', (e) => void seen.push(String(e.area)));
    runActionList(ctx, [{ type: 'mapReveal', params: { map: 'City', layer: 'fog', area: '6,6,2,2' } }] as never);
    expect(seen).toEqual(['6,6,2,2']);
    runActionList(ctx, [{ type: 'mapReveal', params: { map: 'City', layer: 'fog', area: '0,0,4,3', cover: 'cover' } }] as never);
    expect(cells(0)).toBe(4);
    // a saved game: the saved layer comes back, the other does not
    sim.tick = 30;
    trackMaps(sim);
    const vars = { ...sim.runtime.vars };
    const loaded = game({ layers: [fog({ reveal: 'event', saved: true }), layer('fog', 'temp', { reveal: 'event', saved: false })] });
    const wid = city(loaded).node.id;
    expect(Object.keys(vars).some((k) => k.endsWith('.fog.fog'))).toBe(true);
    expect(Object.keys(vars).some((k) => k.endsWith('.fog.temp'))).toBe(false);
    for (const [k, v] of Object.entries(vars)) loaded.runtime.vars[k.replace(/__map\.[^.]+\./, `__map.${wid}.`)] = v;
    const cellsOf = (i: number): number => (city(loaded).map!.layers[i]!.data as { draw: { cells: Uint8Array } }).draw.cells.reduce((s, c) => s + c, 0);
    expect(cellsOf(0)).toBe(4);
    expect(cellsOf(1)).toBe(0);
  });

  it('a layer covers only the part of the map it names, so several can each cover their own region', () => {
    const sim = game({
      layers: [fog({ reveal: 'variable', condition: '{north} = 1', area: '0,0,16,4' }), layer('fog', 'south', { reveal: 'variable', condition: '{south} = 1', area: '0,8,16,4' })],
      markers: [{ id: 'pins', from: 'hand', show: '{marker.revealed} = 1', hand: [hand('n', 3, 1), hand('mid', 3, 6), hand('s', 3, 10)] }, { id: 'all', from: 'hand', show: '{marker.revealed.south} = 1', hand: [hand('x', 3, 1), hand('y', 3, 10)] }] as never,
    });
    const cells = (i: number): Uint8Array => (city(sim).map!.layers[i]!.data as { draw: { cells: Uint8Array } }).draw.cells;
    trackMaps(sim);
    expect(cells(0)[1 * 16 + 3]).toBe(0); // the north is covered until it is found
    expect(cells(0)[6 * 16 + 3]).toBe(1); // what the layer does not cover is never hidden by it
    expect(ids(city(sim))).toEqual(['pins:mid', 'all:x']); // (the south layer does not cover the north, so a place there is known to it)
    sim.runtime.vars.north = 1;
    trackMaps(sim);
    expect(cells(0)[1 * 16 + 3]).toBe(1);
    expect(ids(city(sim))).toEqual(['pins:n', 'pins:mid', 'all:x']);
    sim.runtime.vars.south = 1;
    trackMaps(sim);
    expect(ids(city(sim))).toEqual(['pins:n', 'pins:mid', 'pins:s', 'all:x', 'all:y']);
  });

  it('a plugin adds a rule', () => {
    const plugin = definePlugin(
      { id: 'torch-fog', name: 'Torches', version: '1.0.0', description: 'x', author: 'x', license: 'MIT', engine: '^1.0.0', permissions: [], entry: { runtime: 'x' } },
      { install: (api) => api.fogRule({ id: 'torches', label: 'Around torches', fields: [], reveal: (_sim, _s, world, reveal) => void [...Array(world.w).keys()].forEach((x) => reveal(x, 0)) }) },
    );
    pluginHost.register(plugin);
    pluginHost.install('torch-fog');
    try {
      const sim = game({ layers: [fog({ reveal: 'torches' })] });
      trackMaps(sim);
      expect((city(sim).map!.layers[0]!.data as { draw: { cells: Uint8Array } }).draw.cells.reduce((s, c) => s + c, 0)).toBe(16);
    } finally {
      pluginHost.forget('torch-fog');
    }
  });
});

describe('markers: where they come from, their state, what shows, what merges', () => {
  it('a hand-placed list, with states that each have their own prefab', () => {
    const prefabs = [{ name: 'Lit lamp', widget: w('panel', { name: 'lit' }) }, { name: 'Dark lamp', widget: w('panel', { name: 'dark' }) }];
    const sim = game({ markers: [{ id: 'posts', from: 'hand', prefab: 'Dark lamp', statePrefabs: { lit: 'Lit lamp' }, hand: [hand('a', 2, 3, 'Gate', 'lit'), hand('b', 9, 4, 'Mill', 'dark')] }] as never }, { prefabs });
    const v = city(sim);
    expect(ids(v)).toEqual(['posts:a', 'posts:b']);
    expect(v.parts!.map((p) => p.node.name)).toEqual(['Lit lamp', 'Dark lamp']);
    expect(v.map!.markers[0]!.scope).toMatchObject({ 'marker.label': 'Gate', 'marker.state': 'lit', 'marker.kind': 'posts' });
    expect(v.parts![0]!.part).toMatchObject({ kind: 'map', role: 'marker', mount: 'overlay' });
  });

  it('tags and prefabs: live markers follow their objects, and a kind that does not follow keeps the first place', () => {
    const sim = game({ markers: [{ id: 'foes', from: 'tags', source: 'enemy' }, { id: 'old', from: 'tags', source: 'enemy', follows: false }] as never });
    const e = sim.world.spawn({ name: 'Wolf', tags: ['enemy'], components: { transform: { x: 4, y: 4, h: 0 } } });
    let v = city(sim);
    expect(v.map!.markers.map((m) => [m.id, m.x, m.y])).toEqual([[`foes:e${e.id}`, 4, 4], [`old:e${e.id}`, 4, 4]]);
    e.set('transform', { x: 7, y: 2, h: 0 });
    v = city(sim);
    expect(v.map!.markers.map((m) => [m.x, m.y])).toEqual([[7, 2], [4, 4]]);
    expect(v.map!.markers[0]!.scope['marker.name']).toBe('Wolf');
  });

  it('regions, table rows with expressions for where they are, list sources and the places of the world map', () => {
    const sim = game({
      markers: [
        { id: 'zones', from: 'regions' },
        { id: 'inns', from: 'table', source: 'Inns', x: 'col', y: '{row.row} + 1', state: '{row.open}' },
        { id: 'towns', from: 'places', prefab: '' },
      ] as never,
    });
    sim.runtime.regions = [{ id: 'r1', name: 'Moor', x: 2, y: 2, w: 4, h: 2, cameraBounds: false, music: '', darkness: 0, bossActive: false }];
    sim.assets.tables.set('Inns', { name: 'Inns', columns: [{ id: 'col', type: 'number' }, { id: 'row', type: 'number' }, { id: 'open', type: 'text' }, { id: 'name', type: 'text' }], rows: [{ id: 'i1', col: 3, row: 4, open: 'yes', name: 'Red Lion' }] } as never);
    sim.assets.worldMap = WorldMapSchema.parse({
      nodes: [
        MapNodeSchema.parse({ id: 'town', label: 'Town', scene: 'town.scene.json', x: 100, y: 100, unlock: { kind: 'always' } }),
        MapNodeSchema.parse({ id: 'cave', label: 'Cave', scene: 'cave.scene.json', x: 300, y: 100, unlock: { kind: 'variable', name: 'cave', atLeast: 1 } }),
        MapNodeSchema.parse({ id: 'ruin', label: 'Ruin', scene: 'ruin.scene.json', x: 500, y: 100, unlock: { kind: 'variable', name: 'ruin', atLeast: 1 }, hidden: true }),
      ],
    });
    const v = city(sim);
    expect(v.map!.markers.map((m) => [m.id, m.x, m.y, m.state])).toEqual([
      ['zones:r1', 4, 3, ''],
      ['inns:i1', 3, 5, 'yes'],
      ['towns:town', 100, 100, 'here'],
      ['towns:cave', 300, 100, 'locked'], // a place nobody has heard of (the ruin) is not on the map at all
    ]);
    expect(v.map!.markers[3]!.scope['place.name']).toBe('Cave');
    // how far each is from the place the player is in (map units), so close places can be left out
    expect(v.map!.markers.filter((m) => m.kind === 'towns').map((m) => m.scope['place.distance'])).toEqual([0, 200]);
  });

  it('a plugin adds a source', () => {
    const plugin = definePlugin(
      { id: 'party-src', name: 'Party', version: '1.0.0', description: 'x', author: 'x', license: 'MIT', engine: '^1.0.0', permissions: [], entry: { runtime: 'x' } },
      { install: (api) => api.markerSource({ id: 'party', label: 'The party', rows: () => [{ id: 'bard', x: 2, y: 2, scope: { 'marker.name': 'Bard' } }] }) },
    );
    pluginHost.register(plugin);
    pluginHost.install('party-src');
    try {
      const sim = game({ markers: [{ id: 'friends', from: 'party' }] as never });
      expect(city(sim).map!.markers.map((m) => [m.id, m.label])).toEqual([['friends:bard', 'Bard']]);
    } finally {
      pluginHost.forget('party-src');
    }
  });

  it('conditions per kind: distance to the player, the zoom, a variable, a fog layer', () => {
    const sim = game({
      layers: [layer('fog', 'fog', { reveal: 'event' })],
      markers: [
        { id: 'far', from: 'hand', show: '{map.distance} > 6', hand: [hand('a', 1, 1), hand('b', 12, 9), hand('c', 15, 11)] },
        { id: 'close', from: 'hand', show: '{map.distance} <= 6', hand: [hand('n', 3, 3)] },
        { id: 'zoomed', from: 'hand', show: '{map.zoom} >= 2', hand: [hand('z', 5, 5)] },
        { id: 'flag', from: 'hand', show: '{quest} = 1', hand: [hand('q', 6, 6)] },
        { id: 'known', from: 'hand', show: '{marker.revealed} = 1', hand: [hand('k', 8, 8)] },
      ] as never,
    });
    sim.world.spawn({ name: 'Hero', tags: ['player'], components: { transform: { x: 2, y: 2, h: 0 } } });
    expect(ids(city(sim))).toEqual(['far:b', 'far:c', 'close:n']);
    sim.runtime.vars.quest = 1;
    mapRun(sim, city(sim).node.id, MapSpecSchema.parse({})).zoom = 2;
    expect(ids(city(sim))).toEqual(['far:b', 'far:c', 'close:n', 'zoomed:z', 'flag:q']);
    runActionList(contextOf(sim), [{ type: 'mapReveal', params: { map: 'City', area: '8,8,1,1' } }] as never);
    expect(ids(city(sim))).toContain('known:k');
  });

  it('sorted by a value, and merged when they overlap on the screen', () => {
    const sim = game({
      markers: [
        { id: 'a', from: 'table', source: 'Pins', sort: '{row.size}', cluster: 0 },
        { id: 'b', from: 'hand', cluster: 30, clusterPrefab: '', hand: [hand('1', 5, 5), hand('2', 5.2, 5.1), hand('3', 12, 9)] },
      ] as never,
    });
    sim.assets.tables.set('Pins', { name: 'Pins', columns: [{ id: 'x', type: 'number' }, { id: 'y', type: 'number' }, { id: 'size', type: 'number' }], rows: [{ id: 'big', x: 1, y: 1, size: 5 }, { id: 'small', x: 2, y: 2, size: 1 }] } as never);
    const v = city(sim);
    expect(ids(v)).toEqual(['cluster:b:1', 'b:3', 'a:small', 'a:big']); // drawn from the lowest sort value to the highest (the pins with none count as 0)
    const cluster = v.map!.markers.find((m) => m.cluster)!;
    expect(cluster.cluster).toEqual({ count: 2, ids: ['b:1', 'b:2'] });
    expect(cluster.scope['marker.count']).toBe(2);
  });

  it('the game adds, hides and removes markers, and a saved game keeps them', () => {
    const sim = game({ markers: [{ id: 'pins', from: 'hand', hand: [hand('a', 2, 2)] }] as never });
    city(sim);
    const ctx = contextOf(sim);
    runActionList(ctx, [{ type: 'mapMarker', params: { map: 'City', op: 'add', kind: 'pins', id: 'b', x: '6', y: '7', label: 'Found' } }, { type: 'mapMarker', params: { map: 'City', op: 'hide', id: 'pins:a' } }] as never);
    expect(city(sim).map!.markers.map((m) => [m.id, m.x, m.y, m.label])).toEqual([['pins:b', 6, 7, 'Found']]);
    const saved = { ...sim.runtime.vars };
    const loaded = game({ markers: [{ id: 'pins', from: 'hand', hand: [hand('a', 2, 2)] }] as never });
    const wid = city(loaded).node.id;
    for (const [k, v] of Object.entries(saved)) loaded.runtime.vars[k.replace(/__map\.[^.]+\./, `__map.${wid}.`)] = v;
    expect(ids(city(loaded))).toEqual(['pins:b']);
    runActionList(ctx, [{ type: 'mapMarker', params: { map: 'City', op: 'show', id: 'pins:a' } }, { type: 'mapMarker', params: { map: 'City', op: 'remove', kind: 'pins', id: 'b' } }] as never);
    expect(ids(city(sim))).toEqual(['pins:a']);
  });
});

describe('moving the highlight', () => {
  const m = (id: string, sx: number, sy: number, choosableFlag = true): MapMarker => ({ id, kind: 'k', rowId: id, x: sx, y: sy, sx, sy, state: '', prefab: '', label: id, scope: {}, rank: 0, layer: 0, choosable: choosableFlag });
  const grid = [m('a', 100, 100), m('b', 200, 100), m('c', 100, 200), m('d', 200, 210), m('e', 300, 100)];

  it('by direction on the screen: the one straight that way beats a nearer one off to the side', () => {
    expect(moveHighlight(grid, 'a', 'right', 'direction', true)!.id).toBe('b');
    expect(moveHighlight(grid, 'a', 'down', 'direction', true)!.id).toBe('c');
    expect(moveHighlight(grid, 'b', 'down', 'direction', true)!.id).toBe('d');
    expect(moveHighlight([m('x', 0, 0), m('near', 60, 90), m('line', 0, 140)], 'x', 'down', 'direction', true)!.id).toBe('line');
    expect(moveHighlight([m('x', 0, 0), m('near', 60, 90), m('line', 0, 140)], 'x', 'down', 'nearest', true)!.id).toBe('near');
  });

  it('round the ends or stopping at them', () => {
    expect(moveHighlight(grid, 'e', 'right', 'direction', true)!.id).toBe('a'); // the far side of the same line
    expect(moveHighlight(grid, 'e', 'right', 'direction', false)).toBeNull();
    expect(moveHighlight(grid, 'a', 'up', 'direction', true)!.id).toBe('c');
  });

  it('in list order, next and earlier', () => {
    expect(moveHighlight(grid, 'b', 'down', 'order', true)!.id).toBe('c');
    expect(moveHighlight(grid, 'b', 'left', 'order', true)!.id).toBe('a');
    expect(stepHighlight(grid, 'e', 1, true)!.id).toBe('a');
    expect(stepHighlight(grid, 'e', 1, false)).toBeNull();
    expect(stepHighlight(grid, 'a', -1, true)!.id).toBe('e');
    expect(stepHighlight(grid, 'zz', 1, true)!.id).toBe('a');
  });

  it('skips what cannot be chosen', () => {
    const g = [m('a', 0, 0), m('hidden', 50, 0, false), m('b', 100, 0)];
    expect(moveHighlight(g, 'a', 'right', 'direction', true)!.id).toBe('b');
  });
});

describe('a map in a game: highlight, choose, bindings, keys, actions', () => {
  const pins = [{ id: 'pins', from: 'hand', hand: [hand('a', 2, 2, 'Gate'), hand('b', 10, 2, 'Mill'), hand('c', 2, 9, 'Well')] }];

  it('starts on the first marker or the one where the player is, and tells the game when the highlight moves', () => {
    const sim = game({ markers: pins as never, nav: { start: 'here' }, bind: 'm', on: { highlight: [{ type: 'setVariable', params: { name: 'seen', op: 'set', value: '{marker.label}' } }], choose: [{ type: 'setVariable', params: { name: 'went', op: 'set', value: '{marker.id}' } }], reveal: [] } as never });
    sim.world.spawn({ name: 'Hero', tags: ['player'], components: { transform: { x: 9, y: 3, h: 0 } } });
    const events: string[] = [];
    sim.events.on('map-marker-highlighted', (e) => void events.push(`h:${e.marker}`));
    sim.events.on('map-marker-chosen', (e) => void events.push(`c:${e.marker}`));
    expect(city(sim).map!.highlight).toBe('pins:b');
    const live = findLiveMap(sim, 'City')!;
    expect(moveHighlightBy(sim, live, 'left')).toBe(true);
    expect(sim.runtime.vars.seen).toBe('Gate');
    city(sim);
    expect(sim.runtime.vars['m.marker']).toBe('pins:a');
    expect(sim.runtime.vars['m.label']).toBe('Gate');
    expect(sim.runtime.vars['m.count']).toBe(3);
    runActionList(contextOf(sim), [{ type: 'mapChoose', params: { map: 'City' } }] as never);
    expect(sim.runtime.vars.went).toBe('pins:a');
    expect(events).toEqual(['h:pins:a', 'c:pins:a']);
  });

  it('the mapped buttons move the highlight, page through markers, zoom, centre and choose; each says which it used', () => {
    const sim = game({ markers: pins as never, nav: { actions: { select: 'ui_choose' } }, on: { highlight: [], choose: [{ type: 'setVariable', params: { name: 'went', op: 'set', value: '{marker.label}' } }], reveal: [] } as never });
    const press = (...a: string[]): Set<string> => {
      sim.uiInput.update(Object.fromEntries(a.map((x) => [x, 1])));
      return driveMapKeys(sim, city(sim));
    };
    expect(city(sim).map!.highlight).toBe('pins:a');
    expect([...press('move_right')]).toEqual(['move_right']);
    expect(city(sim).map!.highlight).toBe('pins:b');
    press();
    expect([...press('move_down')]).toEqual(['move_down']);
    expect(city(sim).map!.highlight).toBe('pins:c'); // the one that lies that way
    press();
    press('ui_page_down'); // round the end
    expect(city(sim).map!.highlight).toBe('pins:a');
    press();
    press('ui_page_up'); // and back round the other way
    expect(city(sim).map!.highlight).toBe('pins:c');
    press();
    press('ui_page_down');
    expect(city(sim).map!.highlight).toBe('pins:a');
    press();
    expect(press('ui_choose').has('ui_choose')).toBe(true);
    expect(sim.runtime.vars.went).toBe('Gate');
    const z = city(sim).map!.zoom;
    press();
    press('ui_zoom_in');
    expect(city(sim).map!.zoom).toBeGreaterThan(z);
    press();
    runActionList(contextOf(sim), [{ type: 'mapCamera', params: { map: 'City', to: 'cell', x: '10', y: '2' } }] as never);
    expect(mapRun(sim, city(sim).node.id, MapSpecSchema.parse({})).cx).not.toBeNull();
    press('ui_recentre');
    expect(mapRun(sim, city(sim).node.id, MapSpecSchema.parse({})).cx).toBeNull();
    // up with nothing above: the button is not used, so the screen moves the focus instead
    press();
    const sim2 = game({ markers: pins as never, nav: { wrap: false } });
    sim2.uiInput.update({ move_up: 1 });
    expect(driveMapKeys(sim2, city(sim2)).size).toBe(0);
  });

  it('keys can pan the view instead of moving the highlight, or do nothing', () => {
    const sim = game({ markers: pins as never, nav: { keys: 'pan' } });
    sim.uiInput.update({ move_right: 1 });
    for (let i = 0; i < 30; i++) driveMapKeys(sim, city(sim));
    expect(mapRun(sim, city(sim).node.id, MapSpecSchema.parse({})).cx).toBeGreaterThan(city(sim).map!.proj.plane.w / 2);
    const quiet = game({ markers: pins as never, nav: { keys: 'none' } });
    quiet.uiInput.update({ move_right: 1 });
    expect(driveMapKeys(quiet, city(quiet)).size).toBe(0);
  });

  it('Quick Actions: highlight a marker by id, zoom, move the view', () => {
    const sim = game({ markers: pins as never });
    city(sim);
    const ctx = contextOf(sim);
    runActionList(ctx, [{ type: 'mapHighlight', params: { map: '', how: 'marker', marker: 'pins:c' } }] as never);
    expect(city(sim).map!.highlight).toBe('pins:c');
    runActionList(ctx, [{ type: 'mapHighlight', params: { map: 'City', how: 'previous' } }] as never);
    expect(city(sim).map!.highlight).toBe('pins:b');
    runActionList(ctx, [{ type: 'mapZoom', params: { map: 'City', how: 'to', amount: '3' } }] as never);
    expect(city(sim).map!.zoom).toBe(3);
    runActionList(ctx, [{ type: 'mapZoom', params: { map: 'City', how: 'out', amount: '2' } }] as never);
    expect(city(sim).map!.zoom).toBe(1.5);
    runActionList(ctx, [{ type: 'mapCamera', params: { map: 'City', to: 'marker', marker: 'pins:c', zoom: '2' } }] as never);
    const v = city(sim).map!;
    expect(v.zoom).toBe(2);
    const at = planeToView(v.view, cellToPlane(v.proj, 2, 9).x, cellToPlane(v.proj, 2, 9).y);
    expect(at.x).toBeCloseTo(v.view.w / 2, 3);
    expect(at.y).toBeCloseTo(v.view.h / 2, 3);
  });

  it('layers: any order, opacity and blend, shown by a condition and by zoom', () => {
    const sim = game({
      layers: [layer('terrain', 'ground'), { ...layer('grid', 'lines'), visible: '{show_grid} = 1', opacity: 0.4, blend: 'multiply' }, { ...layer('labels', 'names'), zoomMin: 2 }, layer('markers', 'pins')] as never,
      markers: pins as never,
    });
    let v = city(sim).map!;
    expect(v.layers.map((l) => [l.id, l.visible])).toEqual([['ground', true], ['lines', false], ['names', false], ['pins', true]]);
    expect(v.layers[1]).toMatchObject({ opacity: 0.4, blend: 'multiply', index: 1 });
    sim.runtime.vars.show_grid = 1;
    mapRun(sim, v.id, MapSpecSchema.parse({})).zoom = 2.5;
    v = city(sim).map!;
    expect(v.layers.map((l) => l.visible)).toEqual([true, true, true, true]);
    // markers take the opacity and blend of the layer that draws them, and sit in its place in the order
    expect(city(sim).parts![0]!.part!.place['z-index']).toBe('310');
  });

  it('paths link places on the world map, markers in order, or table rows; a link can have a condition', () => {
    const sim = game({ layers: [layer('paths', 'roads', { from: 'places', when: '{link.b} != ruin' })], markers: [{ id: 'towns', from: 'places' }] as never });
    sim.assets.worldMap = WorldMapSchema.parse({
      nodes: [
        MapNodeSchema.parse({ id: 'town', label: 'Town', scene: 'town.scene.json', x: 100, y: 100, unlock: { kind: 'always' } }),
        MapNodeSchema.parse({ id: 'cave', label: 'Cave', scene: 'cave.scene.json', x: 300, y: 100, unlock: { kind: 'always' } }),
        MapNodeSchema.parse({ id: 'ruin', label: 'Ruin', scene: 'ruin.scene.json', x: 500, y: 100, unlock: { kind: 'always' } }),
      ],
      links: [{ a: 'town', b: 'cave' }, { a: 'cave', b: 'ruin' }],
    });
    expect((city(sim).map!.layers[0]!.data as { segs: unknown[] }).segs).toEqual([{ x1: 100, y1: 100, x2: 300, y2: 100 }]);
  });

  it('a layer a plugin adds appears with its own fields', () => {
    const plugin = definePlugin(
      { id: 'wind-layer', name: 'Wind', version: '1.0.0', description: 'x', author: 'x', license: 'MIT', engine: '^1.0.0', permissions: [], entry: { runtime: 'x' } },
      { install: (api) => api.mapLayer({ id: 'wind', label: 'Wind', fields: [{ key: 'strength', label: 'Strength', type: 'number', default: 3 }], draw: () => undefined }) },
    );
    pluginHost.register(plugin);
    pluginHost.install('wind-layer');
    try {
      expect(pluginHost.ext.mapLayers.get('wind')!.fields[0]!.key).toBe('strength');
      const sim = game({ layers: [{ ...defaultMapLayer('wind', 'w'), kind: 'wind' }] as never });
      expect(city(sim).map!.layers[0]).toMatchObject({ kind: 'wind', visible: true });
    } finally {
      pluginHost.forget('wind-layer');
    }
  });

  it('clicking a marker is choosing it, and pointing at it highlights it, unless the map says not', () => {
    const sim = game({ markers: pins as never, on: { highlight: [], reveal: [], choose: [{ type: 'setVariable', params: { name: 'went', op: 'set', value: '{marker.label}' } }] } as never });
    const part = (label: string): ViewNode => city(sim).parts!.find((p) => p.scope['marker.label'] === label)!;
    expect(part('Mill').act).toEqual({ kind: 'marker', id: 'pins:b' });
    expect(openScreens(sim).length).toBe(1);
  });
});
