import { describe, expect, it } from 'vitest';
import { applyAutotile, generateCliffSet, generateEdgeSet, groupOf, resolveTile, ruleFor, stripVariants, around, RIM_SIDE, type AutotileRule } from './autotile';
import { DEFAULT_TILESET, TileMap, type TileSet } from './tilemap';

const GRASS = 1;
const WATER = 4;

/** A 7x7 map of grass with a 3x3 lake in the middle, and the standard shore rules for water. */
function lake() {
  const map = new TileMap(7, 7);
  map.fill(GRASS, 0);
  for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) map.set(x, y, WATER, 0);
  const tileset: TileSet = { ...DEFAULT_TILESET };
  const set = generateEdgeSet(WATER, tileset, 100, 0xffffff);
  for (const t of set.tiles) tileset[t.id] = t;
  return { map, tileset, rules: set.rules, set };
}

describe('autotile', () => {
  it('generates 30 variants and rules, all pointing at tiles that exist and belong to the base', () => {
    const { set, tileset } = lake();
    expect(set.tiles).toHaveLength(30);
    expect(set.rules).toHaveLength(30);
    for (const r of set.rules) {
      expect(r.pattern).toMatch(/^[01*LH]{8}$/);
      expect(groupOf(tileset, r.result)).toBe(WATER);
    }
    expect(new Set(set.tiles.map((t) => t.id)).size).toBe(30);
  });

  it('shows the right edge variant on each side of a lake and the plain tile in the middle', () => {
    const { map, tileset, rules } = lake();
    const changed = applyAutotile(map, tileset, rules);
    expect(changed.length).toBe(8); // all of the lake except its centre
    expect(map.getTile(3, 3)).toBe(WATER); // surrounded by water: no rim
    const rim = (x: number, y: number) => tileset[map.getTile(x, y)]!.rim;
    expect(rim(3, 2)?.sides).toBe(RIM_SIDE.N); // top edge of the lake borders grass to the north
    expect(rim(4, 3)?.sides).toBe(RIM_SIDE.E);
    expect(rim(3, 4)?.sides).toBe(RIM_SIDE.S);
    expect(rim(2, 3)?.sides).toBe(RIM_SIDE.W);
    expect(rim(2, 2)?.sides).toBe(RIM_SIDE.N | RIM_SIDE.W); // a lake corner has two open sides
    expect(rim(4, 4)?.sides).toBe(RIM_SIDE.E | RIM_SIDE.S);
  });

  it('shows an inner-corner dot where only a diagonal neighbour is different', () => {
    const { map, tileset, rules } = lake();
    map.set(5, 5, GRASS, 0);
    map.set(4, 4, WATER, 0);
    map.set(3, 3, GRASS, 0); // a grass cell inside the water: its diagonal neighbours (2,2) and others see a different diagonal
    applyAutotile(map, tileset, rules);
    const dot = tileset[map.getTile(4, 4)]!.rim;
    expect(dot?.sides).toBeGreaterThan(0); // the island makes (4,4) an edge cell too
    const lone = lake();
    lone.map.set(3, 3, GRASS, 0);
    applyAutotile(lone.map, lone.tileset, lone.rules);
    // (2,2) has water to its east and south, grass to the north and west: edges, not a corner
    expect(lone.tileset[lone.map.getTile(2, 2)]!.rim?.sides).toBe(RIM_SIDE.N | RIM_SIDE.W);
    // a cell with water on all four sides but grass on a diagonal gets a corner dot
    const m = new TileMap(5, 5);
    m.fill(WATER, 0);
    m.set(1, 1, GRASS, 0);
    applyAutotile(m, lone.tileset, lone.rules);
    expect(lone.tileset[m.getTile(2, 2)]!.rim).toMatchObject({ sides: 0, corners: 8 }); // NW diagonal is grass
  });

  it('keeps other tiles and cells with no rules alone, and is stable when run again', () => {
    const { map, tileset, rules } = lake();
    applyAutotile(map, tileset, rules);
    const grass = map.getTile(0, 0);
    expect(grass).toBe(GRASS);
    expect(applyAutotile(map, tileset, rules)).toEqual([]);
    const custom: TileSet = { ...tileset, 9: { name: 'odd', top: 1, left: 2, right: 3 } };
    map.set(0, 0, 9, 0);
    expect(resolveTile(map, custom, rules, 0, 0)).toBe(9);
  });

  it('a painted-over cell goes back to the right variant when its neighbours change', () => {
    const { map, tileset, rules } = lake();
    applyAutotile(map, tileset, rules);
    map.set(3, 3, GRASS, 0); // dig out the middle
    applyAutotile(map, tileset, rules, around(map, 3, 3));
    expect(tileset[map.getTile(3, 2)]!.rim?.sides).toBe(RIM_SIDE.N | RIM_SIDE.S);
    map.set(3, 3, WATER, 0); // fill it again
    applyAutotile(map, tileset, rules, around(map, 3, 3));
    expect(tileset[map.getTile(3, 2)]!.rim?.sides).toBe(RIM_SIDE.N);
  });

  it('strips variants back to their base tile', () => {
    const { map, tileset, rules } = lake();
    applyAutotile(map, tileset, rules);
    expect(stripVariants(map, tileset)).toBe(8);
    expect(map.getTile(2, 2)).toBe(WATER);
  });

  it('cliff faces show where the ground beside a cell is lower, and "why" can be asked', () => {
    const tileset: TileSet = { ...DEFAULT_TILESET };
    const set = generateCliffSet(2, tileset, 200, 0x6b5b4b);
    for (const t of set.tiles) tileset[t.id] = t;
    const map = new TileMap(6, 6);
    map.fill(1, 0);
    for (let y = 1; y <= 3; y++) for (let x = 1; x <= 3; x++) map.set(x, y, 2, 2); // a plateau two levels up
    applyAutotile(map, tileset, set.rules);
    const name = (x: number, y: number): string => tileset[map.getTile(x, y)]!.name;
    expect(name(2, 3)).toBe('stone cliff south'); // ground to the south is lower
    expect(name(3, 2)).toBe('stone cliff east');
    expect(name(3, 3)).toBe('stone cliff south+east');
    expect(name(2, 2)).toBe('stone'); // the middle shows no cliff
    expect(ruleFor(map, tileset, set.rules, 3, 3)?.name).toBe('cliff south+east');
    expect(tileset[map.getTile(2, 3)]!.left).toBe(0x6b5b4b);
  });

  it('H and L compare heights, and the edge of the map and empty cells count as lower', () => {
    const tileset: TileSet = { ...DEFAULT_TILESET };
    const map = new TileMap(3, 3);
    map.fill(1, 1);
    const rule = (pattern: string): AutotileRule[] => [{ id: 'r', name: 'r', base: 1, pattern, result: 3 }];
    expect(resolveTile(map, tileset, rule('L*******'), 1, 0)).toBe(3); // north of row 0 is off the map
    expect(resolveTile(map, tileset, rule('H*******'), 1, 1)).toBe(1);
    map.set(1, 0, 1, 3);
    expect(resolveTile(map, tileset, rule('H*******'), 1, 1)).toBe(3);
  });
});
