import { zlibSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from '@tilewright/runtime';
import { PictureProblem, colourFacts, decodeBmp, decodePsd, downscale, pictureForClaude, pictureFormat, pictureHead, type Raster } from './pictures';

const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const be16 = (n: number): number[] => [(n >> 8) & 255, n & 255];
const be32 = (n: number): number[] => [(n >>> 24) & 255, (n >> 16) & 255, (n >> 8) & 255, n & 255];
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** A BMP of the given colours, rows given top to bottom, written bottom-up the way the format does it. */
function bmp24(rows: number[][][]): Uint8Array {
  const h = rows.length;
  const w = rows[0]!.length;
  const rowBytes = Math.ceil((w * 3) / 4) * 4;
  const data: number[] = [];
  for (let y = h - 1; y >= 0; y--) {
    const row: number[] = [];
    for (const [r, g, b] of rows[y]!) row.push(b!, g!, r!);
    while (row.length < rowBytes) row.push(0);
    data.push(...row);
  }
  const head = [...text('BM'), ...u32(54 + data.length), 0, 0, 0, 0, ...u32(54), ...u32(40), ...u32(w), ...u32(h), ...u16(1), ...u16(24), ...u32(0), ...u32(data.length), ...u32(2835), ...u32(2835), ...u32(0), ...u32(0)];
  return new Uint8Array([...head, ...data]);
}

function bmp8(width: number, height: number, palette: number[][], indices: number[][]): Uint8Array {
  const rowBytes = Math.ceil(width / 4) * 4;
  const data: number[] = [];
  for (let y = height - 1; y >= 0; y--) {
    const row = [...indices[y]!];
    while (row.length < rowBytes) row.push(0);
    data.push(...row);
  }
  const pal = palette.flatMap(([r, g, b]) => [b!, g!, r!, 0]);
  const head = [...text('BM'), ...u32(54 + pal.length + data.length), 0, 0, 0, 0, ...u32(54 + pal.length), ...u32(40), ...u32(width), ...u32(height), ...u16(1), ...u16(8), ...u32(0), ...u32(data.length), ...u32(0), ...u32(0), ...u32(palette.length), ...u32(0)];
  return new Uint8Array([...head, ...pal, ...data]);
}

/** A PSD with a 2-channel-less RGB merged image, raw or PackBits. */
function psd(width: number, height: number, planes: number[][], compression: 0 | 1, depth = 8): Uint8Array {
  const head = [...text('8BPS'), ...be16(1), 0, 0, 0, 0, 0, 0, ...be16(planes.length), ...be32(height), ...be32(width), ...be16(depth), ...be16(3), ...be32(0), ...be32(0), ...be32(0)];
  if (compression === 0) return new Uint8Array([...head, ...be16(0), ...planes.flat()]);
  // every row as one literal run
  const table: number[] = [];
  const rows: number[] = [];
  for (const plane of planes) {
    for (let y = 0; y < height; y++) {
      const row = plane.slice(y * width, (y + 1) * width);
      const coded = [row.length - 1, ...row];
      table.push(...be16(coded.length));
      rows.push(...coded);
    }
  }
  return new Uint8Array([...head, ...be16(1), ...table, ...rows]);
}

function solid(width: number, height: number, rgba: [number, number, number, number]): Raster {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set(rgba, i * 4);
  return { width, height, rgba: data };
}

describe('what a picture file is', () => {
  it('is told by its first bytes, whatever the name says', () => {
    expect(pictureFormat('a.png', encodePng(1, 1, new Uint8Array(4)))).toBe('png');
    expect(pictureFormat('a.png', new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0]))).toBe('jpeg');
    expect(pictureFormat('a.bin', bmp24([[[1, 2, 3]]]))).toBe('bmp');
    expect(pictureFormat('a.psd', psd(1, 1, [[1], [2], [3]], 0))).toBe('psd');
    expect(pictureFormat('a.svg', new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"/>'))).toBe('svg');
    expect(pictureFormat('a.png', new TextEncoder().encode('{"not":"a picture"}'))).toBeNull();
  });

  it('gives the size of a JPEG, a GIF with its frames, a WebP and an SVG from the header alone', () => {
    // SOI, APP0 (short), SOF0 with height 300 and width 500
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, ...be16(300), ...be16(500), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    expect(pictureHead('jpeg', jpeg)).toEqual({ width: 500, height: 300, frames: 1 });
    // two frames: logical screen 6 x 4, no colour table, two image descriptors separated by a graphic control extension
    const frame = [0x2c, 0, 0, 0, 0, 6, 0, 4, 0, 0, 2, 2, 0x4c, 0x01, 0];
    const gif = new Uint8Array([...text('GIF89a'), ...u16(6), ...u16(4), 0, 0, 0, ...frame, 0x21, 0xf9, 4, 0, 0, 0, 0, 0, ...frame, 0x3b]);
    expect(pictureHead('gif', gif)).toEqual({ width: 6, height: 4, frames: 2 });
    const svg = new TextEncoder().encode('<svg viewBox="0 0 48 32" xmlns="http://www.w3.org/2000/svg"></svg>');
    expect(pictureHead('svg', svg)).toEqual({ width: 48, height: 32, frames: 1 });
    expect(pictureHead('svg', new TextEncoder().encode('<svg width="20px" height="10"/>'))).toEqual({ width: 20, height: 10, frames: 1 });
    // VP8X, 100 x 50, not animated
    const webp = new Uint8Array([...text('RIFF'), ...u32(22), ...text('WEBP'), ...text('VP8X'), ...u32(10), 0, 0, 0, 0, ...[99, 0, 0], ...[49, 0, 0]]);
    expect(pictureHead('webp', webp)).toEqual({ width: 100, height: 50, frames: 1 });
  });
});

describe('BMP and PSD', () => {
  it('reads a 24-bit BMP, whichever way up its rows are stored', () => {
    const r = decodeBmp(bmp24([[[255, 0, 0], [0, 255, 0]], [[0, 0, 255], [10, 20, 30]]]));
    expect([r.width, r.height]).toEqual([2, 2]);
    expect([...r.rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);
  });

  it('reads an 8-bit BMP with a palette', () => {
    const r = decodeBmp(bmp8(3, 1, [[0, 0, 0], [200, 100, 50]], [[0, 1, 1]]));
    expect([...r.rgba]).toEqual([0, 0, 0, 255, 200, 100, 50, 255, 200, 100, 50, 255]);
  });

  it('says in plain words when a BMP cannot be read', () => {
    expect(() => decodeBmp(new Uint8Array(10))).toThrow(PictureProblem);
    const rle = bmp24([[[1, 2, 3]]]);
    rle[30] = 1; // compression: RLE8
    expect(() => decodeBmp(rle)).toThrow(/compressed/);
  });

  it('reads the flattened picture of a PSD, raw or run-length coded', () => {
    const planes = [[255, 0, 0, 9], [0, 255, 0, 8], [0, 0, 255, 7]]; // R, G, B of a 2 x 2 picture
    for (const compression of [0, 1] as const) {
      const r = decodePsd(psd(2, 2, planes, compression));
      expect([r.width, r.height]).toEqual([2, 2]);
      expect([...r.rgba]).toEqual([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 9, 8, 7, 255]);
    }
    const withAlpha = decodePsd(psd(1, 1, [[10], [20], [30], [128]], 0));
    expect([...withAlpha.rgba]).toEqual([10, 20, 30, 128]);
    expect(() => decodePsd(psd(1, 1, [[1], [2], [3]], 0, 32))).toThrow(/32 bits/);
  });
});

describe('looking at a picture', () => {
  it('passes a PNG that is small enough on as it is, with its size and colours', async () => {
    const png = encodePng(2, 2, new Uint8Array([255, 0, 0, 255, 255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0]));
    const p = await pictureForClaude('art/a.png', png);
    expect(p.mediaType).toBe('image/png');
    expect(p.data).toBe(png);
    expect(p.facts).toContain('PNG picture, 2 x 2 pixels');
    expect(p.facts).toContain('2 different colours');
    expect(p.facts).toContain('25% fully transparent');
    expect(p.facts).toContain('#ff0000 67%');
  });

  it('makes a big picture smaller instead of refusing it, and says so', async () => {
    const big = solid(3200, 1000, [10, 120, 200, 255]);
    for (let x = 0; x < 3200; x++) big.rgba.set([x % 256, 0, 0, 255], x * 4); // a stripe along the top row
    const p = await pictureForClaude('art/big.png', encodePng(big.width, big.height, big.rgba));
    expect(p.mediaType).toBe('image/png');
    const shown = decodePng(p.data);
    expect(shown.width).toBe(1568);
    expect(shown.height).toBe(490);
    expect(p.facts).toContain('3200 x 1000 pixels');
    expect(p.facts).toContain('reduced to 1568 x 490');
  });

  it('keeps shrinking until the file is under the byte limit', async () => {
    // noise does not compress, so a small limit forces a few rounds
    const noise = solid(400, 400, [0, 0, 0, 255]);
    let seed = 7;
    for (let i = 0; i < 400 * 400 * 4; i++) {
      if (i % 4 === 3) continue;
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      noise.rgba[i] = (seed >> 16) & 255;
    }
    const png = encodePng(400, 400, noise.rgba);
    const p = await pictureForClaude('n.png', png, undefined, { maxSide: 1568, maxBytes: 60_000 });
    expect(p.data.length).toBeLessThanOrEqual(60_000);
    expect(decodePng(p.data).width).toBeLessThan(400);
  });

  it('turns a BMP, a PSD and an Aseprite file into PNG, and says which they were', async () => {
    const b = await pictureForClaude('a.bmp', bmp24([[[255, 0, 0], [0, 0, 255]]]));
    expect(b.mediaType).toBe('image/png');
    expect(b.facts).toContain('BMP picture, 2 x 1 pixels');
    expect(b.facts).toContain('converted to PNG');
    const enlarged = decodePng(b.data);
    expect(enlarged.width).toBe(16); // tiny pixel art is shown enlarged (a whole number of times, at most 8) so the pixels can be seen
    const ps = await pictureForClaude('a.psd', psd(1, 1, [[1], [2], [3]], 0));
    expect(ps.facts).toContain('flattened picture');
  });

  it('shows every frame of an Aseprite file side by side, with its layers and animations', async () => {
    const chunk = (type: number, body: number[]): number[] => [...u32(6 + body.length), ...u16(type), ...body];
    const str = (s: string): number[] => [...u16(s.length), ...text(s)];
    const layer = chunk(0x2004, [...u16(1), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), 255, 0, 0, 0, ...str('Body')]);
    const tags = chunk(0x2018, [...u16(1), 0, 0, 0, 0, 0, 0, 0, 0, ...u16(0), ...u16(1), 0, ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...str('walk')]);
    const cel = (rgba: number[]): number[] => chunk(0x2005, [...u16(0), ...u16(0), ...u16(0), 255, ...u16(2), ...u16(0), 0, 0, 0, 0, 0, ...u16(2), ...u16(1), ...zlibSync(new Uint8Array(rgba))]);
    const frame = (chunks: number[], count: number): number[] => [...u32(16 + chunks.length), ...u16(0xf1fa), ...u16(count), ...u16(100), 0, 0, 0, 0, 0, 0, ...chunks];
    const frames = [...frame([...layer, ...tags, ...cel([255, 0, 0, 255, 0, 255, 0, 255])], 3), ...frame(cel([0, 0, 255, 255, 255, 255, 0, 255]), 1)];
    const header = new Array<number>(128).fill(0);
    header.splice(0, 4, ...u32(128 + frames.length));
    header.splice(4, 2, ...u16(0xa5e0));
    header.splice(6, 2, ...u16(2));
    header.splice(8, 2, ...u16(2));
    header.splice(10, 2, ...u16(1));
    header.splice(12, 2, ...u16(32));
    const p = await pictureForClaude('hero.aseprite', new Uint8Array([...header, ...frames]));
    expect(p.mediaType).toBe('image/png');
    expect(p.facts).toContain('Aseprite picture, 2 x 1 pixels, 2 frames');
    expect(p.facts).toContain('1 layer (Body), animations: walk');
    expect(p.facts).toContain('side by side');
    const sheet = decodePng(p.data);
    expect(sheet.width / sheet.height).toBeGreaterThan(3); // two frames of 2 x 1 and a gap, enlarged
  });

  it('hands JPEG, GIF, WebP and SVG to the window to decode, and refuses what cannot be shrunk without it', async () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 17, 8, ...be16(2), ...be16(2), 3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1]);
    const rasterize = async (): Promise<Raster> => solid(2, 2, [1, 2, 3, 255]);
    const small = await pictureForClaude('photo.jpg', jpeg, rasterize);
    expect(small.mediaType).toBe('image/jpeg');
    expect(small.data).toBe(jpeg);
    expect(small.facts).toContain('JPEG picture, 2 x 2 pixels');
    expect(small.facts).toContain('1 different colour');

    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="red"/></svg>');
    const drawn = await pictureForClaude('icon.svg', svg, async () => solid(8, 8, [255, 0, 0, 255]));
    expect(drawn.mediaType).toBe('image/png');
    expect(drawn.facts).toContain('SVG picture, 8 x 8 pixels');
    expect(drawn.facts).toContain('also text');
    await expect(pictureForClaude('icon.svg', svg)).rejects.toThrow(PictureProblem);

    const huge = new Uint8Array([...jpeg, ...new Array(10).fill(0)]);
    await expect(pictureForClaude('big.jpg', huge, undefined, { maxSide: 1568, maxBytes: 8 })).rejects.toThrow(/too big/);
  });

  it('says plainly when a file named like a picture is not one', async () => {
    await expect(pictureForClaude('x.png', new TextEncoder().encode('hello'))).rejects.toThrow(/not a picture file/);
  });
});

describe('colours', () => {
  it('says how many there are, and calls a photograph a photograph', () => {
    expect(colourFacts(solid(4, 4, [0, 0, 0, 255]))).toBe('1 different colour. Used most: #000000 100%.');
    const photo = solid(100, 100, [0, 0, 0, 255]);
    for (let i = 0; i < 10000; i++) photo.rgba.set([i & 255, (i >> 8) & 255, (i * 7) & 255, 255], i * 4);
    expect(colourFacts(photo)).toContain('photograph');
  });

  it('shrinks by averaging, and never makes a picture bigger', () => {
    const r = solid(8, 4, [100, 100, 100, 255]);
    expect(downscale(r, 100)).toBe(r);
    const small = downscale(r, 4);
    expect([small.width, small.height]).toEqual([4, 2]);
    expect([...small.rgba.subarray(0, 4)]).toEqual([100, 100, 100, 255]);
  });
});
