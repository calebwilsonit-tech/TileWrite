import { describe, expect, it } from 'vitest';
import { WorldMapSchema, checkWorldMap, isUnlocked, neighbourInDirection, newMapNode, newWorldMap, placeState, visitedKey } from './worldmap';

const node = (id: string, patch: object = {}) => ({ ...newMapNode(id, id.toUpperCase(), `scenes/${id}.scene.json`), ...patch });
const never = () => false;

describe('the world map file', () => {
  it('fills in defaults and refuses nonsense', () => {
    const m = newWorldMap();
    expect(m.nodes).toEqual([]);
    expect(m.title).toBe('Map');
    expect(newMapNode('hub', 'Hub').unlock).toEqual({ kind: 'visited' });
    expect(WorldMapSchema.safeParse({ nodes: [{ id: 'bad id', label: 'x' }] }).success).toBe(false);
    expect(WorldMapSchema.safeParse({ nodes: [{ id: 'a', label: 'A', x: 5000 }] }).success).toBe(false);
  });
});

describe('what the player may travel to', () => {
  it('opens a place once visited, from the start, with a flag, or with a lit lantern', () => {
    const vars = { [visitedKey('scenes/cave.scene.json')]: true, lamp: 2 };
    expect(isUnlocked(node('cave'), vars, never)).toBe(true);
    expect(isUnlocked(node('tower'), vars, never)).toBe(false);
    expect(isUnlocked(node('tower', { unlock: { kind: 'always' } }), {}, never)).toBe(true);
    expect(isUnlocked(node('tower', { unlock: { kind: 'variable', name: 'lamp', atLeast: 3 } }), vars, never)).toBe(false);
    expect(isUnlocked(node('tower', { unlock: { kind: 'variable', name: 'lamp', atLeast: 2 } }), vars, never)).toBe(true);
    expect(isUnlocked(node('tower', { unlock: { kind: 'variable', name: 'flag', atLeast: 1 } }), { flag: true }, never)).toBe(true);
    expect(isUnlocked(node('tower', { unlock: { kind: 'lantern' } }), {}, (s) => s === 'scenes/tower.scene.json')).toBe(true);
  });

  it('says where the player is, and hides places that are secret until unlocked', () => {
    const lit = never;
    expect(placeState(node('hub'), {}, 'scenes/hub.scene.json', lit)).toBe('here');
    expect(placeState(node('cave'), { [visitedKey('scenes/cave.scene.json')]: true }, 'scenes/hub.scene.json', lit)).toBe('open');
    expect(placeState(node('cave'), {}, 'scenes/hub.scene.json', lit)).toBe('locked');
    expect(placeState(node('cave', { hidden: true }), {}, 'scenes/hub.scene.json', lit)).toBe('hidden');
    expect(placeState(node('cave', { hidden: true, unlock: { kind: 'always' } }), {}, 'scenes/hub.scene.json', lit)).toBe('open');
  });
});

describe('moving around the map with the arrow keys', () => {
  const nodes = [
    { id: 'a', x: 100, y: 300 },
    { id: 'b', x: 400, y: 300 },
    { id: 'c', x: 400, y: 100 },
    { id: 'd', x: 700, y: 320 },
  ];
  it('goes to the nearest place in that direction, preferring straight ahead', () => {
    expect(neighbourInDirection(nodes, 'a', 'right')).toBe('b');
    expect(neighbourInDirection(nodes, 'b', 'right')).toBe('d');
    expect(neighbourInDirection(nodes, 'b', 'up')).toBe('c');
    expect(neighbourInDirection(nodes, 'b', 'left')).toBe('a');
    expect(neighbourInDirection(nodes, 'a', 'left')).toBeNull();
    expect(neighbourInDirection(nodes, 'c', 'down')).toBe('b');
    expect(neighbourInDirection(nodes, 'zzz', 'left')).toBe('a'); // nothing chosen yet: start at the first
  });
});

describe('checking the map', () => {
  const scenes = ['scenes/hub.scene.json', 'scenes/cave.scene.json'];
  it('is happy with a sensible map', () => {
    const m = { ...newWorldMap(), nodes: [node('hub'), node('cave')], links: [{ a: 'hub', b: 'cave' }] };
    expect(checkWorldMap(m, scenes)).toEqual([]);
    expect(checkWorldMap(newWorldMap(), scenes)).toEqual([]); // no map at all is fine
  });

  it('explains what is wrong', () => {
    const m = {
      ...newWorldMap(),
      nodes: [node('hub'), node('cave', { scene: '' }), node('ghost', { scene: 'scenes/nope.scene.json' }), node('twin', { scene: 'scenes/hub.scene.json' }), node('gate', { unlock: { kind: 'variable', name: '', atLeast: 1 } })],
      links: [{ a: 'hub', b: 'nowhere' }, { a: 'hub', b: 'hub' }],
    };
    const text = checkWorldMap(m, scenes).join('\n');
    expect(text).toMatch(/"CAVE" is not linked to a scene/);
    expect(text).toMatch(/"GHOST" leads to the scene "scenes\/nope.scene.json", which is not part of this project/);
    expect(text).toMatch(/2 places on the map lead to the same scene/);
    expect(text).toMatch(/unlocks with a variable but none is named/);
    expect(text).toMatch(/joins a place that does not exist/);
    expect(text).toMatch(/joins a place to itself/);
    expect(text).toMatch(/has no path to any other place/);
    expect(text).toMatch(/The scene "scenes\/cave.scene.json" is not on the map/);
  });
});
