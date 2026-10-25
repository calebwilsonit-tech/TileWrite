import { describe, expect, it } from 'vitest';
import { blankRgba, type Rgba } from './pixels';
import { importTiles, quantize, removeBackground, resize, snapColours, trim } from './import';
import { faceAt, makeTile, tilePatch, tileTemplate, templateRows } from './make-tile';
import { upsertTile } from './tiles';

const ISO = { tileW: 64, tileH: 32, heightPx: 16 };

function solid(w: number, h: number, rgba: [number, number, number, number]): Rgba {
  const img = blankRgba(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(rgba, i * 4);
  return img;
}
const px = (img: Rgba, x: number, y: number): number[] => [...img.data.subarray((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('the template of a tile', () => {
  it('is the size of the project\'s tile, with the diamond for a floor and three faces for a block', () => {
    const floor = tileTemplate(ISO, 'floor');
    expect([floor.width, floor.height, floor.preset]).toEqual([64, 32, 'flat']);
    const rows = templateRows(floor);
    expect(rows).toHaveLength(32);
    expect(rows[0]!.length).toBe(64);
    expect(rows[16]![32]).toBe('T'); // the middle
    expect(rows[0]![0]).toBe('.'); // the corner is outside the diamond
    expect(rows[16]![3]).toBe('T'); // near the left point of the diamond
    const block = tileTemplate(ISO, 'block', 1);
    expect([block.width, block.height, block.preset]).toEqual([64, 48, 'block']);
    const faces = templateRows(block).join('');
    expect(faces).toMatch(/T/);
    expect(faces).toMatch(/L/);
    expect(faces).toMatch(/R/);
    expect(faceAt(block, 32, 8)).toBe(0); // top
    expect(faceAt(block, 10, 30)).toBe(1); // left side
    expect(faceAt(block, 54, 30)).toBe(2); // right side
    expect(tileTemplate(ISO, 'block', 0.5).preset).toBe('half');
  });
});

describe('making a tile from a drawing', () => {
  it('cuts a floor tile to its diamond and gives it the studio\'s own tile settings', () => {
    const t = tileTemplate(ISO, 'floor');
    const made = makeTile(solid(64, 32, [40, 160, 60, 255]), ISO, t, 'grassy');
    expect(made.sprites).toHaveLength(1);
    const sprite = made.sprites[0]!;
    expect(sprite.meta).toMatchObject({ kind: 'tile', preset: 'flat', heightCells: 0 });
    expect(px(made.picture, 0, 0)[3]).toBe(0); // outside the diamond: cut away
    expect(px(made.picture, 32, 16)).toEqual([40, 160, 60, 255]);
    // it goes into the palette as a tile that uses the sprite as its top
    const tiles = upsertTile([], sprite, made.form);
    expect(tiles.tiles).toHaveLength(1);
    expect(tiles.tiles[0]).toMatchObject({ name: 'grassy', art: 'grassy' });
  });

  it('cuts a block into a top, a left and a right picture and uses them as the tile\'s three faces', () => {
    const t = tileTemplate(ISO, 'block', 1);
    const drawing = blankRgba(64, 48);
    for (let y = 0; y < 48; y++) for (let x = 0; x < 64; x++) drawing.data.set(x < 32 ? [200, 50, 50, 255] : [50, 50, 200, 255], (y * 64 + x) * 4);
    const made = makeTile(drawing, ISO, t, 'brick');
    expect(made.sprites.map((s) => s.name)).toEqual(['brick', 'brick_top', 'brick_left', 'brick_right']);
    expect(made.sprites[1]!.meta!.kind).toBe('tile');
    expect(made.sprites[2]!.meta!.kind).toBe('wall');
    expect(made.topSprite).toBe('brick_top');
    expect(made.form).toMatchObject({ leftArt: 'brick_left', rightArt: 'brick_right', faceLevels: 1 });
    const top = upsertTile([], made.sprites[1]!, made.form).tiles[0]!;
    expect(top).toMatchObject({ art: 'brick_top', leftArt: 'brick_left', rightArt: 'brick_right' });
  });

  it('shows the tile repeated over a patch of ground, so a seam would be seen', () => {
    const t = tileTemplate(ISO, 'floor');
    const made = makeTile(solid(64, 32, [200, 200, 0, 255]), ISO, t, 'sand');
    const patch = tilePatch(made.picture, ISO, 3, 3, 1);
    expect(patch.width).toBe(3 * 64 + 32);
    // the middle of the patch is covered by tiles; the corners of the picture are not
    expect(px(patch, patch.width / 2, 48)[3]).toBe(255);
    expect(px(patch, 0, 0)[3]).toBe(0);
    expect(tilePatch(made.picture, ISO, 2, 2, 2).width).toBe((2 * 2 * 32 + 32) * 2);
  });
});

describe('taking in a picture made elsewhere', () => {
  it('lays a flat texture on the floor diamond and keeps the diamond clean', () => {
    const r = importTiles(solid(256, 256, [100, 120, 60, 255]), { iso: ISO, kind: 'floor', source: 'texture', palette: ['#64783cff'] });
    expect(r.tiles).toHaveLength(1);
    const img = r.tiles[0]!.img;
    expect([img.width, img.height]).toEqual([64, 32]);
    expect(px(img, 32, 16)).toEqual([100, 120, 60, 255]);
    expect(px(img, 1, 1)[3]).toBe(0);
    expect(r.notes.join(' ')).toContain('floor diamond');
  });

  it('lays a texture on the three faces of a block, the sides darker than the top', () => {
    const r = importTiles(solid(64, 64, [200, 200, 200, 255]), { iso: ISO, kind: 'block', source: 'texture', levels: 1, maxColours: 8 });
    const img = r.tiles[0]!.img;
    expect([img.width, img.height]).toEqual([64, 48]);
    const top = px(img, 32, 8);
    const left = px(img, 10, 30);
    const right = px(img, 54, 30);
    expect(top[0]).toBeGreaterThan(left[0]!);
    expect(left[0]).toBeGreaterThan(right[0]!);
  });

  it('takes the background away from a picture that is already isometric, trims it, fits it and cuts it to the faces', () => {
    const src = solid(200, 200, [255, 255, 255, 255]);
    for (let y = 60; y < 140; y++) for (let x = 40; x < 160; x++) src.data.set([180, 40, 40, 255], (y * 200 + x) * 4);
    const r = importTiles(src, { iso: ISO, kind: 'floor', source: 'picture', maxColours: 4 });
    const img = r.tiles[0]!.img;
    expect([img.width, img.height]).toEqual([64, 32]);
    expect(px(img, 32, 16)[0]).toBeGreaterThan(150); // the red shows in the middle, not the white
    expect(px(img, 32, 16)[1]).toBeLessThan(100);
    expect(px(img, 0, 0)[3]).toBe(0);
    expect(r.notes.join(' ')).toContain('after taking away the background');
  });

  it('cuts a sheet into tiles and leaves out the empty pieces', () => {
    const sheet = blankRgba(128, 128);
    for (const [cx, cy, c] of [[0, 0, [200, 0, 0]], [1, 1, [0, 200, 0]]] as const) {
      for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) sheet.data.set([c[0], c[1], c[2], 255], ((cy * 64 + y) * 128 + cx * 64 + x) * 4);
    }
    const r = importTiles(sheet, { iso: ISO, kind: 'floor', source: 'texture', columns: 2, rows: 2, maxColours: 4 });
    expect(r.tiles.map((t) => [t.col, t.row])).toEqual([[0, 0], [1, 1]]);
    expect(r.notes.join(' ')).toContain('2 empty pieces were left out');
  });

  it('brings colours to the project\'s palette, or reduces them to a few', () => {
    const img = blankRgba(2, 1);
    img.data.set([250, 10, 10, 255, 10, 10, 240, 255]);
    const snapped = snapColours(img, ['#ff0000ff', '#0000ffff']);
    expect([...snapped.data]).toEqual([255, 0, 0, 255, 0, 0, 255, 255]);
    const many = blankRgba(16, 16);
    for (let i = 0; i < 256; i++) many.data.set([i, (i * 7) & 255, (255 - i) & 255, 255], i * 4);
    const palette = quantize([many], 6);
    expect(palette.length).toBeLessThanOrEqual(6);
    expect(palette.length).toBeGreaterThan(2);
    expect(palette.every((c) => /^#[0-9a-f]{8}$/.test(c))).toBe(true);
  });

  it('resizes by averaging, trims to what is drawn, and only clears a plain background', () => {
    const half = resize(solid(4, 4, [100, 100, 100, 255]), 2, 2);
    expect([...half.data.subarray(0, 4)]).toEqual([100, 100, 100, 255]);
    const dot = blankRgba(8, 8);
    dot.data.set([1, 2, 3, 255], (3 * 8 + 4) * 4);
    const t = trim(dot);
    expect([t.width, t.height]).toEqual([1, 1]);
    // corners that disagree: no plain background, nothing is taken away
    const mixed = solid(4, 4, [255, 255, 255, 255]);
    mixed.data.set([0, 0, 0, 255], 0);
    expect(removeBackground(mixed).data[3]).toBe(255);
  });
});
