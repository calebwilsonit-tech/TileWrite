import { afterEach, describe, expect, it } from 'vitest';
import '../../bundled';
import { newAction, newRow, setActivePacks } from '@tilewright/behaviors';
import { UiDocSchema, newScene, type SceneData } from '@tilewright/runtime';
import { describeUsage, pluginUsage } from './usage';

afterEach(() => setActivePacks([]));

function scene(name: string, build: (s: SceneData) => void): SceneData {
  const s = newScene(name, 8, 8);
  build(s);
  return s;
}

describe('what depends on a plugin', () => {
  it('counts the objects, event rows and records that use it, and says what will stop working', () => {
    setActivePacks(['inventory']);
    const row = newRow('r1');
    row.actions = [{ ...newAction('giveItem'), params: { item: 'key', amount: 1 } }];
    const a = scene('Hall', (s) => {
      s.entities.push({ id: 'c1', name: 'Coin', tags: [], components: { pickup: { item: 'key' } } }, { id: 'c2', name: 'Coin 2', tags: [], components: { pickup: { item: 'key' } } });
      s.events = [row];
    });
    const b = scene('Cave', (s) => s.entities.push({ id: 'c3', name: 'Coin 3', tags: [], components: { pickup: {} } }));
    const u = pluginUsage('inventory', new Map([['scenes/hall.scene.json', a], ['scenes/cave.scene.json', b]]), UiDocSchema.parse({}), (k) => (k === 'items' ? 3 : 0));
    expect(u.objects).toEqual([{ what: 'the behaviour pickup', count: 3, scenes: ['cave', 'hall'] }]);
    expect(u.rows).toEqual([{ what: 'the action giveItem', count: 1, scenes: ['hall'] }]);
    expect(u.data).toEqual([{ what: 'items', file: 'assets/items.json', count: 3 }]);
    const lines = describeUsage(u);
    expect(lines[0]).toBe('3 objects with the behaviour pickup (in cave, hall) will stop doing it.');
    expect(lines).toContain('The 3 items in assets/items.json will not load (they stay in the file).');
  });

  it('is empty for a plugin nothing uses', () => {
    setActivePacks(['inventory']);
    expect(describeUsage(pluginUsage('inventory', new Map([['s', scene('S', () => undefined)]]), UiDocSchema.parse({}), () => 0))).toEqual([]);
  });
});
