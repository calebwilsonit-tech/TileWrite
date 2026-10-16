import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { C } from '../scene/components';
import { FLAG, SLOPE, TileMap } from '../tilemap/tilemap';
import { migrateScene } from './migrate';
import { CURRENT_SCHEMA_VERSION, ProjectSchema, SceneSchema } from './schema';
import { loadScene, newScene, parseProject, parseScene, stringifyScene, tileMapFromRows, tileMapToRows } from './scene';

describe('scene format', () => {
  it('round-trips a tile map including slopes, flags, decks and one-way edges', () => {
    const m = new TileMap(5, 4);
    m.fill(1);
    m.set(2, 1, 2, 3);
    m.setSlope(1, 1, SLOPE.E, 'stairs');
    m.setFlag(3, 2, FLAG.PIT);
    m.setDeck(0, 3, 2, 6);
    m.setOneWay(4, 0, 5);
    const back = tileMapFromRows(tileMapToRows(m));
    expect(back.toJSON()).toEqual(m.toJSON());
  });

  it('validates a new scene and fills defaults', () => {
    const s = newScene('Main', 8, 6);
    expect(s.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    const r = parseScene(JSON.parse(JSON.stringify(s)));
    expect(r.ok).toBe(true);
    expect(s.map.tiles).toHaveLength(6);
    expect(s.map.tiles[0]).toHaveLength(8);
  });

  it('gives a plain-English error for a map layer with the wrong size', () => {
    const s = newScene('Main', 4, 4);
    s.map.heights.pop();
    const r = parseScene(s);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toMatch(/not valid/);
      expect(r.error).toMatch(/heights/);
      expect(r.error).toMatch(/4 x 4/);
    }
  });

  it('rejects junk', () => {
    expect(parseScene(42).ok).toBe(false);
    expect(parseScene({ name: 'x' }).ok).toBe(false);
  });

  it('applies entity and region defaults', () => {
    const s = SceneSchema.parse({
      ...newScene('A', 2, 2),
      entities: [{ id: 'e1', name: 'Crate' }],
      regions: [{ id: 'r1', name: 'Room', x: 0, y: 0, w: 2, h: 2 }],
    });
    expect(s.entities[0]!.tags).toEqual([]);
    expect(s.regions[0]).toMatchObject({ cameraBounds: false, darkness: 0, bossActive: false });
  });

  it('writes one line per map row so git diffs stay small, and reads it back', () => {
    const s = newScene('A', 6, 3);
    s.map.tiles[1]![2] = 5;
    const text = stringifyScene(s);
    expect(text).toContain('"tiles": [\n      [1,1,1,1,1,1],\n      [1,1,5,1,1,1],');
    expect(parseScene(JSON.parse(text)).ok).toBe(true);
    const s2 = JSON.parse(JSON.stringify(s));
    s2.map.tiles[1][2] = 6;
    const changed = stringifyScene(s2).split('\n').filter((l, i) => l !== text.split('\n')[i]);
    expect(changed).toHaveLength(1);
  });
});

describe('project format', () => {
  it('validates and defaults the iso config', () => {
    const r = parseProject({ schemaVersion: 1, name: 'Game', scenes: ['scenes/main.scene.json'], startScene: 'scenes/main.scene.json' });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.iso).toEqual({ tileW: 64, tileH: 32, heightPx: 16 });
  });

  it('needs at least one scene and a name', () => {
    expect(ProjectSchema.safeParse({ schemaVersion: 1, name: 'x', scenes: [], startScene: '' }).success).toBe(false);
    expect(ProjectSchema.safeParse({ schemaVersion: 1, name: '', scenes: ['a'], startScene: 'a' }).success).toBe(false);
  });
});

describe('migrations', () => {
  it('accepts the current version unchanged', () => {
    const r = migrateScene({ schemaVersion: CURRENT_SCHEMA_VERSION, name: 'x' });
    expect(r.ok).toBe(true);
  });

  it('refuses files from the future with a helpful message', () => {
    const r = migrateScene({ schemaVersion: CURRENT_SCHEMA_VERSION + 5 });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/newer Tilewright/);
  });

  it('refuses files with no version or that are not objects', () => {
    expect(migrateScene({}).ok).toBe(false);
    expect(migrateScene([]).ok).toBe(false);
    expect(migrateScene('hi').ok).toBe(false);
  });
});

describe('loadScene', () => {
  it('builds the terrain and one entity per scene entity, with independent copies of the data', () => {
    const scene = newScene('A', 4, 4);
    scene.entities.push({
      id: 'p',
      name: 'Hero',
      tags: ['player'],
      components: { [C.Transform]: { x: 1.5, y: 1.5, h: 0, facing: 2 } },
    });
    const sim = new Simulation();
    const byId = loadScene(sim, scene);
    expect(sim.map!.width).toBe(4);
    const hero = byId.get('p')!;
    expect(hero.tags.has('player')).toBe(true);
    hero.require<{ x: number }>(C.Transform).x = 3;
    expect((scene.entities[0]!.components[C.Transform] as { x: number }).x).toBe(1.5); // scene data untouched
  });
});
