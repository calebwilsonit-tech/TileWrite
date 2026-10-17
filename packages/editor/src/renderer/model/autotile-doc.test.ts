import { describe, expect, it } from 'vitest';
import { DEFAULT_TILESET, RIM_SIDE, TileMap, generateEdgeSet, type TileSet } from '@tilewright/runtime';
import { EditorDoc } from './doc';
import { isWallTile, objectLayerOf } from './layers';

const GRASS = 1;
const WATER = 4;
const BRICK = 5;

function lakeDoc() {
  const map = new TileMap(8, 8);
  map.fill(GRASS, 0);
  const tileset: TileSet = { ...DEFAULT_TILESET };
  const set = generateEdgeSet(WATER, tileset, 100, 0xffffff);
  for (const t of set.tiles) tileset[t.id] = t;
  const doc = new EditorDoc('t', map);
  doc.autotile = { tileset, rules: set.rules };
  return { doc, tileset };
}

const rimAt = (doc: EditorDoc, tileset: TileSet, x: number, y: number) => tileset[doc.map.getTile(x, y)]?.rim?.sides ?? 0;

describe('autotiling while painting', () => {
  it('painting water gives it shores, and the neighbours are told too, as one undo step', () => {
    const { doc, tileset } = lakeDoc();
    const s = doc.beginStroke('Paint water');
    for (let y = 2; y <= 4; y++) for (let x = 2; x <= 4; x++) s.apply(x, y, { tile: WATER });
    s.commit();
    expect(rimAt(doc, tileset, 2, 2)).toBe(RIM_SIDE.N | RIM_SIDE.W);
    expect(rimAt(doc, tileset, 3, 3)).toBe(0);
    expect(doc.map.getTile(3, 3)).toBe(WATER);
    expect(doc.history.labels).toHaveLength(1);
    doc.history.undo();
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) expect(doc.map.getTile(x, y)).toBe(GRASS);
    doc.history.redo();
    expect(rimAt(doc, tileset, 4, 4)).toBe(RIM_SIDE.E | RIM_SIDE.S);
  });

  it('digging out a cell updates the cells around it', () => {
    const { doc, tileset } = lakeDoc();
    doc.paint('water', [2, 3, 4].flatMap((y) => [2, 3, 4].map((x) => ({ x, y, patch: { tile: WATER } }))));
    expect(rimAt(doc, tileset, 3, 2)).toBe(RIM_SIDE.N);
    doc.paint('grass', [{ x: 3, y: 3, patch: { tile: GRASS } }]);
    expect(rimAt(doc, tileset, 3, 2)).toBe(RIM_SIDE.N | RIM_SIDE.S);
    doc.history.undo();
    expect(rimAt(doc, tileset, 3, 2)).toBe(RIM_SIDE.N);
    expect(doc.map.getTile(3, 3)).toBe(WATER);
  });

  it('a project without rules is painted exactly as before', () => {
    const { doc } = lakeDoc();
    doc.autotile = null;
    doc.paint('water', [{ x: 3, y: 3, patch: { tile: WATER } }]);
    expect(doc.map.getTile(3, 3)).toBe(WATER);
    expect(doc.map.getTile(3, 2)).toBe(GRASS);
  });

  it('applying the rules to the whole scene is one undo step and reports how many cells changed', () => {
    const { doc, tileset } = lakeDoc();
    const saved = doc.autotile;
    doc.autotile = null;
    doc.paint('water', [2, 3, 4].flatMap((y) => [2, 3, 4].map((x) => ({ x, y, patch: { tile: WATER } }))));
    doc.autotile = saved;
    const before = doc.history.labels.length;
    expect(doc.reapplyAutotile()).toBe(8);
    expect(doc.history.labels).toHaveLength(before + 1);
    expect(rimAt(doc, tileset, 2, 2)).toBe(RIM_SIDE.N | RIM_SIDE.W);
    expect(doc.reapplyAutotile()).toBe(0); // nothing left to do
    doc.history.undo();
    expect(doc.map.getTile(2, 2)).toBe(WATER);
  });
});

describe('layers', () => {
  it('a locked Walls layer leaves wall cells alone and still paints everything else', () => {
    const { doc, tileset } = lakeDoc();
    doc.autotile = null;
    doc.paint('wall', [{ x: 1, y: 1, patch: { tile: BRICK } }]);
    doc.cellGuard = (b, a) => !isWallTile(tileset, b.tile) && !isWallTile(tileset, a.tile);
    doc.paint('over the wall', [{ x: 1, y: 1, patch: { tile: GRASS } }, { x: 5, y: 5, patch: { tile: WATER } }]);
    expect(doc.map.getTile(1, 1)).toBe(BRICK);
    expect(doc.map.getTile(5, 5)).toBe(WATER);
    doc.paint('a new wall', [{ x: 6, y: 6, patch: { tile: BRICK } }]);
    expect(doc.map.getTile(6, 6)).toBe(GRASS); // painting a wall is refused too
  });

  it('sorts objects into Objects, Decoration and Lights; the player with a light stays an object', () => {
    expect(objectLayerOf({ tags: ['crate'], components: {} })).toBe('objects');
    expect(objectLayerOf({ tags: ['decoration'], components: {} })).toBe('decoration');
    expect(objectLayerOf({ tags: ['light'], components: { light: {} } })).toBe('lights');
    expect(objectLayerOf({ tags: ['player'], components: { light: {} } })).toBe('objects');
  });

  it('brick counts as a wall by default', () => {
    expect(isWallTile(DEFAULT_TILESET, BRICK)).toBe(true);
    expect(isWallTile(DEFAULT_TILESET, GRASS)).toBe(false);
  });
});
