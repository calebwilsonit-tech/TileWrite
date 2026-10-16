import { describe, expect, it } from 'vitest';
import { zlibSync } from 'fflate';
import { decodeRle, encodeRle } from './rle';
import {
  bounds,
  celFor,
  compositeFrame,
  copyRect,
  ellipsePoints,
  flipH,
  flipV,
  floodPoints,
  getPixel,
  linePoints,
  mirrored,
  newCel,
  pasteCel,
  rectPoints,
  rotate90,
  setPixel,
  shift,
} from './raster';
import { SPRITE_SCHEMA_VERSION, newSprite, parseSprite, stringifySprite, type ClipData, type SpriteData } from './format';
import { decodePng, encodePng, indexImage } from './png';
import { exportSheet, packRects } from './sheet';
import { crossedEvents, facingKey, framesForFacing, sampleClip } from './animation';
import { parseAseprite, AsepriteError } from './aseprite';

const S = { w: 8, h: 6 };

function drawn(): SpriteData {
  const s = newSprite('hero', 8, 6);
  const cel = newCel(8, 6);
  setPixel(cel, S, 1, 1, 3);
  setPixel(cel, S, 2, 1, 3);
  setPixel(cel, S, 1, 2, 8);
  s.frames[0]!.cels.l1 = encodeRle(cel);
  return s;
}

describe('RLE', () => {
  it('round-trips and compresses long runs', () => {
    const cel = new Uint8Array(1024);
    cel[500] = 7;
    const text = encodeRle(cel);
    expect(text).toBe('500x0 1x7 523x0');
    expect(decodeRle(text, 1024)).toEqual(cel);
  });

  it('decodes an empty string as an empty image', () => {
    expect(decodeRle('', 12)).toEqual(new Uint8Array(12));
  });

  it('explains damaged data', () => {
    expect(() => decodeRle('3xq', 3)).toThrow(/damaged/);
    expect(() => decodeRle('5x1', 3)).toThrow(/longer/);
    expect(() => decodeRle('2x1', 3)).toThrow(/shorter/);
    expect(() => decodeRle('3x300', 3)).toThrow(/out of range/);
  });
});

describe('raster tools', () => {
  it('draws gap-free lines', () => {
    const pts = linePoints({ x: 0, y: 0 }, { x: 7, y: 3 });
    expect(pts[0]).toEqual({ x: 0, y: 0 });
    expect(pts.at(-1)).toEqual({ x: 7, y: 3 });
    for (let i = 1; i < pts.length; i++) expect(Math.max(Math.abs(pts[i]!.x - pts[i - 1]!.x), Math.abs(pts[i]!.y - pts[i - 1]!.y))).toBe(1);
  });

  it('draws filled and outlined rectangles', () => {
    expect(rectPoints({ x: 1, y: 1 }, { x: 4, y: 3 }, true)).toHaveLength(12);
    expect(rectPoints({ x: 1, y: 1 }, { x: 4, y: 3 }, false)).toHaveLength(10);
  });

  it('draws ellipses (filled covers outline, outline is hollow)', () => {
    const filled = ellipsePoints({ x: 0, y: 0 }, { x: 8, y: 6 }, true);
    const outline = ellipsePoints({ x: 0, y: 0 }, { x: 8, y: 6 }, false);
    expect(outline.length).toBeLessThan(filled.length);
    expect(outline.every((p) => filled.some((q) => q.x === p.x && q.y === p.y))).toBe(true);
    expect(outline.some((p) => p.x === 4 && p.y === 3)).toBe(false); // centre is empty
  });

  it('flood fills only the connected same-colour area', () => {
    const cel = newCel(6, 3);
    for (let y = 0; y < 3; y++) setPixel(cel, { w: 6, h: 3 }, 3, y, 5); // wall
    const area = floodPoints(cel, { w: 6, h: 3 }, { x: 0, y: 0 });
    expect(area).toHaveLength(9);
    expect(floodPoints(cel, { w: 6, h: 3 }, { x: 99, y: 0 })).toEqual([]);
  });

  it('mirrors points for symmetry drawing', () => {
    expect(mirrored({ x: 1, y: 1 }, S, { x: true, y: false })).toEqual([{ x: 1, y: 1 }, { x: 6, y: 1 }]);
    expect(mirrored({ x: 1, y: 1 }, S, { x: true, y: true })).toHaveLength(4);
    expect(mirrored({ x: 1, y: 1 }, S, { x: false, y: false })).toHaveLength(1);
  });

  it('flips, rotates and shifts', () => {
    const cel = newCel(3, 2);
    setPixel(cel, { w: 3, h: 2 }, 0, 0, 9);
    expect(getPixel(flipH(cel, { w: 3, h: 2 }), { w: 3, h: 2 }, 2, 0)).toBe(9);
    expect(getPixel(flipV(cel, { w: 3, h: 2 }), { w: 3, h: 2 }, 0, 1)).toBe(9);
    const r = rotate90(cel, { w: 3, h: 2 });
    expect(r.size).toEqual({ w: 2, h: 3 });
    expect(getPixel(r.cel, r.size, 1, 0)).toBe(9); // top-left goes to top-right
    expect(getPixel(shift(cel, { w: 3, h: 2 }, 1, 1), { w: 3, h: 2 }, 1, 1)).toBe(9);
    expect(shift(cel, { w: 3, h: 2 }, -1, 0).every((v) => v === 0)).toBe(true); // pushed off the edge
  });

  it('copies, pastes and measures', () => {
    const cel = newCel(8, 6);
    setPixel(cel, S, 2, 2, 4);
    setPixel(cel, S, 3, 3, 4);
    expect(bounds(cel, S)).toEqual({ x: 2, y: 2, w: 2, h: 2 });
    expect(bounds(newCel(8, 6), S)).toBeNull();
    const piece = copyRect(cel, S, { x: 2, y: 2, w: 2, h: 2 });
    const dst = newCel(8, 6);
    pasteCel(dst, S, piece, { w: 2, h: 2 }, 5, 3);
    expect(getPixel(dst, S, 5, 3)).toBe(4);
    expect(getPixel(dst, S, 6, 4)).toBe(4);
    expect(getPixel(dst, S, 6, 3)).toBe(0); // transparent source pixel left the destination alone
  });

  it('clips drawing outside the canvas silently', () => {
    const cel = newCel(8, 6);
    setPixel(cel, S, -1, 0, 5);
    setPixel(cel, S, 8, 0, 5);
    expect(cel.every((v) => v === 0)).toBe(true);
  });
});

describe('compositing and the sprite file', () => {
  it('flattens layers bottom to top and respects visibility', () => {
    const s = drawn();
    s.layers.push({ id: 'l2', name: 'Top', visible: true });
    const top = newCel(8, 6);
    setPixel(top, S, 1, 1, 8); // blue over the red pixel
    s.frames[0]!.cels.l2 = encodeRle(top);
    const rgba = compositeFrame(s, 0);
    const at = (x: number, y: number) => [...rgba.slice((y * 8 + x) * 4, (y * 8 + x) * 4 + 4)];
    expect(at(1, 1)).toEqual([0x4a, 0x90, 0xd9, 255]); // blue wins
    expect(at(2, 1)).toEqual([0xe8, 0x55, 0x3d, 255]); // red
    expect(at(0, 0)).toEqual([0, 0, 0, 0]);
    s.layers[1]!.visible = false;
    expect(at(1, 1)).toEqual([0x4a, 0x90, 0xd9, 255]); // closure still reads the old buffer
    const hidden = compositeFrame(s, 0);
    expect([...hidden.slice((1 * 8 + 1) * 4, (1 * 8 + 1) * 4 + 4)]).toEqual([0xe8, 0x55, 0x3d, 255]);
  });

  it('tints and fades for onion skins', () => {
    const s = drawn();
    const rgba = compositeFrame(s, 0, { alpha: 0.5, tint: 0x00ff00 });
    const i = (1 * 8 + 1) * 4;
    expect([rgba[i], rgba[i + 1], rgba[i + 2]]).toEqual([0, 255, 0]);
    expect(rgba[i + 3]).toBeGreaterThanOrEqual(127);
    expect(rgba[i + 3]).toBeLessThanOrEqual(128);
  });

  it('treats a missing cel as empty', () => {
    const s = newSprite('x', 4, 4);
    expect(celFor(s, 0, 'l1').every((v) => v === 0)).toBe(true);
  });

  it('round-trips through JSON text with one frame per line', () => {
    const s = drawn();
    s.frames.push({ duration: 80, cels: {}, boxes: [{ kind: 'hit', x: 0, y: 0, w: 2, h: 2 }] });
    const text = stringifySprite(s);
    expect(text.split('\n').filter((l) => l.startsWith('    {"duration"'))).toHaveLength(2);
    const back = parseSprite(JSON.parse(text));
    expect(back.ok).toBe(true);
    if (back.ok) expect(back.value).toEqual(s);
  });

  it('reports problems in plain English', () => {
    const s = drawn();
    s.frames[0]!.cels.ghost = '48x0';
    const r = parseSprite(s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/layer that does not exist/);
    const dup = drawn();
    dup.layers.push({ id: 'l1', name: 'again', visible: true });
    expect(parseSprite(dup).ok).toBe(false);
    const clip = drawn();
    clip.clips = [{ name: 'walk', loop: true, mirror: false, all: [5], dirs: {}, events: [] }];
    const r2 = parseSprite(clip);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.error).toMatch(/frame that does not exist/);
    const pal = drawn();
    pal.palette[0] = '#ff0000ff';
    expect(parseSprite(pal).ok).toBe(false);
    expect(parseSprite({}).ok).toBe(false);
  });
});

describe('PNG', () => {
  it('round-trips RGBA exactly', () => {
    const w = 5;
    const h = 3;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < rgba.length; i++) rgba[i] = (i * 37) & 255;
    const back = decodePng(encodePng(w, h, rgba));
    expect(back.width).toBe(w);
    expect(back.height).toBe(h);
    expect([...back.rgba]).toEqual([...rgba]);
  });

  it('rejects things that are not PNGs', () => {
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9]))).toThrow(/not a PNG/);
  });

  it('decodes a palette PNG with transparency and filter types', () => {
    // 4x2 image, 2-bit palette: indices 0..3, with palette entry 0 transparent; use Sub and Up filters
    const w = 4;
    const h = 2;
    const row1 = [0b00011011]; // indices 0,1,2,3 packed 2 bits each
    const row2 = [0b11100100]; // 3,2,1,0
    const raw = new Uint8Array([0, ...row1, 2 /* Up */, (row2[0]! - row1[0]!) & 255]);
    const idat = zlibSync(raw);
    const ihdr = new Uint8Array(13);
    new DataView(ihdr.buffer).setUint32(0, w);
    new DataView(ihdr.buffer).setUint32(4, h);
    ihdr[8] = 2;
    ihdr[9] = 3;
    const plte = new Uint8Array([10, 20, 30, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    const trns = new Uint8Array([0]);
    const build = (type: string, data: Uint8Array): number[] => {
      const out = [0, 0, 0, 0, ...[...type].map((c) => c.charCodeAt(0)), ...data, 0, 0, 0, 0];
      new DataView(new Uint8Array(out).buffer);
      const len = data.length;
      out[0] = (len >>> 24) & 255;
      out[1] = (len >>> 16) & 255;
      out[2] = (len >>> 8) & 255;
      out[3] = len & 255;
      return out; // CRC left as zeros: the decoder does not verify it
    };
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, ...build('IHDR', ihdr), ...build('PLTE', plte), ...build('tRNS', trns), ...build('IDAT', idat), ...build('IEND', new Uint8Array(0))]);
    const img = decodePng(bytes);
    expect([img.width, img.height]).toEqual([4, 2]);
    expect([...img.rgba.slice(0, 4)]).toEqual([10, 20, 30, 0]); // index 0, transparent
    expect([...img.rgba.slice(4, 8)]).toEqual([255, 0, 0, 255]); // index 1
    expect([...img.rgba.slice(16, 20)]).toEqual([0, 0, 255, 255]); // second row starts with index 3
  });

  it('indexes colours: reuse, add, and approximate when the palette is full', () => {
    const rgba = new Uint8ClampedArray([
      232, 85, 61, 255, // existing red
      1, 2, 3, 255, // new colour
      0, 0, 0, 0, // transparent
      4, 5, 6, 255, // another new colour
    ]);
    const r = indexImage(rgba, ['#00000000', '#e8553dff'], 256);
    expect([...r.indices]).toEqual([1, 2, 0, 3]);
    expect(r.added).toBe(2);
    expect(r.palette).toHaveLength(4);
    const full = indexImage(rgba, ['#00000000', '#e8553dff'], 2);
    expect(full.added).toBe(0);
    expect(full.approximated).toBe(2);
    expect([...full.indices]).toEqual([1, 1, 0, 1]);
  });
});

describe('sprite sheets', () => {
  it('packs rectangles without overlap, inside the sheet', () => {
    const sizes = Array.from({ length: 23 }, (_, i) => ({ w: 5 + (i % 7), h: 4 + (i % 5) * 3 }));
    const { positions, width, height } = packRects(sizes, 64, 1, true);
    expect(positions).toHaveLength(23);
    expect((width & (width - 1)) === 0 && (height & (height - 1)) === 0).toBe(true);
    for (let i = 0; i < sizes.length; i++) {
      const a = { ...positions[i]!, ...sizes[i]! };
      expect(a.x).toBeGreaterThanOrEqual(1);
      expect(a.x + a.w).toBeLessThanOrEqual(width);
      expect(a.y + a.h).toBeLessThanOrEqual(height);
      for (let j = i + 1; j < sizes.length; j++) {
        const b = { ...positions[j]!, ...sizes[j]! };
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `rects ${i} and ${j}`).toBe(false);
      }
    }
  });

  it('grows past maxWidth when one frame is wider than it', () => {
    const { width } = packRects([{ w: 100, h: 10 }], 32, 0, false);
    expect(width).toBe(100);
  });

  it('exports a trimmed sheet whose atlas points at the right pixels', () => {
    const s = drawn();
    s.frames.push({ duration: 200, cels: { l1: encodeRle(Uint8Array.from({ length: 48 }, (_, i) => (i === 5 * 8 + 6 ? 6 : 0))) }, boxes: [] });
    const sheet = exportSheet(s, { powerOfTwo: false, padding: 1 });
    expect(sheet.atlas.frames).toHaveLength(2);
    const f0 = sheet.atlas.frames[0]!;
    expect([f0.w, f0.h, f0.trimX, f0.trimY]).toEqual([2, 2, 1, 1]);
    // the red pixel at frame (1,1) sits at the atlas rect's top-left
    const at = (x: number, y: number) => [...sheet.rgba.slice((y * sheet.width + x) * 4, (y * sheet.width + x) * 4 + 4)];
    expect(at(f0.x, f0.y)).toEqual([0xe8, 0x55, 0x3d, 255]);
    const f1 = sheet.atlas.frames[1]!;
    expect([f1.w, f1.h, f1.trimX, f1.trimY, f1.duration]).toEqual([1, 1, 6, 5, 200]);
    expect(at(f1.x, f1.y)).toEqual([0x6f, 0xae, 0x5b, 255]);
    const png = decodePng(sheet.png);
    expect([png.width, png.height]).toEqual([sheet.width, sheet.height]);
    expect([...png.rgba]).toEqual([...sheet.rgba]);
    const untrimmed = exportSheet(s, { trim: false, powerOfTwo: false });
    expect(untrimmed.atlas.frames[0]).toMatchObject({ w: 8, h: 6, trimX: 0, trimY: 0 });
  });
});

describe('clips and facings', () => {
  const clip = (partial: Partial<ClipData>): ClipData => ({ name: 'walk', loop: true, mirror: false, all: [], dirs: {}, events: [], ...partial });
  const sprite = (): SpriteData => {
    const s = newSprite('x', 4, 4);
    s.frames = [10, 20, 30, 40].map((duration) => ({ duration, cels: {}, boxes: [] }));
    return s;
  };

  it('names the eight facings clockwise from East', () => {
    expect([0, 1, 2, 3, 4, 5, 6, 7].map(facingKey)).toEqual(['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE']);
    expect(facingKey(8)).toBe('E');
    expect(facingKey(-1)).toBe('NE');
  });

  it('prefers a drawn direction, then the mirrored side, then the all-direction frames', () => {
    const c = clip({ mirror: true, all: [3], dirs: { E: [0, 1], SE: [2] } });
    expect(framesForFacing(c, 0)).toEqual({ frames: [0, 1], flip: false }); // E drawn
    expect(framesForFacing(c, 4)).toEqual({ frames: [0, 1], flip: true }); // W mirrors E
    expect(framesForFacing(c, 3)).toEqual({ frames: [2], flip: true }); // SW mirrors SE
    expect(framesForFacing(c, 2)).toEqual({ frames: [3], flip: false }); // S has no partner -> all
    const noMirror = clip({ all: [3], dirs: { E: [0] } });
    expect(framesForFacing(noMirror, 4)).toEqual({ frames: [3], flip: false });
  });

  it('still shows something for a half-finished clip', () => {
    expect(framesForFacing(clip({}), 2)).toEqual({ frames: [0], flip: false });
    expect(framesForFacing(clip({ dirs: { N: [2] } }), 2)).toEqual({ frames: [2], flip: false });
  });

  it('plays frames for their durations and loops', () => {
    const s = sprite();
    const c = clip({ all: [0, 1, 2] }); // 10 + 20 + 30 = 60 ms
    expect(sampleClip(s, c, 0, 0).frame).toBe(0);
    expect(sampleClip(s, c, 0, 9).frame).toBe(0);
    expect(sampleClip(s, c, 0, 10).frame).toBe(1);
    expect(sampleClip(s, c, 0, 30).frame).toBe(2);
    expect(sampleClip(s, c, 0, 60).frame).toBe(0); // looped
    expect(sampleClip(s, c, 0, 70).frame).toBe(1);
  });

  it('stops on the last frame when not looping and reports done', () => {
    const s = sprite();
    const c = clip({ loop: false, all: [0, 1, 2] });
    expect(sampleClip(s, c, 0, 59)).toMatchObject({ frame: 2, done: false });
    expect(sampleClip(s, c, 0, 500)).toMatchObject({ frame: 2, done: true });
  });

  it('finds the events a step passes over, including across a loop', () => {
    const c = clip({ all: [0, 1, 2], events: [{ at: 1, name: 'step' }, { at: 2, name: 'thud' }] });
    expect(crossedEvents(c, 0, 1, false)).toEqual(['step']);
    expect(crossedEvents(c, 0, 2, false)).toEqual(['step', 'thud']);
    expect(crossedEvents(c, 1, 2, false)).toEqual(['thud']);
    expect(crossedEvents(c, 2, 0, true)).toEqual([]);
    expect(crossedEvents(c, 2, 1, true)).toEqual(['step']);
  });
});

describe('Aseprite import', () => {
  const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
  const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  const str = (s: string): number[] => [...u16(s.length), ...[...s].map((c) => c.charCodeAt(0))];
  const chunk = (type: number, body: number[]): number[] => [...u32(6 + body.length), ...u16(type), ...body];

  function ase(): Uint8Array {
    const w = 4;
    const h = 2;
    const layer = chunk(0x2004, [...u16(1), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u16(0), 255, 0, 0, 0, ...str('Body')]);
    const tags = chunk(0x2018, [...u16(1), 0, 0, 0, 0, 0, 0, 0, 0, ...u16(0), ...u16(1), 0, ...u16(0), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...str('walk')]);
    const celPixels = (colors: number[][]): number[] => colors.flatMap((c) => c); // RGBA
    const cel = (x: number, y: number, cw: number, ch: number, rgba: number[]): number[] =>
      chunk(0x2005, [...u16(0), ...u16(x), ...u16(y), 255, ...u16(2), ...u16(0), 0, 0, 0, 0, 0, ...u16(cw), ...u16(ch), ...zlibSync(new Uint8Array(rgba))]);
    const red = [255, 0, 0, 255];
    const blue = [0, 0, 255, 255];
    const none = [0, 0, 0, 0];
    const f1 = [...layer, ...tags, ...cel(1, 0, 2, 1, celPixels([red, red]))];
    const f2 = cel(0, 1, 2, 1, celPixels([blue, none]));
    const frame = (chunks: number[], count: number, ms: number): number[] => [...u32(16 + chunks.length), ...u16(0xf1fa), ...u16(count), ...u16(ms), 0, 0, 0, 0, 0, 0, ...chunks];
    const frames = [...frame(f1, 3, 90), ...frame(f2, 1, 140)];
    const header = new Array(128).fill(0);
    header.splice(0, 4, ...u32(128 + frames.length));
    header.splice(4, 2, ...u16(0xa5e0));
    header.splice(6, 2, ...u16(2));
    header.splice(8, 2, ...u16(w));
    header.splice(10, 2, ...u16(h));
    header.splice(12, 2, ...u16(32));
    return new Uint8Array([...header, ...frames]);
  }

  it('imports layers, frames, durations, colours and tags', () => {
    const s = parseAseprite(ase(), 'dude');
    expect(s.name).toBe('dude');
    expect([s.width, s.height]).toEqual([4, 2]);
    expect(s.layers).toEqual([{ id: 'l1', name: 'Body', visible: true }]);
    expect(s.frames.map((f) => f.duration)).toEqual([90, 140]);
    expect(s.palette).toEqual(['#00000000', '#ff0000ff', '#0000ffff']);
    expect([...celFor(s, 0, 'l1')]).toEqual([0, 1, 1, 0, 0, 0, 0, 0]);
    expect([...celFor(s, 1, 'l1')]).toEqual([0, 0, 0, 0, 2, 0, 0, 0]);
    expect(s.clips).toEqual([{ name: 'walk', loop: true, mirror: false, all: [0, 1], dirs: {}, events: [] }]);
    expect(parseSprite(JSON.parse(JSON.stringify(s))).ok).toBe(true);
  });

  it('refuses files that are not Aseprite files, in plain English', () => {
    expect(() => parseAseprite(new Uint8Array(200), 'x')).toThrow(AsepriteError);
    expect(() => parseAseprite(new Uint8Array(10), 'x')).toThrow(/not an Aseprite/);
  });
});

describe('format basics', () => {
  it('creates a valid new sprite', () => {
    const s = newSprite('hero', 32, 32);
    expect(s.schemaVersion).toBe(SPRITE_SCHEMA_VERSION);
    expect(s.palette[0]).toBe('#00000000');
    expect(parseSprite(s).ok).toBe(true);
  });
});
