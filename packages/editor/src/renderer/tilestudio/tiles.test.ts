import { describe, expect, it } from 'vitest';
import { DEFAULT_TILESET, type TileDefData } from '@tilewright/runtime';
import { blankRgba, blobSlots, spriteFromFrames, spriteFromRgba } from './pixels';
import { addEdgeSet, emptyTileForm, formOfTile, missingSlots, slotSpriteName, tileOfSprite, upsertTile } from './tiles';

const base = (): TileDefData[] => Object.entries(DEFAULT_TILESET).map(([id, t]) => ({ id: Number(id), ...t }));
const green = (w = 4, h = 4) => {
  const img = blankRgba(w, h);
  for (let i = 0; i < w * h; i++) img.data.set([40, 160, 60, 255], i * 4);
  return img;
};

describe('sending a sprite to the palette', () => {
  it('makes a tile with the properties, and updating it keeps the id so placed copies follow', () => {
    const sprite = spriteFromRgba('meadow', green());
    const form = { ...emptyTileForm('Meadow'), props: { walkable: true, footstep: 'grass', tags: ['soft'], custom: { speed: 1.2 } } };
    const made = upsertTile(base(), sprite, form);
    const tile = made.tiles.find((t) => t.id === made.id)!;
    expect(tile).toMatchObject({ name: 'Meadow', art: 'meadow', props: { footstep: 'grass', tags: ['soft'], custom: { speed: 1.2 } } });
    expect(tile.props!.walkable).toBeUndefined(); // walkable is the default: not written
    expect(tileOfSprite(made.tiles, 'meadow')?.id).toBe(made.id);
    // later: the same sprite, different properties
    const again = upsertTile(made.tiles, sprite, { ...formOfTile(tile), props: { walkable: false, water: true } });
    expect(again.id).toBe(made.id);
    expect(again.tiles).toHaveLength(made.tiles.length);
    expect(again.tiles.find((t) => t.id === made.id)!.props).toEqual({ walkable: false, water: true });
  });

  it('an animated top uses every frame of the sprite', () => {
    const sprite = spriteFromFrames('water', [green(), green(), green()]);
    const made = upsertTile(base(), sprite, { ...emptyTileForm('Water'), animate: true, fps: 6 });
    const tile = made.tiles.find((t) => t.id === made.id)!;
    expect(tile.anim).toEqual({ frames: ['water#0', 'water#1', 'water#2'], fps: 6 });
    expect(tile.art).toBeUndefined();
    expect(tileOfSprite(made.tiles, 'water')?.id).toBe(made.id);
  });

  it('pictures for the sides, how often they repeat, and weighted variants are remembered', () => {
    const sprite = spriteFromRgba('cliff', green());
    const form = { ...emptyTileForm('Cliff'), leftArt: 'cliff_l', rightArt: 'cliff_r', faceLevels: 2, variants: [{ tile: 3, weight: 2 }, { tile: 2, weight: 0 }] };
    const made = upsertTile(base(), sprite, form);
    const tile = made.tiles.find((t) => t.id === made.id)!;
    expect(tile).toMatchObject({ leftArt: 'cliff_l', rightArt: 'cliff_r', faceLevels: 2, variants: [{ tile: 3, weight: 2 }] });
    expect(formOfTile(tile)).toMatchObject({ faceLevels: 2, leftArt: 'cliff_l' });
  });
});

describe('edge sets', () => {
  it('a variant tile and a rule for every piece but the centre, and applying again replaces the old pieces', () => {
    const slots = blobSlots();
    const once = addEdgeSet(base(), [], 1, 'grass', slots);
    expect(once.tiles.filter((t) => t.group === 1)).toHaveLength(46);
    expect(once.rules).toHaveLength(46);
    expect(once.tiles.find((t) => t.name === 'grass edge-N')!.art).toBe(slotSpriteName('grass', 'edge-N'));
    const rule = once.rules.find((r) => r.name === 'grass: Edge N')!;
    expect(once.tiles.find((t) => t.id === rule.result)!.name).toBe('grass edge-N');
    expect(rule.base).toBe(1);
    const twice = addEdgeSet(once.tiles, once.rules, 1, 'grass', slots);
    expect(twice.tiles).toHaveLength(once.tiles.length);
    expect(twice.rules).toHaveLength(46);
  });

  it('lists the pieces that are still blank', () => {
    const slots = blobSlots();
    const filled = new Map([[slotSpriteName('grass', 'edge-N'), spriteFromRgba('x', green())]]);
    filled.set(slotSpriteName('grass', 'edge-E'), spriteFromRgba('y', blankRgba(4, 4)));
    const blank = (s: { palette: string[] }): boolean => s.palette.length <= 1;
    const missing = missingSlots(slots, 'grass', filled, blank);
    expect(missing).toHaveLength(46);
    expect(missing.some((s) => s.id === 'edge-N')).toBe(false);
    expect(missing.some((s) => s.id === 'edge-E')).toBe(true);
  });
});

import { pickTileVariant } from './tiles';

describe('painting with variants', () => {
  it('mostly the tile itself, sometimes a variant by weight, and the same every time for a cell', () => {
    const tiles: TileDefData[] = [
      { id: 1, name: 'grass', top: 1, left: 1, right: 1, variants: [{ tile: 7, weight: 0.25 }, { tile: 8, weight: 0.25 }] },
      { id: 7, name: 'flowers', top: 1, left: 1, right: 1 },
      { id: 8, name: 'stones', top: 1, left: 1, right: 1 },
    ];
    const counts: Record<number, number> = { 1: 0, 7: 0, 8: 0 };
    for (let y = 0; y < 40; y++) for (let x = 0; x < 40; x++) counts[pickTileVariant(tiles, 1, x, y)]!++;
    expect(counts[1]!).toBeGreaterThan(700);
    expect(counts[7]!).toBeGreaterThan(80);
    expect(counts[8]!).toBeGreaterThan(80);
    expect(pickTileVariant(tiles, 1, 5, 9)).toBe(pickTileVariant(tiles, 1, 5, 9));
    expect(pickTileVariant(tiles, 7, 3, 3)).toBe(7); // a tile with no variants is itself
  });
});
