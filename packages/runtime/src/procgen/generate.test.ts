import { describe, expect, it } from 'vitest';
import { FLAG } from '../tilemap/tilemap';
import { cellWalkable } from '../physics/terrain';
import { GeneratorSpecSchema, generate, newGeneratorSpec, startReachesEnd, type GeneratorSpec } from './generate';

const spec = (over: Partial<GeneratorSpec> = {}): GeneratorSpec => GeneratorSpecSchema.parse({ ...newGeneratorSpec(over.kind ?? 'dungeon'), ...over });
const walkableCount = (g: ReturnType<typeof generate>): number => {
  let n = 0;
  for (let y = 0; y < g.map.height; y++) for (let x = 0; x < g.map.width; x++) if (cellWalkable(g.map, x, y) && g.map.getHeight(x, y) === 0) n++;
  return n;
};

describe('procedural maps', () => {
  it('give the same map for the same seed and a different one for another', () => {
    const a = generate(spec({ seed: 7 }));
    const b = generate(spec({ seed: 7 }));
    const c = generate(spec({ seed: 8 }));
    expect(JSON.stringify(a.map.toJSON())).toBe(JSON.stringify(b.map.toJSON()));
    expect(JSON.stringify(a.map.toJSON())).not.toBe(JSON.stringify(c.map.toJSON()));
    expect(a.start).toEqual(b.start);
    // the seed can be overridden for a new run without touching the spec
    expect(JSON.stringify(generate(spec({ seed: 1 }), 7).map.toJSON())).toBe(JSON.stringify(a.map.toJSON()));
  });

  it('rooms and corridors: rooms do not overlap, everything is connected, walls stand round the floor', () => {
    for (const seed of [1, 2, 3, 4, 5, 99, 1234]) {
      const g = generate(spec({ kind: 'dungeon', seed, rooms: 9, width: 56, height: 56 }));
      expect(g.rooms.length).toBeGreaterThanOrEqual(5);
      for (let i = 0; i < g.rooms.length; i++) {
        for (let j = i + 1; j < g.rooms.length; j++) {
          const a = g.rooms[i]!;
          const b = g.rooms[j]!;
          expect(a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h, `rooms ${i} and ${j} overlap (seed ${seed})`).toBe(false);
        }
      }
      expect(startReachesEnd(g), `seed ${seed}`).toBe(true);
      expect(cellWalkable(g.map, g.start.x, g.start.y)).toBe(true);
      expect(cellWalkable(g.map, g.end.x, g.end.y)).toBe(true);
      // every floor cell that touches an empty cell has a wall instead (nobody can fall off the edge of the level)
      for (let y = 1; y < g.map.height - 1; y++) {
        for (let x = 1; x < g.map.width - 1; x++) {
          if (g.map.getHeight(x, y) !== 0 || g.map.getTile(x, y) === 0) continue;
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) expect(g.map.getTile(x + dx, y + dy), `open edge at ${x},${y}`).not.toBe(0);
        }
      }
    }
  });

  it('tell the designer when the rules ask for more than fits', () => {
    const g = generate(spec({ seed: 3, rooms: 150, width: 24, height: 24, roomMin: 6, roomMax: 9 }));
    expect(g.notes.join(' ')).toMatch(/Only \d+ of the 150 rooms fit/);
  });

  it('caves: one connected cave with a start and an exit at its ends', () => {
    for (const seed of [1, 2, 3, 11]) {
      const g = generate(spec({ kind: 'cave', seed, width: 48, height: 40 }));
      expect(walkableCount(g)).toBeGreaterThan(150);
      expect(startReachesEnd(g)).toBe(true);
      expect(g.start).not.toEqual(g.end);
    }
  });

  it('islands: water around, a start on a beach, hills in the middle, one landmass', () => {
    const g = generate(spec({ kind: 'island', seed: 5, width: 48, height: 48, landRatio: 0.45, hills: 2 }));
    let water = 0;
    let land = 0;
    let hill = 0;
    for (let y = 0; y < 48; y++) {
      for (let x = 0; x < 48; x++) {
        if (g.map.hasFlag(x, y, FLAG.WATER)) water++;
        else {
          land++;
          if (g.map.getHeight(x, y) > 0) hill++;
        }
      }
    }
    expect(water).toBeGreaterThan(200);
    expect(land).toBeGreaterThan(300);
    expect(hill).toBeGreaterThan(0);
    expect(g.map.hasFlag(0, 0, FLAG.WATER)).toBe(true);
    expect(g.map.getTile(g.start.x, g.start.y)).toBe(3); // sand
    expect(startReachesEnd(g)).toBe(true);
  });

  it('towns: roads on a grid, a building on most lots, the plaza left open', () => {
    const g = generate(spec({ kind: 'town', seed: 4, width: 40, height: 40, buildingPrefab: 'House', roadSpacing: 10 }));
    expect(g.placements.filter((p) => p.prefab === 'House').length).toBeGreaterThan(5);
    expect(g.placements.some((p) => Math.hypot(p.x - 20, p.y - 20) < 4)).toBe(false);
    expect(g.map.getTile(5, 15)).toBe(2); // a road cell
    const bare = generate(spec({ kind: 'town', seed: 4, width: 40, height: 40 }));
    expect(bare.notes.join(' ')).toMatch(/No building prefab/);
  });

  it('scatter rules place props where they say, with spacing, counts and tags, and never on the start', () => {
    const g = generate(
      spec({
        seed: 9,
        scatter: [
          { prefab: 'Chest', where: 'room', count: 4, chance: 0, spacing: 3, tag: 'loot' },
          { prefab: 'Torch', where: 'edge', count: 0, chance: 0.1, spacing: 2, tag: '' },
          { prefab: 'Stairs', where: 'end', count: 0, chance: 1, spacing: 0, tag: 'exit' },
          { prefab: 'Hero', where: 'start', count: 0, chance: 1, spacing: 0, tag: 'player' },
        ],
      }),
    );
    const chests = g.placements.filter((p) => p.prefab === 'Chest');
    expect(chests).toHaveLength(4);
    expect(chests.every((c) => c.tag === 'loot')).toBe(true);
    for (const c of chests) expect(g.rooms.some((r) => c.x >= r.x && c.x < r.x + r.w && c.y >= r.y && c.y < r.y + r.h)).toBe(true);
    for (let i = 0; i < chests.length; i++) for (let j = i + 1; j < chests.length; j++) expect(Math.hypot(chests[i]!.x - chests[j]!.x, chests[i]!.y - chests[j]!.y)).toBeGreaterThanOrEqual(3);
    expect(g.placements.filter((p) => p.prefab === 'Torch').length).toBeGreaterThan(3);
    expect(g.placements.find((p) => p.prefab === 'Stairs')).toMatchObject({ x: g.end.x + 0.5, y: g.end.y + 0.5, tag: 'exit' });
    expect(g.placements.find((p) => p.prefab === 'Hero')).toMatchObject({ x: g.start.x + 0.5, y: g.start.y + 0.5 });
    expect(chests.some((c) => Math.floor(c.x) === g.start.x && Math.floor(c.y) === g.start.y)).toBe(false);
  });

  it('refuse settings that make no sense', () => {
    expect(GeneratorSpecSchema.safeParse({ kind: 'dungeon', width: 2 }).success).toBe(false);
    expect(GeneratorSpecSchema.safeParse({ kind: 'maze' }).success).toBe(false);
    expect(GeneratorSpecSchema.safeParse({}).success).toBe(true);
  });
});

describe('maps made when the game starts', () => {
  it('replace the map, place the prefabs, move the player to the start, and use run.seed unless the seed is locked', async () => {
    const { Simulation } = await import('../core/simulation');
    const { loadScene, tileMapToRows } = await import('../project/scene');
    const { TileMap } = await import('../tilemap/tilemap');
    const { CURRENT_SCHEMA_VERSION } = await import('../project/schema');
    const base = new TileMap(12, 12);
    base.fill(1, 0);
    const prefab = (name: string) => ({ schemaVersion: 1, name, root: { name, tags: [], children: [], components: { transform: { x: 0, y: 0, h: 0, facing: 2 }, sprite: { shape: 'box', color: 0xffffff, w: 0.5, d: 0.5, height: 0.5, sortOffset: 0, visible: true } } } });
    const prefabs = new Map([['Chest', prefab('Chest')], ['Hero', prefab('Hero')]]);
    const make = (locked: boolean) => ({
      schemaVersion: CURRENT_SCHEMA_VERSION,
      name: 'Run',
      map: tileMapToRows(base),
      entities: [{ id: 'p', name: 'Player', tags: ['player'], components: { transform: { x: 1.5, y: 1.5, h: 0, facing: 2 } } }],
      regions: [],
      wires: [],
      variables: [],
      events: [],
      generator: { ...spec({ seed: 3, lockSeed: locked, atStart: true, scatter: [{ prefab: 'Chest', where: 'room', count: 3, chance: 0, spacing: 3, tag: 'loot' }] }) },
    });
    const play = (locked: boolean, runSeed?: number) => {
      const sim = new Simulation(1);
      if (runSeed !== undefined) sim.runtime.vars['run.seed'] = runSeed;
      const ids = loadScene(sim, make(locked) as never, { prefabs: prefabs as never, travel: runSeed !== undefined });
      return { sim, ids };
    };
    const a = play(true);
    expect(a.sim.map!.width).toBe(48);
    expect(a.sim.world.withTag('loot')).toHaveLength(3);
    const t = a.sim.world.withTag('player')[0]!.get<{ x: number; y: number }>('transform')!;
    const g = generate(spec({ seed: 3 }));
    expect([Math.floor(t.x), Math.floor(t.y)]).toEqual([g.start.x, g.start.y]);
    expect(a.sim.runtime.vars['generated.seed']).toBe(3);
    // a locked seed ignores run.seed; an unlocked one follows it, so a new run is a new level
    const locked = play(true, 50);
    expect(locked.sim.runtime.vars['generated.seed']).toBe(3);
    const r1 = play(false, 50);
    const r2 = play(false, 51);
    expect(r1.sim.runtime.vars['generated.seed']).toBe(50);
    expect(JSON.stringify(r1.sim.map!.toJSON())).not.toBe(JSON.stringify(r2.sim.map!.toJSON()));
    expect(JSON.stringify(play(false, 50).sim.map!.toJSON())).toBe(JSON.stringify(r1.sim.map!.toJSON()));
    // rules that are not valid leave the map alone and say so
    const bad = new Simulation(1);
    const bs = make(true);
    (bs.generator as Record<string, unknown>).kind = 'maze';
    const out = loadScene(bad, bs as never, { prefabs: prefabs as never });
    expect(out.problems.join(' ')).toContain('generator settings are not valid');
    expect(bad.map!.width).toBe(12);
  });
});
