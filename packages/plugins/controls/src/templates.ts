import {
  CURRENT_SCHEMA_VERSION,
  TileMap,
  baseProject,
  boxLook,
  json,
  playerEntity,
  sceneFrom,
  thingOf,
  type SceneData,
  type TemplateDef,
  unseen,
  walled,
  withPacks,
} from '@tilewright/plugin-sdk';

const BUILDINGS_TABLE = {
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name: 'Buildings',
  columns: [
    { id: 'name', type: 'text' },
    { id: 'prefab', type: 'prefab' },
    { id: 'w', type: 'number' },
    { id: 'd', type: 'number' },
    { id: 'cost', type: 'number' },
  ],
  rows: [
    { id: 'house', name: 'House', prefab: 'House', w: 2, d: 3, cost: 30 },
    { id: 'wall', name: 'Wall', prefab: 'Wall', w: 1, d: 1, cost: 2 },
  ],
};

const prefabBox = (name: string, w: number, d: number, color: number) => ({
  schemaVersion: CURRENT_SCHEMA_VERSION,
  name,
  root: {
    name,
    tags: ['building'],
    children: [],
    components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color, w, d, height: 1.5, sortOffset: 0, visible: true }, collider: { w: w * 0.95, d: d * 0.95, height: 1.5, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] } },
  },
});

const builder: TemplateDef = {
  id: 'builder',
  name: 'Builder (place buildings, grow a town)',
  description: 'Open ground with a camera you can move, turn and zoom, and a menu of buildings that cost gold. Simulation helpers and control schemes are switched on.',
  build(name) {
    const packs = ['controls', 'sim'];
    return withPacks(packs, () => {
      const map = new TileMap(40, 40);
      map.fill(1, 0);
      const rig = thingOf('e1', 'Camera', 20.5, 20.5, [], { cameraRig: {}, builder: {} }, { sprite: unseen });
      const scene = sceneFrom(map, [rig]);
      scene.variables = [{ name: 'gold', value: 100 }] as SceneData['variables'];
      return {
        project: baseProject(name, packs),
        scene,
        files: { 'assets/tables/Buildings.table.json': json(BUILDINGS_TABLE), 'assets/prefabs/House.prefab.json': json(prefabBox('House', 2, 3, 0xaa8855)), 'assets/prefabs/Wall.prefab.json': json(prefabBox('Wall', 1, 1, 0x888888)) },
      };
    });
  },
};

const pointAndClick: TemplateDef = {
  id: 'point-and-click',
  name: 'Point and click (look, use, talk)',
  description: 'A room with a hero who walks where you click and a lamp to look at or use. Choose a verb, click a thing. Control schemes and story are switched on.',
  build(name) {
    const packs = ['controls', 'story', 'inventory'];
    return withPacks(packs, () => {
      const map = walled(20, 14, 3, 5);
      const hero = thingOf('e1', 'Hero', 4.5, 7.5, ['player'], { clickToMove: {} }, { body: playerEntity('x', 0, 0).components.body, sprite: boxLook(0xe8553d, 0.6, 1.4) });
      const lamp = thingOf('e2', 'Lamp', 12.5, 4.5, [], { hotspot: { label: 'Old lamp', look: 'It flickers.', use: 'You pull the chain.', talk: '' } }, { sprite: boxLook(0xf2c94c, 0.5, 1.6) });
      const scene = sceneFrom(map, [hero, lamp]);
      scene.variables = [{ name: 'verb', value: 'look' }] as SceneData['variables'];
      return { project: baseProject(name, packs), scene };
    });
  },
};

/** The starters this plugin adds to the New project list. */
export const templates: TemplateDef[] = [builder, pointAndClick];
