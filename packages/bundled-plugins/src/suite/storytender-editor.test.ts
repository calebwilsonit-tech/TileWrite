import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TileMap, type EntityData } from '@tilewright/runtime';
import { setActivePacks } from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';
import { prefabs } from '../../../plugins/storytender/src/prefabs';
import { storytenderChecks } from '../../../plugins/storytender/src/checks';

/**
 * What the reference game's plugin adds to the editor: its checks for the Problems panel and its objects in the Place tool. (These were
 * tests of the editor itself until the editor stopped knowing the game's words: the editor only runs whatever plugins offer.)
 */

const scene = (entities: EntityData[]) => ({
  entities,
  map: new TileMap(12, 12),
  regions: [],
  wires: [],
  events: [],
  getEntity: (id: string) => entities.find((e) => e.id === id),
});

const at = { x: 4.5, y: 4.5, h: 0, facing: 2 };

describe('the checks of the reference game', () => {
  it('explain a sentence stone with nothing to swap and an echo recorder that can never record', () => {
    const stone: EntityData = { id: 's1', name: 'Stone', tags: [], components: { transform: at, sentenceStone: { before: 'x', words: 'only', after: '', selected: 0, reach: 1.5, variable: '' } } };
    const player: EntityData = { id: 'p1', name: 'Player', tags: ['player'], components: { transform: at, echoRecorder: { seconds: 8, capacity: 0, capacityVariable: '', ending: 'hold', ghostAlpha: 0.5 } } };
    const found = storytenderChecks.check(scene([stone, player]));
    expect(found.some((p) => p.id.startsWith('stone-words-') && /fewer than two/.test(p.message))).toBe(true);
    expect(found.some((p) => p.id.startsWith('echo-capacity-') && /0 echoes/.test(p.message))).toBe(true);
    player.components.echoRecorder = { ...(player.components.echoRecorder as object), capacityVariable: 'slots' };
    expect(storytenderChecks.check(scene([stone, player])).some((p) => p.id.startsWith('echo-capacity-'))).toBe(false);
  });

  it('say a light sensor wired to nothing does nothing', () => {
    const sensor: EntityData = { id: 'l1', name: 'Sensor', tags: [], components: { transform: at, lightSensor: {} } };
    expect(storytenderChecks.check(scene([sensor])).some((p) => p.id.startsWith('unused-l1-lightSensor'))).toBe(true);
  });
});

describe('the objects of the reference game in the Place tool', () => {
  // (an object is made with the behaviours the plugin adds, so the plugin is on)
  beforeAll(() => setActivePacks(['storytender']));
  afterAll(() => setActivePacks([]));
  const make = (id: string): EntityData['components'] => prefabs.find((p) => p.id === id)!.make(3.5, 3.5, 0).components;

  it('carry their behaviours', () => {
    expect(make('stone')).toHaveProperty('sentenceStone');
    expect(make('text')).toHaveProperty('textBlock');
    expect(make('lightsensor')).toHaveProperty('lightSensor');
    expect(make('dough')).toHaveProperty('growing');
    expect(make('dough')).toHaveProperty('collider');
  });
});
