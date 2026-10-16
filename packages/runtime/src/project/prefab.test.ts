import { describe, expect, it } from 'vitest';
import { collapseInstance, deepMerge, diffOverrides, expandEntities, extractPrefab, resolveInstance } from './prefab';
import { CURRENT_SCHEMA_VERSION, PrefabSchema, type EntityData, type PrefabData } from './schema';

const crate = (): EntityData => ({
  id: 'e1',
  name: 'Crate',
  tags: ['crate'],
  components: { transform: { x: 4.5, y: 3.5, h: 0, facing: 2 }, sprite: { color: 0xc9964a, w: 0.9, d: 0.9, height: 1 }, collider: { solid: true, height: 1 } },
});

function prefabs(...list: PrefabData[]): Map<string, PrefabData> {
  return new Map(list.map((p) => [p.name, p]));
}

describe('deepMerge and diffOverrides', () => {
  it('merges objects key by key and replaces everything else', () => {
    const merged = deepMerge({ a: { x: 1, y: 2 }, list: [1, 2], n: 5 }, { a: { y: 9 }, list: [3] });
    expect(merged).toEqual({ a: { x: 1, y: 9 }, list: [3], n: 5 });
  });

  it('does not alias its inputs', () => {
    const base = { a: { x: 1 } };
    const merged = deepMerge(base, { b: { y: 2 } }) as { a: { x: number }; b: { y: number } };
    merged.a.x = 99;
    expect(base.a.x).toBe(1);
  });

  it('finds the smallest set of differences', () => {
    const base = { sprite: { color: 1, w: 2 }, collider: { solid: true } };
    expect(diffOverrides(base, { sprite: { color: 1, w: 2 }, collider: { solid: true } })).toBeUndefined();
    expect(diffOverrides(base, { sprite: { color: 7, w: 2 }, collider: { solid: true } })).toEqual({ sprite: { color: 7 } });
    expect(diffOverrides(base, { sprite: { color: 1, w: 2 }, collider: { solid: true }, extra: { n: 1 } })).toEqual({ extra: { n: 1 } });
    expect(diffOverrides({ list: [1, 2] }, { list: [1, 3] })).toEqual({ list: [1, 3] });
  });

  it('round-trips: base + diff == actual', () => {
    const base = { a: { x: 1, y: { z: 2 } }, b: [1], c: 'k' };
    const actual = { a: { x: 5, y: { z: 2 } }, b: [1, 2], c: 'k', d: 3 };
    expect(deepMerge(base, diffOverrides(base, actual))).toEqual(actual);
  });
});

describe('prefabs', () => {
  it('extracts a prefab with the position reset, and the instance follows it', () => {
    const p = extractPrefab(crate(), 'Crate');
    expect(PrefabSchema.safeParse(p).success).toBe(true);
    expect(p.root.components.transform).toMatchObject({ x: 0, y: 0, h: 0 });
    const inst: EntityData = { id: 'e9', name: 'Crate 2', tags: [], prefab: 'Crate', components: { transform: { x: 10.5, y: 2.5, h: 1 } } };
    const { entities, problems } = expandEntities([inst], prefabs(p));
    expect(problems).toEqual([]);
    expect(entities).toHaveLength(1);
    expect(entities[0]).toMatchObject({ id: 'e9', name: 'Crate 2', tags: ['crate'] });
    expect(entities[0]!.components.transform).toMatchObject({ x: 10.5, y: 2.5, h: 1, facing: 2 });
    expect((entities[0]!.components.sprite as { color: number }).color).toBe(0xc9964a);
  });

  it('changing the prefab changes every instance, except for overridden settings', () => {
    const p = extractPrefab(crate(), 'Crate');
    const a: EntityData = { id: 'a', name: 'A', tags: [], prefab: 'Crate', components: { transform: { x: 1, y: 1, h: 0 } } };
    const b: EntityData = { id: 'b', name: 'B', tags: [], prefab: 'Crate', components: { transform: { x: 2, y: 2, h: 0 }, sprite: { color: 0xff0000 } } };
    (p.root.components.sprite as { color: number }).color = 0x00ff00; // edit the prefab
    const { entities } = expandEntities([a, b], prefabs(p));
    expect((entities[0]!.components.sprite as { color: number }).color).toBe(0x00ff00); // follows
    expect((entities[1]!.components.sprite as { color: number }).color).toBe(0xff0000); // keeps its override
    expect((entities[1]!.components.sprite as { w: number }).w).toBe(0.9); // other settings still follow
  });

  it('collapses an edited instance to just its overrides, and resolves it back', () => {
    const p = extractPrefab(crate(), 'Crate');
    const resolved: EntityData = {
      id: 'e5',
      name: 'Big crate',
      tags: ['crate', 'special'],
      components: { transform: { x: 6.5, y: 6.5, h: 0, facing: 2 }, sprite: { color: 0xc9964a, w: 1.5, d: 0.9, height: 1 }, collider: { solid: true, height: 1 } },
    };
    const saved = collapseInstance(resolved, p, prefabs(p));
    expect(saved).toEqual({
      id: 'e5',
      name: 'Big crate',
      tags: ['special'],
      prefab: 'Crate',
      components: { transform: { x: 6.5, y: 6.5, h: 0 }, sprite: { w: 1.5 } },
    });
    const back = resolveInstance(saved, prefabs(p))!;
    expect(back.components).toEqual(resolved.components);
    expect(back.tags.sort()).toEqual(['crate', 'special']);
  });

  it('reports a missing prefab instead of crashing', () => {
    const inst: EntityData = { id: 'x', name: 'Ghost', tags: [], prefab: 'Nope', components: {} };
    const { entities, problems } = expandEntities([inst], prefabs());
    expect(entities).toEqual([]);
    expect(problems[0]).toMatch(/prefab "Nope", which does not exist/);
  });

  it('brings the parts of a prefab along, offset from the instance, with stable ids', () => {
    const lamp: PrefabData = { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Lamp', root: { name: 'Lamp', tags: ['lamp'], components: { transform: { x: 0, y: 0, h: 0, facing: 2 } }, children: [] } };
    const room: PrefabData = {
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: 'Room',
      root: {
        name: 'Room',
        tags: [],
        components: { transform: { x: 0, y: 0, h: 0, facing: 2 } },
        children: [
          { name: 'Left lamp', tags: [], components: { transform: { x: -2, y: 0, h: 0 } }, prefab: 'Lamp', children: [] },
          { name: 'Right lamp', tags: [], components: { transform: { x: 2, y: 0, h: 1 } }, prefab: 'Lamp', children: [] },
        ],
      },
    };
    const inst: EntityData = { id: 'r1', name: 'Hall', tags: [], prefab: 'Room', components: { transform: { x: 10, y: 5, h: 2 } } };
    const { entities, problems } = expandEntities([inst], prefabs(lamp, room));
    expect(problems).toEqual([]);
    expect(entities.map((e) => e.id)).toEqual(['r1', 'r1.1', 'r1.2']);
    expect(entities[1]).toMatchObject({ name: 'Left lamp', tags: ['lamp'] });
    expect(entities[1]!.components.transform).toMatchObject({ x: 8, y: 5, h: 2 }); // parent + offset
    expect(entities[2]!.components.transform).toMatchObject({ x: 12, y: 5, h: 3 });
    const again = expandEntities([inst], prefabs(lamp, room)).entities.map((e) => e.id);
    expect(again).toEqual(['r1', 'r1.1', 'r1.2']);
  });

  it('nested prefabs: an instance of a prefab that is itself an instance of another', () => {
    const base = extractPrefab(crate(), 'Crate');
    const gold: PrefabData = { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Gold crate', root: { name: 'Gold crate', tags: ['gold'], components: { sprite: { color: 0xffd700 } }, prefab: 'Crate', children: [] } };
    const inst: EntityData = { id: 'g', name: 'G', tags: [], prefab: 'Gold crate', components: { transform: { x: 3.5, y: 3.5, h: 0 } } };
    const { entities, problems } = expandEntities([inst], prefabs(base, gold));
    expect(problems).toEqual([]);
    expect((entities[0]!.components.sprite as { color: number; w: number }).color).toBe(0xffd700); // gold overrides crate
    expect((entities[0]!.components.sprite as { w: number }).w).toBe(0.9); // crate still supplies the rest
    expect(entities[0]!.tags.sort()).toEqual(['crate', 'gold']);
  });

  it('detects prefabs that contain themselves', () => {
    const loop: PrefabData = { schemaVersion: CURRENT_SCHEMA_VERSION, name: 'Loop', root: { name: 'Loop', tags: [], components: {}, prefab: 'Loop', children: [] } };
    const { problems } = expandEntities([{ id: 'l', name: 'L', tags: [], prefab: 'Loop', components: {} }], prefabs(loop));
    expect(problems.join(' ')).toMatch(/contains itself/);
    const a: PrefabData = { schemaVersion: 1, name: 'A', root: { name: 'A', tags: [], components: {}, prefab: 'B', children: [] } };
    const b: PrefabData = { schemaVersion: 1, name: 'B', root: { name: 'B', tags: [], components: {}, prefab: 'A', children: [] } };
    expect(expandEntities([{ id: 'x', name: 'X', tags: [], prefab: 'A', components: {} }], prefabs(a, b)).problems.join(' ')).toMatch(/contains itself/);
  });

  it('passes plain entities through untouched', () => {
    const e = crate();
    const { entities } = expandEntities([e], prefabs());
    expect(entities).toEqual([e]);
    expect(entities[0]).not.toBe(e);
  });
});
