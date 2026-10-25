import { compositeFrame, decodePng, encodePng, parseAseprite, type SpriteData } from '@tilewright/runtime';

/**
 * Pictures for Claude. The API takes PNG, JPEG, GIF and WebP, no more than a size, so everything else is turned into PNG here
 * (BMP, PSD, Aseprite files and SVG), and a picture that is too big is made smaller instead of refused. What comes back is the
 * picture to show and a few lines about it (size, frames, the colours in it), because Claude cannot count pixels by looking.
 * Pure: bytes in, bytes out. JPEG, GIF, WebP and SVG are decoded by the window (`pictures-browser.ts`) and handed in.
 */

export interface Raster {
  width: number;
  height: number;
  /** 8-bit RGBA, top row first. */
  rgba: Uint8ClampedArray;
}

export type PictureFormat = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'psd' | 'aseprite' | 'svg';

/** What the API takes as it is. */
export const API_FORMATS: ReadonlySet<PictureFormat> = new Set(['png', 'jpeg', 'gif', 'webp']);
export const API_MIME = { png: 'image/png', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp' } as const;
export type ApiMime = (typeof API_MIME)[keyof typeof API_MIME];

/** The longest side Claude looks at (larger is scaled down by the API anyway) and the most bytes one picture may weigh. */
export const PICTURE_LIMITS = { maxSide: 1568, maxBytes: 3_500_000 } as const;

export class PictureProblem extends Error {}

const ascii = (b: Uint8Array, at: number, n: number): string => String.fromCharCode(...b.subarray(at, at + n));

export function pictureFormat(path: string, bytes: Uint8Array): PictureFormat | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 3) === 'PNG') return 'png';
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (bytes.length >= 6 && ascii(bytes, 0, 4) === 'GIF8') return 'gif';
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === 'RIFF' && ascii(bytes, 8, 4) === 'WEBP') return 'webp';
  if (bytes.length >= 26 && ascii(bytes, 0, 4) === '8BPS') return 'psd';
  if (bytes.length >= 30 && bytes[4] === 0xe0 && bytes[5] === 0xa5) return 'aseprite';
  if (bytes.length >= 30 && ascii(bytes, 0, 2) === 'BM') return 'bmp';
  if (/\.svg$/i.test(path) || /^\s*(<\?xml[^>]*>\s*)?(<!--[^]*?-->\s*)?(<!DOCTYPE[^>]*>\s*)?<svg\b/.test(ascii(bytes, 0, Math.min(bytes.length, 600)))) {
    if (/<svg\b/.test(new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 4000))))) return 'svg';
  }
  return null;
}

// ---- headers: the size (and frames) of a picture that is not decoded here ----

export interface PictureHead {
  width: number;
  height: number;
  frames: number;
}

function jpegHead(b: Uint8Array): PictureHead | null {
  let i = 2;
  while (i + 9 < b.length) {
    if (b[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = b[i + 1]!;
    if (marker === 0xff) {
      i++;
      continue;
    }
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: (b[i + 5]! << 8) | b[i + 6]!, width: (b[i + 7]! << 8) | b[i + 8]!, frames: 1 };
    }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) i += 2;
    else i += 2 + ((b[i + 2]! << 8) | b[i + 3]!);
  }
  return null;
}

function gifHead(b: Uint8Array): PictureHead | null {
  if (b.length < 13) return null;
  const width = b[6]! | (b[7]! << 8);
  const height = b[8]! | (b[9]! << 8);
  let i = 13 + ((b[10]! & 0x80) !== 0 ? 3 * (1 << ((b[10]! & 7) + 1)) : 0);
  let frames = 0;
  const skipBlocks = (): void => {
    while (i < b.length && b[i] !== 0) i += b[i]! + 1;
    i++;
  };
  while (i < b.length) {
    const kind = b[i++];
    if (kind === 0x21) {
      i++; // the extension's label
      skipBlocks();
    } else if (kind === 0x2c) {
      frames++;
      const flags = b[i + 8]!;
      i += 9;
      if ((flags & 0x80) !== 0) i += 3 * (1 << ((flags & 7) + 1));
      i++; // minimum code size
      skipBlocks();
    } else break;
  }
  return { width, height, frames: Math.max(1, frames) };
}

function webpHead(b: Uint8Array): PictureHead | null {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const kind = ascii(b, 12, 4);
  let frames = 1;
  if (kind === 'VP8X' && b.length >= 30) {
    const animated = (b[20]! & 2) !== 0;
    if (animated) {
      frames = 0;
      for (let i = 30; i + 8 < b.length; ) {
        const size = dv.getUint32(i + 4, true);
        if (ascii(b, i, 4) === 'ANMF') frames++;
        i += 8 + size + (size & 1);
      }
      frames = Math.max(1, frames);
    }
    return { width: 1 + (b[24]! | (b[25]! << 8) | (b[26]! << 16)), height: 1 + (b[27]! | (b[28]! << 8) | (b[29]! << 16)), frames };
  }
  if (kind === 'VP8 ' && b.length >= 30) return { width: dv.getUint16(26, true) & 0x3fff, height: dv.getUint16(28, true) & 0x3fff, frames };
  if (kind === 'VP8L' && b.length >= 25 && b[20] === 0x2f) {
    const bits = dv.getUint32(21, true);
    return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1, frames };
  }
  return null;
}

function svgHead(b: Uint8Array): PictureHead | null {
  const text = new TextDecoder().decode(b.subarray(0, Math.min(b.length, 8000)));
  const tag = /<svg\b[^>]*>/.exec(text)?.[0] ?? '';
  const num = (name: string): number => Number(new RegExp(`\\b${name}\\s*=\\s*["']\\s*([0-9.]+)\\s*(?:px)?\\s*["']`).exec(tag)?.[1] ?? 0);
  let width = num('width');
  let height = num('height');
  const box = /viewBox\s*=\s*["']\s*[-0-9.]+[\s,]+[-0-9.]+[\s,]+([0-9.]+)[\s,]+([0-9.]+)/.exec(tag);
  if ((!width || !height) && box) {
    width = Number(box[1]);
    height = Number(box[2]);
  }
  return width > 0 && height > 0 ? { width, height, frames: 1 } : { width: 0, height: 0, frames: 1 };
}

export function pictureHead(format: PictureFormat, bytes: Uint8Array): PictureHead | null {
  try {
    if (format === 'jpeg') return jpegHead(bytes);
    if (format === 'gif') return gifHead(bytes);
    if (format === 'webp') return webpHead(bytes);
    if (format === 'svg') return svgHead(bytes);
  } catch {
    return null;
  }
  return null;
}

// ---- formats decoded here ----

/** A BMP: 1, 4, 8, 16, 24 and 32 bits to the pixel, not compressed (the run-length kinds are not read). */
export function decodeBmp(b: Uint8Array): Raster {
  if (b.length < 54 || ascii(b, 0, 2) !== 'BM') throw new PictureProblem('That is not a BMP file.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const dataAt = dv.getUint32(10, true);
  const headSize = dv.getUint32(14, true);
  if (headSize < 40) throw new PictureProblem('That BMP is of a very old kind that cannot be read. Save it again as a PNG.');
  const width = dv.getInt32(18, true);
  const rawHeight = dv.getInt32(22, true);
  const bits = dv.getUint16(28, true);
  const compression = dv.getUint32(30, true);
  const colours = dv.getUint32(46, true);
  const height = Math.abs(rawHeight);
  const topDown = rawHeight < 0;
  if (width <= 0 || width > 16384 || height === 0 || height > 16384) throw new PictureProblem('That BMP has a size that cannot be right.');
  if (compression !== 0 && !(compression === 3 && (bits === 16 || bits === 32))) throw new PictureProblem('That BMP is compressed in a way that cannot be read. Save it again as a PNG.');
  const palette: number[] = [];
  if (bits <= 8) {
    const n = colours > 0 ? colours : 1 << bits;
    for (let i = 0; i < n; i++) {
      const at = 14 + headSize + i * 4;
      if (at + 3 >= b.length) break;
      palette.push((b[at + 2]! << 16) | (b[at + 1]! << 8) | b[at]!);
    }
  }
  let masks = [0xff0000, 0x00ff00, 0x0000ff, 0];
  if (compression === 3 && headSize >= 40) masks = [dv.getUint32(54, true), dv.getUint32(58, true), dv.getUint32(62, true), headSize >= 56 ? dv.getUint32(66, true) : 0];
  else if (bits === 16) masks = [0x7c00, 0x03e0, 0x001f, 0];
  const rowBytes = Math.floor((bits * width + 31) / 32) * 4;
  if (dataAt + rowBytes * height > b.length + rowBytes) throw new PictureProblem('That BMP file is cut short.');
  const rgba = new Uint8ClampedArray(width * height * 4);
  const scale = (value: number, mask: number): number => {
    if (mask === 0) return 255;
    const shift = Math.clz32(mask & -mask) ^ 31;
    const max = mask >>> shift;
    return Math.round((((value & mask) >>> shift) * 255) / max);
  };
  let anyAlpha = false;
  for (let y = 0; y < height; y++) {
    const row = dataAt + (topDown ? y : height - 1 - y) * rowBytes;
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4;
      let r: number;
      let g: number;
      let bl: number;
      let a = 255;
      if (bits === 24) {
        bl = b[row + x * 3]!;
        g = b[row + x * 3 + 1]!;
        r = b[row + x * 3 + 2]!;
      } else if (bits === 32 || bits === 16) {
        const v = bits === 32 ? dv.getUint32(row + x * 4, true) : dv.getUint16(row + x * 2, true);
        r = scale(v, masks[0]!);
        g = scale(v, masks[1]!);
        bl = scale(v, masks[2]!);
        if (masks[3]) {
          a = scale(v, masks[3]!);
          if (a > 0) anyAlpha = true;
        } else if (bits === 32 && compression === 0) {
          a = b[row + x * 4 + 3]!;
          if (a > 0) anyAlpha = true;
        }
      } else {
        const perByte = 8 / bits;
        const byte = b[row + Math.floor(x / perByte)]!;
        const idx = (byte >> (8 - bits * ((x % perByte) + 1))) & ((1 << bits) - 1);
        const c = palette[idx] ?? 0;
        r = (c >> 16) & 255;
        g = (c >> 8) & 255;
        bl = c & 255;
      }
      rgba[o] = r;
      rgba[o + 1] = g;
      rgba[o + 2] = bl;
      rgba[o + 3] = a;
    }
  }
  // a 32-bit BMP whose alpha bytes are all zero has no alpha: it is opaque
  if (!anyAlpha && bits === 32) for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
  return { width, height, rgba };
}

/** A PSD's flattened picture (the merged image every Photoshop file keeps unless "maximise compatibility" was off). Layers are not read. */
export function decodePsd(b: Uint8Array): Raster {
  if (b.length < 30 || ascii(b, 0, 4) !== '8BPS') throw new PictureProblem('That is not a PSD file.');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint16(4) !== 1) throw new PictureProblem('That is a large-format PSB file, which cannot be read. Export it as a PNG.');
  const channels = dv.getUint16(12);
  const height = dv.getUint32(14);
  const width = dv.getUint32(18);
  const depth = dv.getUint16(22);
  const mode = dv.getUint16(24);
  if (width === 0 || height === 0 || width > 30000 || height > 30000) throw new PictureProblem('That PSD has a size that cannot be right.');
  if (depth !== 8 && depth !== 16) throw new PictureProblem(`That PSD has ${depth} bits to a colour, which cannot be read. Export it as a PNG.`);
  if (![1, 2, 3, 4].includes(mode)) throw new PictureProblem('That PSD uses a colour mode that cannot be read (only grey, indexed, RGB and CMYK are). Export it as a PNG.');
  let at = 26;
  const modeLen = dv.getUint32(at);
  const modeData = b.subarray(at + 4, at + 4 + modeLen);
  at += 4 + modeLen;
  at += 4 + dv.getUint32(at); // image resources
  at += 4 + dv.getUint32(at); // layers and masks
  const compression = dv.getUint16(at);
  at += 2;
  const bytesPer = depth / 8;
  const planeBytes = width * height * bytesPer;
  const planes: Uint8Array[] = [];
  if (compression === 0) {
    for (let c = 0; c < channels; c++) planes.push(b.subarray(at + c * planeBytes, at + (c + 1) * planeBytes));
  } else if (compression === 1) {
    // PackBits, one run of rows per channel, after a table of the length of every row
    let data = at + channels * height * 2;
    for (let c = 0; c < channels; c++) {
      const plane = new Uint8Array(planeBytes);
      let o = 0;
      for (let y = 0; y < height; y++) {
        const rowLen = dv.getUint16(at + (c * height + y) * 2);
        const end = data + rowLen;
        let rowOut = 0;
        const rowSize = width * bytesPer;
        while (data < end && rowOut < rowSize) {
          const n = (b[data++]! << 24) >> 24;
          if (n >= 0) {
            for (let k = 0; k <= n && rowOut < rowSize; k++) plane[o + rowOut++] = b[data++]!;
          } else if (n !== -128) {
            const v = b[data++]!;
            for (let k = 0; k < 1 - n && rowOut < rowSize; k++) plane[o + rowOut++] = v;
          }
        }
        data = end;
        o += rowSize;
      }
      planes.push(plane);
    }
  } else throw new PictureProblem('That PSD is compressed in a way that cannot be read. Export it as a PNG.');
  if (planes.length < (mode === 4 ? 4 : mode === 3 ? 3 : 1)) throw new PictureProblem('That PSD has fewer colour channels than its colour mode needs.');
  const sample = (plane: Uint8Array, i: number): number => plane[i * bytesPer]!; // 16-bit: the high byte
  const rgba = new Uint8ClampedArray(width * height * 4);
  const alphaPlane = mode === 3 ? planes[3] : mode === 4 ? planes[4] : planes[1];
  for (let i = 0; i < width * height; i++) {
    let r: number;
    let g: number;
    let bl: number;
    if (mode === 3) {
      r = sample(planes[0]!, i);
      g = sample(planes[1]!, i);
      bl = sample(planes[2]!, i);
    } else if (mode === 4) {
      const k = sample(planes[3]!, i);
      r = (sample(planes[0]!, i) * k) / 255;
      g = (sample(planes[1]!, i) * k) / 255;
      bl = (sample(planes[2]!, i) * k) / 255;
    } else if (mode === 2) {
      const idx = sample(planes[0]!, i);
      r = modeData[idx] ?? 0;
      g = modeData[256 + idx] ?? 0;
      bl = modeData[512 + idx] ?? 0;
    } else {
      r = g = bl = sample(planes[0]!, i);
    }
    rgba[i * 4] = r;
    rgba[i * 4 + 1] = g;
    rgba[i * 4 + 2] = bl;
    rgba[i * 4 + 3] = mode === 2 || !alphaPlane || (mode === 1 && planes.length < 2) || (mode === 3 && planes.length < 4) || (mode === 4 && planes.length < 5) ? 255 : sample(alphaPlane, i);
  }
  return { width, height, rgba };
}

// ---- pixels ----

/** Scale down (never up) so the longest side is at most `maxSide`, averaging the pixels that fall in each new pixel. */
export function downscale(r: Raster, maxSide: number): Raster {
  const longest = Math.max(r.width, r.height);
  if (longest <= maxSide) return r;
  const k = maxSide / longest;
  const w = Math.max(1, Math.round(r.width * k));
  const h = Math.max(1, Math.round(r.height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * r.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * r.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * r.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * r.width) / w));
      let sr = 0;
      let sg = 0;
      let sb = 0;
      let sa = 0;
      let n = 0;
      for (let yy = y0; yy < y1; yy++) {
        for (let xx = x0; xx < x1; xx++) {
          const i = (yy * r.width + xx) * 4;
          const a = r.rgba[i + 3]!;
          sr += r.rgba[i]! * a;
          sg += r.rgba[i + 1]! * a;
          sb += r.rgba[i + 2]! * a;
          sa += a;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (sa > 0) {
        out[o] = sr / sa;
        out[o + 1] = sg / sa;
        out[o + 2] = sb / sa;
      }
      out[o + 3] = sa / n;
    }
  }
  return { width: w, height: h, rgba: out };
}

/** Nearest-neighbour enlarging by a whole number (small pixel art, so the pixels can be seen). */
export function enlarge(r: Raster, factor: number): Raster {
  if (factor <= 1) return r;
  const w = r.width * factor;
  const h = r.height * factor;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out.set(r.rgba.subarray((Math.floor(y / factor) * r.width + Math.floor(x / factor)) * 4, (Math.floor(y / factor) * r.width + Math.floor(x / factor)) * 4 + 4), (y * w + x) * 4);
  }
  return { width: w, height: h, rgba: out };
}

/** Frames side by side in a grid, `columns` to a row. */
export function contactSheet(frames: readonly Raster[], columns: number): Raster {
  const cols = Math.min(columns, frames.length);
  const rows = Math.ceil(frames.length / cols);
  const fw = frames[0]!.width;
  const fh = frames[0]!.height;
  const gap = 1;
  const w = cols * fw + (cols - 1) * gap;
  const h = rows * fh + (rows - 1) * gap;
  const out = new Uint8ClampedArray(w * h * 4);
  frames.forEach((f, i) => {
    const ox = (i % cols) * (fw + gap);
    const oy = Math.floor(i / cols) * (fh + gap);
    for (let y = 0; y < Math.min(fh, f.height); y++) out.set(f.rgba.subarray(y * f.width * 4, (y * f.width + Math.min(fw, f.width)) * 4), ((oy + y) * w + ox) * 4);
  });
  return { width: w, height: h, rgba: out };
}

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');

/** How many different colours, how much is see-through, and the colours used most: the words that stand in for counting pixels. */
export function colourFacts(r: Raster): string {
  const counts = new Map<number, number>();
  let clear = 0;
  let partly = 0;
  const total = r.width * r.height;
  let overflow = false;
  for (let i = 0; i < total; i++) {
    const a = r.rgba[i * 4 + 3]!;
    if (a === 0) {
      clear++;
      continue;
    }
    if (a < 255) partly++;
    const key = ((r.rgba[i * 4]! << 16) | (r.rgba[i * 4 + 1]! << 8) | r.rgba[i * 4 + 2]!) >>> 0;
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (counts.size > 4096) {
      overflow = true;
      break;
    }
  }
  if (overflow) return 'More than 4000 different colours (a photograph or smooth shading, not pixel art).';
  const top = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0]).slice(0, 8);
  const opaque = total - clear;
  const parts = [`${counts.size} different colour${counts.size === 1 ? '' : 's'}`];
  if (clear > 0) parts.push(`${Math.round((clear / total) * 100)}% fully transparent`);
  if (partly > 0) parts.push(`${Math.round((partly / total) * 100)}% partly transparent`);
  const used = top.map(([c, n]) => `#${hex2((c >> 16) & 255)}${hex2((c >> 8) & 255)}${hex2(c & 255)} ${Math.max(1, Math.round((n / Math.max(1, opaque)) * 100))}%`);
  return `${parts.join(', ')}.${used.length > 0 ? ` Used most: ${used.join(', ')}.` : ''}`;
}

// ---- the whole job ----

export type Rasterize = (bytes: Uint8Array, format: PictureFormat) => Promise<Raster>;

export interface PictureForClaude {
  mediaType: ApiMime;
  data: Uint8Array;
  /** Lines about the picture, for the text beside it. */
  facts: string;
}

const FORMAT_NAME: Record<PictureFormat, string> = { png: 'PNG', jpeg: 'JPEG', gif: 'GIF', webp: 'WebP', bmp: 'BMP', psd: 'Photoshop (PSD)', aseprite: 'Aseprite', svg: 'SVG' };

function spriteLines(s: SpriteData): string {
  const layers = s.layers.map((l) => l.name).join(', ');
  const clips = s.clips.map((c) => c.name).join(', ');
  return `${s.layers.length} layer${s.layers.length === 1 ? '' : 's'} (${layers})${clips ? `, animations: ${clips}` : ''}.`;
}

/**
 * Make a picture file ready to show Claude. `rasterize` decodes the formats this file cannot (JPEG, GIF, WebP, SVG): without it
 * those can only be passed on as they are, and a big one is refused with the way out.
 */
export async function pictureForClaude(path: string, bytes: Uint8Array, rasterize?: Rasterize, limits: { maxSide: number; maxBytes: number } = PICTURE_LIMITS): Promise<PictureForClaude> {
  const format = pictureFormat(path, bytes);
  if (!format) throw new PictureProblem('its name says it is a picture, but its contents are not a picture file I can read.');
  const head = pictureHead(format, bytes);
  const notes: string[] = [];
  let raster: Raster | null = null;
  let frames = head?.frames ?? 1;
  let sheet: Raster | null = null;
  let sprite: SpriteData | null = null;

  if (format === 'png') {
    try {
      const d = decodePng(bytes);
      raster = { width: d.width, height: d.height, rgba: d.rgba };
    } catch {
      raster = rasterize ? await rasterize(bytes, format).catch(() => null) : null;
    }
  } else if (format === 'bmp') raster = decodeBmp(bytes);
  else if (format === 'psd') {
    raster = decodePsd(bytes);
    notes.push('Only the flattened picture saved in the file is shown, not the layers.');
  } else if (format === 'aseprite') {
    sprite = parseAseprite(bytes, path.split('/').pop() ?? 'sprite');
    frames = sprite.frames.length;
    const all = sprite.frames.map((_f, i) => ({ width: sprite!.width, height: sprite!.height, rgba: compositeFrame(sprite!, i) }));
    raster = all[0] ?? null;
    if (all.length > 1) {
      sheet = contactSheet(all.slice(0, 32), Math.min(8, all.length));
      notes.push(`The picture shows ${Math.min(all.length, 32)} of its ${all.length} frames side by side, left to right, top to bottom.`);
    }
  } else if (rasterize) {
    try {
      raster = await rasterize(bytes, format);
    } catch (e) {
      if (format === 'svg') throw new PictureProblem(`the SVG could not be drawn (${e instanceof Error ? e.message : String(e)}).`);
    }
  }

  const width = raster?.width ?? head?.width ?? 0;
  const height = raster?.height ?? head?.height ?? 0;
  const lines = [`${path}: a ${FORMAT_NAME[format]} picture${width > 0 ? `, ${width} x ${height} pixels` : ''}${frames > 1 ? `, ${frames} frames${format === 'gif' || format === 'webp' ? ' (the picture is the first one)' : ''}` : ''}.`];
  if (sprite) lines.push(spriteLines(sprite));
  if (raster) lines.push(sprite ? `Colours in the palette: ${Math.max(0, sprite.palette.length - 1)}. ${colourFacts(raster)}` : colourFacts(raster));
  if (format === 'svg') lines.push('An SVG is also text: read it as text for its shapes and colours.');
  lines.push(...notes);

  const asIs = API_FORMATS.has(format) && !sheet;
  const longest = Math.max(width, height);
  if (asIs && bytes.length <= limits.maxBytes && (longest <= limits.maxSide || longest === 0)) {
    return { mediaType: API_MIME[format as keyof typeof API_MIME], data: bytes, facts: lines.join(' ') };
  }
  if (!raster) {
    throw new PictureProblem(`a ${FORMAT_NAME[format]} of ${(bytes.length / 1024 / 1024).toFixed(1)} MB${width > 0 ? ` (${width} x ${height})` : ''} is too big to look at and could not be made smaller here. Ask the user for a smaller copy.`);
  }

  // converted, or too big: PNG, enlarged when tiny, reduced until it fits
  let out = sheet ?? raster;
  const converted = !API_FORMATS.has(format) || sheet !== null;
  if (converted && Math.max(out.width, out.height) <= 64) {
    const factor = Math.max(1, Math.min(8, Math.floor(256 / Math.max(out.width, out.height))));
    if (factor > 1) {
      out = enlarge(out, factor);
      lines.push(`It is shown enlarged ${factor} times so the pixels can be seen.`);
    }
  }
  const originalSide = Math.max(out.width, out.height);
  let side = Math.min(limits.maxSide, originalSide);
  let png = encodePng(...pngArgs(downscale(out, side)));
  while (png.length > limits.maxBytes && side > 64) {
    side = Math.floor(side * 0.7);
    png = encodePng(...pngArgs(downscale(out, side)));
  }
  if (png.length > limits.maxBytes) throw new PictureProblem('this picture is too detailed to make small enough to look at. Ask the user for a smaller copy.');
  if (side < originalSide) {
    const shown = downscale(out, side);
    lines.push(`It was ${out.width} x ${out.height}; it is shown reduced to ${shown.width} x ${shown.height}.`);
  }
  if (!API_FORMATS.has(format)) lines.push(`It was converted to PNG for looking at; the file in the project is unchanged.`);
  return { mediaType: 'image/png', data: png, facts: lines.join(' ') };
}

export function bytesToBase64(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const pngArgs = (r: Raster): [number, number, Uint8ClampedArray] => [r.width, r.height, r.rgba];
