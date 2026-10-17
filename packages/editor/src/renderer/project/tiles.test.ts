import { describe, expect, it } from 'vitest';
import { DEFAULT_TILESET, encodeRle, generateEdgeSet, newSprite, type AutotileRule, type SpriteData, type TileDefData } from '@tilewright/runtime';
import { addGeneratedSet, averageColor, baseTiles, checkRules, missingTiles, nextPatternChar, nextTileId, ownTiles, removeAutotile, setTileArt, tileArtProblems, tileFromSprite, variantsOf, withPatternChar } from './tiles';

const defaults = (): TileDefData[] => Object.entries(DEFAULT_TILESET).map(([id, t]) => ({ id: Number(id), ...t }));

describe('project tiles', () => {
  it('uses the built-in tiles for a project that never changed them', () => {
    expect(ownTiles({ tileset: [] }).map((t) => t.name)).toEqual(['grass', 'stone', 'sand', 'water', 'brick', 'wood']);
    expect(ownTiles({ tileset: [{ id: 7, name: 'x', top: 1, left: 2, right: 3 }] })).toHaveLength(1);
  });

  it('adds and removes a generated set, leaving the base tiles alone', () => {
    const tiles = defaults();
    const set = generateEdgeSet(4, Object.fromEntries(tiles.map((t) => [t.id, t])), nextTileId(tiles), 0xffffff);
    const added = addGeneratedSet(tiles, [], set);
    expect(added.tiles).toHaveLength(6 + 30);
    expect(variantsOf(added.tiles, 4)).toHaveLength(30);
    expect(baseTiles(added.tiles)).toHaveLength(6);
    const gone = removeAutotile(added.tiles, added.rules, 4);
    expect(gone.tiles).toHaveLength(6);
    expect(gone.rules).toEqual([]);
    expect(gone.removed).toHaveLength(30);
  });

  it('cycles a neighbour square through its five meanings', () => {
    let c = '*';
    const seen: string[] = [];
    for (let i = 0; i < 5; i++) {
      c = nextPatternChar(c);
      seen.push(c);
    }
    expect(seen).toEqual(['1', '0', 'L', 'H', '*']);
    expect(withPatternChar('********', 2, '1')).toBe('**1*****');
  });

  it('explains rules that cannot work', () => {
    const tiles = defaults();
    tiles.push({ id: 10, name: 'water edge', top: 1, left: 2, right: 3, group: 4 });
    const rule = (id: string, pattern: string, result: number, base = 4): AutotileRule => ({ id, name: id, base, pattern, result });
    expect(checkRules(tiles, [rule('a', '0*******', 10)])).toEqual([]);
    expect(checkRules(tiles, [rule('a', '0*******', 99)])[0]).toMatch(/no longer exists/);
    expect(checkRules(tiles, [rule('a', '0*******', 1)])[0]).toMatch(/not a variant of "water"/);
    expect(checkRules(tiles, [rule('a', '0*******', 10), rule('b', '0*******', 10)])[0]).toMatch(/can never apply.*"a"/);
    expect(checkRules(tiles, [rule('a', '********', 10), rule('b', '0*******', 10)])[0]).toMatch(/matches every cell/);
  });

  it('finds tiles a map uses that the list lacks', () => {
    expect(missingTiles([0, 1, 1, 42, 7], defaults())).toEqual([7, 42]);
  });
});

describe('tile art', () => {
  const art = (): SpriteData => {
    const s = newSprite('Mossy', 4, 2);
    s.palette[3] = '#c8501eff';
    s.frames[0]!.cels.l1 = encodeRle(Uint8Array.from([3, 3, 3, 3, 3, 3, 0, 0]));
    return s;
  };

  it('finds the average colour of a picture, ignoring see-through pixels', () => {
    const avg = averageColor(art());
    expect(avg).toBe(0xc8501e);
    expect(averageColor(newSprite('Blank', 4, 4))).toBe(0x9a9a9a);
  });

  it('makes a tile from a sprite, named after it, with darker sides', () => {
    const tiles = ownTiles({ tileset: [] });
    const t = tileFromSprite(tiles, art());
    expect(t).toMatchObject({ name: 'Mossy', art: 'Mossy', top: 0xc8501e });
    expect(t.id).toBe(nextTileId(tiles));
    expect(t.left).toBeLessThan(t.top);
    expect(t.right).toBeLessThan(t.left);
    const again = tileFromSprite([...tiles, t], art());
    expect(again.name).toBe('Mossy 2');
    expect(again.id).toBe(t.id + 1);
  });

  it('sets and takes away the art of a tile, and its variants follow', () => {
    const base = { id: 1, name: 'grass', top: 1, left: 2, right: 3 };
    const variant = { id: 7, name: 'grass edge', top: 1, left: 2, right: 3, group: 1 };
    const other = { id: 2, name: 'stone', top: 1, left: 2, right: 3 };
    const covered = setTileArt([base, variant, other], 1, 'Mossy');
    expect(covered.map((t) => t.art)).toEqual(['Mossy', 'Mossy', undefined]);
    expect(setTileArt(covered, 1, undefined).some((t) => 'art' in t)).toBe(false);
  });

  it('says in plain English when the art is missing', () => {
    const t = { id: 1, name: 'grass', top: 1, left: 2, right: 3, art: 'Gone' };
    expect(tileArtProblems([t], new Set(['Other']))[0]).toMatch(/covered by the sprite "Gone", which is not in this project/);
    expect(tileArtProblems([t], new Set(['Gone']))).toEqual([]);
  });
});
