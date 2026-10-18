import { describe, expect, it } from 'vitest';
import { blankRgba, blobRules, blobSlots, drawEdges, isEmpty, mirror, packSheet, recolourPalette, recolourSprite, rgbaOf, shadeFaces, sliceSheet, spriteFromFrames, spriteFromRgba, splitBlock, RECOLOUR_PRESETS, type Rgba } from './pixels';
import { blockGuides, inside, presetsFor, propCanvas, wallSize } from './presets';

const ISO = { tileW: 64, tileH: 32, heightPx: 16 };

function fill(w: number, h: number, rgba: [number, number, number, number]): Rgba {
  const img = blankRgba(w, h);
  for (let i = 0; i < w * h; i++) img.data.set(rgba, i * 4);
  return img;
}

describe('presets', () => {
  it('make the right canvas for each kind of picture', () => {
    const presets = presetsFor(ISO);
    const flat = presets.find((p) => p.id === 'flat')!;
    expect([flat.width, flat.height]).toEqual([64, 32]);
    const block = presets.find((p) => p.id === 'block')!;
    expect([block.width, block.height]).toEqual([64, 48]);
    const wall = presets.find((p) => p.id === 'wall-left-1')!;
    expect([wall.width, wall.height]).toEqual([32, 32]);
    expect(wallSize(ISO, 2)).toEqual({ width: 32, height: 48 });
    const house = presets.find((p) => p.id === 'house-2x3')!;
    expect([house.width, house.height]).toEqual([160, 80 + 48]);
    expect(presets.find((p) => p.id === 'tree')!.meta.footprint).toEqual({ w: 2, d: 2 });
    expect(presets.find((p) => p.id === 'stairs')!.frames).toBe(4);
    expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length);
    // the feet of a prop are the middle of its footprint
    const c = propCanvas(ISO, 1, 1, 3);
    expect(c.origin).toEqual([32, 48 + 16]);
    expect(c.width).toBe(64);
  });

  it('knows what is inside a polygon', () => {
    const [top] = blockGuides(ISO, 1);
    expect(inside([32, 16], top!.points)).toBe(true);
    expect(inside([2, 2], top!.points)).toBe(false);
  });
});

describe('pictures', () => {
  it('a block is cut into its top, left and right faces', () => {
    const block = fill(64, 48, [200, 100, 50, 255]);
    const faces = splitBlock(block, ISO, 1);
    expect([faces.top.width, faces.top.height]).toEqual([64, 32]);
    expect([faces.left.width, faces.left.height]).toEqual([32, 32]);
    expect([faces.right.width, faces.right.height]).toEqual([32, 32]);
    // the corners of the diamond are see-through, the middle is not
    expect(faces.top.data[3]).toBe(0);
    expect(faces.top.data[(16 * 64 + 32) * 4 + 3]).toBe(255);
    expect(isEmpty(faces.left)).toBe(false);
    expect(isEmpty(faces.right)).toBe(false);
    expect(isEmpty(blankRgba(4, 4))).toBe(true);
  });

  it('turns a picture into a sprite and back', () => {
    const img = fill(8, 8, [10, 200, 30, 255]);
    const sprite = spriteFromRgba('g', img);
    expect(sprite.width).toBe(8);
    expect([...rgbaOf(sprite).data.slice(0, 4)]).toEqual([10, 200, 30, 255]);
    const anim = spriteFromFrames('a', [img, fill(8, 8, [0, 0, 255, 255])]);
    expect(anim.frames).toHaveLength(2);
    expect([...rgbaOf(anim, 1).data.slice(0, 4)]).toEqual([0, 0, 255, 255]);
  });

  it('mirrors, slices and packs', () => {
    const img = blankRgba(4, 1);
    img.data.set([255, 0, 0, 255], 0);
    expect([...mirror(img).data.slice(12, 16)]).toEqual([255, 0, 0, 255]);
    const sheet = blankRgba(8, 4);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) sheet.data.set([9, 9, 9, 255], (y * 8 + x) * 4); // only the left tile has anything in it
    const tiles = sliceSheet(sheet, { tileW: 4, tileH: 4, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0 });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0 });
    const packed = packSheet([tiles[0]!.img, tiles[0]!.img, tiles[0]!.img], 2);
    expect([packed.width, packed.height]).toEqual([8, 8]);
  });

  it('shades the three faces differently', () => {
    const block = fill(64, 48, [200, 200, 200, 255]);
    const shaded = shadeFaces(block, ISO, 1);
    const top = shaded.data[(16 * 64 + 32) * 4]!;
    const left = shaded.data[(28 * 64 + 10) * 4]!;
    const right = shaded.data[(28 * 64 + 54) * 4]!;
    expect(top).toBe(200);
    expect(left).toBeLessThan(top);
    expect(right).toBeLessThan(left);
  });
});

describe('recolouring', () => {
  it('turns a forest into snow: lighter and less colourful, and transparent stays transparent', () => {
    const pal = ['#00000000', '#2f6f4eff', '#6fae5bff'];
    const snow = recolourPalette(pal, RECOLOUR_PRESETS.snow!);
    expect(snow[0]).toBe('#00000000');
    const lum = (c: string): number => parseInt(c.slice(1, 3), 16) + parseInt(c.slice(3, 5), 16) + parseInt(c.slice(5, 7), 16);
    expect(lum(snow[2]!)).toBeGreaterThan(lum(pal[2]!));
    // exact swaps happen first
    expect(recolourPalette(pal, { hue: 0, saturation: 1, lightness: 1, swap: { '#2f6f4e': '#ff0000' } })[1]).toBe('#ff0000ff');
    const sprite = spriteFromRgba('forest', fill(4, 4, [47, 111, 78, 255]));
    const copy = recolourSprite(sprite, RECOLOUR_PRESETS.autumn!, 'forest_autumn');
    expect(copy.name).toBe('forest_autumn');
    expect(copy.palette[1]).not.toBe(sprite.palette[1]);
    expect(sprite.palette[1]).toBe('#2f6f4eff');
  });
});

describe('autotile edge sets', () => {
  it('there are 47 distinct pieces, each with a name, and the rules pick them by pattern', () => {
    const slots = blobSlots();
    expect(slots).toHaveLength(47);
    expect(new Set(slots.map((s) => s.id)).size).toBe(47);
    expect(slots.find((s) => s.id === 'centre')!.pattern).toBe('11111111');
    expect(slots.find((s) => s.id === 'edge-NESW')!.pattern).toBe('0*0*0*0*');
    expect(slots.find((s) => s.id === 'inner-NE')!.pattern).toBe('10111111');
    const rules = blobRules(3, 'grass', slots, (id) => 100 + slots.findIndex((s) => s.id === id));
    expect(rules).toHaveLength(46);
    expect(rules.every((r) => /^[01*]{8}$/.test(r.pattern) && r.base === 3)).toBe(true);
  });

  it('draws an edge only where the tile borders something else', () => {
    const base = fill(64, 32, [60, 160, 60, 255]);
    // clip to a diamond like a real floor tile
    for (let y = 0; y < 32; y++) for (let x = 0; x < 64; x++) if (Math.abs(x + 0.5 - 32) / 32 + Math.abs(y + 0.5 - 16) / 16 > 1) base.data[(y * 64 + x) * 4 + 3] = 0;
    const edged = drawEdges(base, ['N'], [], { colour: '#ffffff', width: 6, soften: 0.5 });
    // the upper right edge is whitened, the lower left stays green
    const upperRight = edged.data[(8 * 64 + 44) * 4]!;
    const lowerLeft = edged.data[(24 * 64 + 20) * 4]!;
    expect(upperRight).toBeGreaterThan(150);
    expect(lowerLeft).toBe(60);
    const none = drawEdges(base, [], [], { colour: '#ffffff', width: 6, soften: 0.5 });
    expect([...none.data]).toEqual([...base.data]);
  });
});
