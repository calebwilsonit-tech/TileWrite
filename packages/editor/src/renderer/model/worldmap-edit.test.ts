import { describe, expect, it } from 'vitest';
import { checkWorldMap, newWorldMap } from '@tilewright/runtime';
import { addLink, addPlace, hasLink, mapFromScenes, movePlace, neighboursOf, removeLink, removePlace, renamePlaceId, sceneLabel, updatePlace } from './worldmap-edit';

const scenes = ['scenes/main.scene.json', 'scenes/dark-cave.scene.json', 'scenes/old_tower.scene.json'];

describe('making a world map', () => {
  it('names places after their scenes', () => {
    expect(sceneLabel('scenes/dark-cave.scene.json')).toBe('Dark cave');
    expect(sceneLabel('scenes/old_tower.scene.json')).toBe('Old tower');
    expect(sceneLabel('')).toBe('Place');
  });

  it('starts from the scenes: the first is the hub, the others sit round it and are joined to it', () => {
    const m = mapFromScenes(scenes);
    expect(m.nodes.map((n) => n.id)).toEqual(['main', 'dark-cave', 'old-tower']);
    expect(m.nodes[0]).toMatchObject({ icon: 'town', unlock: { kind: 'always' }, x: 500, y: 300 });
    expect(m.nodes[1]!.unlock).toEqual({ kind: 'visited' });
    expect(m.links).toEqual([{ a: 'main', b: 'dark-cave' }, { a: 'main', b: 'old-tower' }]);
    expect(checkWorldMap(m, scenes)).toEqual([]);
    expect(new Set(m.nodes.map((n) => `${n.x},${n.y}`)).size).toBe(3);
    expect(mapFromScenes(scenes, 'scenes/dark-cave.scene.json').nodes[0]!.id).toBe('dark-cave'); // the start scene is the hub
    expect(mapFromScenes([]).nodes).toEqual([]);
  });
});

describe('editing a world map', () => {
  const base = mapFromScenes(scenes);

  it('adds places with unique ids, not on top of each other', () => {
    let m = base;
    const a = addPlace(m, 'scenes/dark-cave.scene.json');
    m = a.map;
    expect(a.id).toBe('dark-cave-2');
    const b = addPlace(m, 'scenes/x.scene.json', 'Hidden Vale');
    expect(b.id).toBe('hidden-vale');
    const spots = new Set(b.map.nodes.map((n) => `${n.x},${n.y}`));
    expect(spots.size).toBe(b.map.nodes.length);
  });

  it('moves places on a grid and keeps them on the board', () => {
    const m = movePlace(base, 'main', 333, 77);
    expect(m.nodes[0]).toMatchObject({ x: 330, y: 80 });
    const out = movePlace(base, 'main', 5000, -40);
    expect(out.nodes[0]).toMatchObject({ x: 1000, y: 0 });
  });

  it('joins and unjoins places once, never to themselves', () => {
    let m = addLink(base, 'dark-cave', 'old-tower');
    expect(hasLink(m, 'old-tower', 'dark-cave')).toBe(true);
    expect(m.links).toHaveLength(3);
    expect(addLink(m, 'old-tower', 'dark-cave')).toBe(m);
    expect(addLink(m, 'main', 'main')).toBe(m);
    expect(addLink(m, 'main', 'ghost')).toBe(m);
    expect(neighboursOf(m, 'dark-cave').sort()).toEqual(['main', 'old-tower']);
    m = removeLink(m, 'old-tower', 'dark-cave');
    expect(m.links).toHaveLength(2);
  });

  it('deletes a place together with its paths, and renames an id everywhere', () => {
    const gone = removePlace(base, 'dark-cave');
    expect(gone.nodes.map((n) => n.id)).toEqual(['main', 'old-tower']);
    expect(gone.links).toEqual([{ a: 'main', b: 'old-tower' }]);
    const renamed = renamePlaceId(base, 'dark-cave', 'cave');
    expect(renamed.nodes[1]!.id).toBe('cave');
    expect(renamed.links[0]).toEqual({ a: 'main', b: 'cave' });
    expect(renamePlaceId(base, 'dark-cave', 'main')).toBe(base); // taken
    expect(renamePlaceId(base, 'dark-cave', 'not valid')).toBe(base);
  });

  it('changes a place without touching the others', () => {
    const m = updatePlace(base, 'old-tower', { icon: 'tower', unlock: { kind: 'plugin-rule' } });
    expect(m.nodes[2]).toMatchObject({ icon: 'tower', unlock: { kind: 'plugin-rule' } });
    expect(m.nodes[1]).toEqual(base.nodes[1]);
    expect(newWorldMap().nodes).toEqual([]);
  });
});
