import { describe, expect, it } from 'vitest';
import { celFor, compositeFrame, parseSprite, stringifySprite } from '@tilewright/runtime';
import { DrawProblem, buildSprite, fitSvgTo, snapToPalette } from './drawing';
import type { Raster } from './pictures';

const idx = (s: ReturnType<typeof buildSprite>['sprite'], layer: string, x: number, y: number): number => celFor(s, 0, layer)[y * s.width + x]!;

describe('drawing with rows (as it always was)', () => {
  it('makes a sprite with one layer called Pixels, and the colours it did not use are reported', () => {
    const { sprite, notes } = buildSprite({ name: 'gem', width: 4, height: 4, palette: ['#ff2244', '#ffffff', '#00ff00'], rows: ['.11.', '1221', '1221', '.11.'] });
    expect(sprite.layers.map((l) => l.name)).toEqual(['Pixels']);
    expect(sprite.palette).toEqual(['#00000000', '#ff2244ff', '#ffffffff', '#00ff00ff']);
    expect(idx(sprite, 'l1', 1, 1)).toBe(2);
    expect(idx(sprite, 'l1', 0, 0)).toBe(0);
    expect(notes).toEqual(['1 colour in the palette is not used.']);
    expect(parseSprite(JSON.parse(stringifySprite(sprite))).ok).toBe(true);
  });

  it('makes an animation from more frames', () => {
    const { sprite } = buildSprite({ name: 'blink', width: 2, height: 1, palette: ['#ffffff'], rows: ['1.'], moreFrames: [['.1']], frameMs: 90 });
    expect(sprite.frames).toHaveLength(2);
    expect(sprite.frames[0]!.duration).toBe(90);
    expect(sprite.clips[0]).toMatchObject({ name: 'idle', all: [0, 1] });
    expect(celFor(sprite, 1, 'l1')[1]).toBe(1);
  });

  it('says which row and column is wrong, in words', () => {
    const spec = { name: 'x', width: 4, height: 2, palette: ['#ffffff'] };
    expect(() => buildSprite({ ...spec, rows: ['.11.', '1'] })).toThrow(/row 2 is 1 characters long/);
    expect(() => buildSprite({ ...spec, rows: ['.11.'] })).toThrow(/has 1 rows but the picture is 2 high/);
    expect(() => buildSprite({ ...spec, rows: ['.11.', '.1q.'] })).toThrow(/row 2, column 3: "q" is not/);
    expect(() => buildSprite({ ...spec })).toThrow(/Give the drawing/);
  });
});

describe('drawing with layers, shapes and fills', () => {
  const palette = ['#202020', '#c04040', '#f0d060'];

  it('puts shapes on a layer of their own that stays editable, and draws them into its pixels', () => {
    const { sprite } = buildSprite({
      name: 'badge',
      width: 16,
      height: 16,
      palette,
      layers: [
        { name: 'Disc', shapes: [{ type: 'ellipse', cx: 8, cy: 8, rx: 7, ry: 7, fill: 1, stroke: 2, strokeWidth: 1 }] },
        { name: 'Bar', shapes: [{ type: 'rect', x: 4, y: 7, w: 8, h: 2, fill: 3 }] },
      ],
    });
    expect(sprite.layers).toEqual([{ id: 'l1', name: 'Disc', visible: true, kind: 'vector' }, { id: 'l2', name: 'Bar', visible: true, kind: 'vector' }]);
    expect(sprite.frames[0]!.vectors!['l1']).toHaveLength(1);
    expect(idx(sprite, 'l1', 8, 8)).toBe(1); // inside the disc
    expect(idx(sprite, 'l2', 8, 7)).toBe(3); // in the bar
    expect(idx(sprite, 'l2', 1, 1)).toBe(0);
    // the layers flatten with the bar on top
    const flat = compositeFrame(sprite, 0);
    expect([...flat.subarray((7 * 16 + 8) * 4, (7 * 16 + 8) * 4 + 3)]).toEqual([0xf0, 0xd0, 0x60]);
  });

  it('fills the area around a pixel, up to the lines that bound it', () => {
    const rows = ['11111', '1...1', '1...1', '1...1', '11111'];
    const { sprite } = buildSprite({ name: 'box', width: 5, height: 5, palette: ['#000000', '#ff0000'], layers: [{ name: 'Lines', rows, fills: [{ x: 2, y: 2, color: 2 }] }] });
    expect(idx(sprite, 'l1', 2, 2)).toBe(2);
    expect(idx(sprite, 'l1', 1, 3)).toBe(2);
    expect(idx(sprite, 'l1', 0, 0)).toBe(1); // the lines stay
  });

  it('keeps rows as the layer underneath the layers', () => {
    const { sprite } = buildSprite({ name: 'mix', width: 2, height: 1, palette: ['#ff0000', '#00ff00'], rows: ['1.'], layers: [{ name: 'Top', rows: ['.2'] }] });
    expect(sprite.layers.map((l) => l.name)).toEqual(['Pixels', 'Top']);
  });

  it('refuses a mistake with the layer and shape it is in', () => {
    const base = { name: 'x', width: 8, height: 8, palette };
    expect(() => buildSprite({ ...base, layers: [{ name: 'Both', rows: new Array<string>(8).fill('........'), shapes: [] }] })).toThrow(/rows and shapes/);
    expect(() => buildSprite({ ...base, layers: [{ name: 'Empty' }] })).toThrow(/is empty/);
    expect(() => buildSprite({ ...base, layers: [{ name: 'S', shapes: [{ type: 'rect', x: 0, y: 0, w: -3, h: 2, fill: 1 }] }] })).toThrow(/Layer "S", shape 1 \(rect\) is not valid/);
    expect(() => buildSprite({ ...base, layers: [{ name: 'S', shapes: [{ type: 'rect', x: 0, y: 0, w: 3, h: 2, fill: 9 }] }] })).toThrow(/colour that is not in the palette/);
    expect(() => buildSprite({ ...base, layers: [{ name: 'F', rows: new Array<string>(8).fill('........'), fills: [{ x: 20, y: 0, color: 1 }] }] })).toThrow(/outside the 8 x 8 picture/);
    expect(() => buildSprite({ ...base, moreFrames: [['.']], layers: [{ name: 'F', fills: [] }] })).toThrow(DrawProblem);
  });
});

describe('drawing with an SVG', () => {
  const raster = (w: number, h: number, c: [number, number, number, number]): Raster => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) rgba.set(c, i * 4);
    rgba.set([0, 0, 0, 0], 0); // the first pixel is clear
    return { width: w, height: h, rgba };
  };

  it('snaps the drawing to the palette it was given', () => {
    const { sprite } = buildSprite({ name: 'logo', width: 2, height: 2, palette: ['#ff0000', '#0000ff'], layers: [{ name: 'Art', svg: '<svg/>' }] }, new Map([[0, raster(2, 2, [240, 20, 30, 255])]]));
    expect(idx(sprite, 'l1', 1, 0)).toBe(1); // red, the nearest
    expect(idx(sprite, 'l1', 0, 0)).toBe(0); // clear
  });

  it('makes a palette from the drawing when none is given', () => {
    const { sprite } = buildSprite({ name: 'logo', width: 2, height: 2, layers: [{ name: 'Art', svg: '<svg/>' }] }, new Map([[0, raster(2, 2, [10, 200, 30, 255])]]));
    expect(sprite.palette).toEqual(['#00000000', '#0ac81eff']);
  });

  it('says so when the drawing could not be made', () => {
    expect(() => buildSprite({ name: 'logo', width: 2, height: 2, palette: ['#ffffff'], layers: [{ name: 'Art', svg: '<svg/>' }] })).toThrow(/could not be drawn/);
  });

  it('makes an SVG draw at the size of the picture, scaling what it had', () => {
    expect(fitSvgTo('<svg width="32" height="16"><rect/></svg>', 64, 32)).toBe('<svg width="64" height="32" viewBox="0 0 32 16" xmlns="http://www.w3.org/2000/svg"><rect/></svg>');
    expect(fitSvgTo('<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg" width="5"></svg>', 20, 20)).toBe('<svg width="20" height="20" viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(() => fitSvgTo('<p>not an svg</p>', 4, 4)).toThrow(/no <svg> element/);
  });

  it('keeps pixels that are mostly clear clear', () => {
    const r: Raster = { width: 2, height: 1, rgba: new Uint8ClampedArray([255, 0, 0, 40, 255, 0, 0, 255]) };
    expect([...snapToPalette(r, ['#00000000', '#ff0000ff'])]).toEqual([0, 1]);
  });
});
