import { unzlibSync, zlibSync } from 'fflate';

const SIGNATURE = [137, 80, 78, 71, 13, 10, 26, 10];

let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array, start = 0, end = bytes.length): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = start; i < end; i++) c = crcTable[(c ^ bytes[i]!) & 255]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out, 4, 8 + data.length));
  return out;
}

/** Encode 8-bit RGBA pixels as a PNG file. */
export function encodePng(width: number, height: number, rgba: Uint8ClampedArray | Uint8Array): Uint8Array {
  if (rgba.length !== width * height * 4) throw new Error('PNG data does not match the image size');
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, width);
  dv.setUint32(4, height);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  const raw = new Uint8Array((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filter: none
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), y * (width * 4 + 1) + 1);
  }
  const parts = [new Uint8Array(SIGNATURE), chunk('IHDR', ihdr), chunk('IDAT', zlibSync(raw, { level: 6 })), chunk('IEND', new Uint8Array(0))];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) {
    out.set(p, o);
    o += p.length;
  }
  return out;
}

export interface DecodedImage {
  width: number;
  height: number;
  rgba: Uint8ClampedArray;
}

const CHANNELS: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };

/** Decode a PNG (8-bit or 16-bit RGB/RGBA/gray/gray-alpha, or palette of any depth; not interlaced). */
export function decodePng(bytes: Uint8Array): DecodedImage {
  for (let i = 0; i < 8; i++) if (bytes[i] !== SIGNATURE[i]) throw new Error('This file is not a PNG image.');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let pos = 8;
  let width = 0;
  let height = 0;
  let depth = 0;
  let colorType = 0;
  let interlace = 0;
  let palette: Uint8Array | null = null;
  let trns: Uint8Array | null = null;
  const idat: Uint8Array[] = [];
  while (pos + 8 <= bytes.length) {
    const len = dv.getUint32(pos);
    const type = String.fromCharCode(bytes[pos + 4]!, bytes[pos + 5]!, bytes[pos + 6]!, bytes[pos + 7]!);
    const data = bytes.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = dv.getUint32(pos + 8);
      height = dv.getUint32(pos + 12);
      depth = data[8]!;
      colorType = data[9]!;
      interlace = data[12]!;
    } else if (type === 'PLTE') palette = data;
    else if (type === 'tRNS') trns = data;
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    pos += 12 + len;
  }
  if (width === 0 || height === 0) throw new Error('This PNG has no image data.');
  if (interlace !== 0) throw new Error('Interlaced PNG files are not supported. Re-save the image without interlacing.');
  const channels = CHANNELS[colorType];
  if (!channels || ![1, 2, 4, 8, 16].includes(depth)) throw new Error('This kind of PNG is not supported.');
  if (colorType === 3 && !palette) throw new Error('This PNG is missing its colour table.');

  const total = idat.reduce((n, p) => n + p.length, 0);
  const joined = new Uint8Array(total);
  let o = 0;
  for (const p of idat) {
    joined.set(p, o);
    o += p.length;
  }
  const raw = unzlibSync(joined);

  const bitsPerPixel = channels * depth;
  const stride = Math.ceil((width * bitsPerPixel) / 8);
  const bpp = Math.max(1, bitsPerPixel >> 3);
  const px = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const ft = raw[y * (stride + 1)]!;
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let i = 0; i < stride; i++) {
      const x = raw[src + i]!;
      const a = i >= bpp ? px[dst + i - bpp]! : 0;
      const b = y > 0 ? px[dst - stride + i]! : 0;
      const c = i >= bpp && y > 0 ? px[dst - stride + i - bpp]! : 0;
      let v: number;
      switch (ft) {
        case 0:
          v = x;
          break;
        case 1:
          v = x + a;
          break;
        case 2:
          v = x + b;
          break;
        case 3:
          v = x + ((a + b) >> 1);
          break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v = x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c);
          break;
        }
        default:
          throw new Error('This PNG uses an unknown compression filter.');
      }
      px[dst + i] = v & 255;
    }
  }

  const rgba = new Uint8ClampedArray(width * height * 4);
  const sample = (row: number, index: number): number => {
    // index-th sample (channel value) in the row, scaled to 0..255 (palette indices stay unscaled)
    if (depth === 8) return px[row * stride + index]!;
    if (depth === 16) return px[row * stride + index * 2]!;
    const bitPos = index * depth;
    const byte = px[row * stride + (bitPos >> 3)]!;
    const shift = 8 - depth - (bitPos & 7);
    return (byte >> shift) & ((1 << depth) - 1);
  };
  const scale = depth < 8 ? 255 / ((1 << depth) - 1) : 1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (colorType === 3) {
        const idx = sample(y, x);
        rgba[i] = palette![idx * 3]!;
        rgba[i + 1] = palette![idx * 3 + 1]!;
        rgba[i + 2] = palette![idx * 3 + 2]!;
        rgba[i + 3] = trns && idx < trns.length ? trns[idx]! : 255;
      } else if (colorType === 0) {
        const g = Math.round(sample(y, x) * scale);
        rgba[i] = rgba[i + 1] = rgba[i + 2] = g;
        rgba[i + 3] = 255;
      } else if (colorType === 4) {
        const g = sample(y, x * 2);
        rgba[i] = rgba[i + 1] = rgba[i + 2] = g;
        rgba[i + 3] = sample(y, x * 2 + 1);
      } else if (colorType === 2) {
        rgba[i] = sample(y, x * 3);
        rgba[i + 1] = sample(y, x * 3 + 1);
        rgba[i + 2] = sample(y, x * 3 + 2);
        rgba[i + 3] = 255;
      } else {
        rgba[i] = sample(y, x * 4);
        rgba[i + 1] = sample(y, x * 4 + 1);
        rgba[i + 2] = sample(y, x * 4 + 2);
        rgba[i + 3] = sample(y, x * 4 + 3);
      }
    }
  }
  return { width, height, rgba };
}

/**
 * Turn RGBA pixels into palette indices. Colours already in the palette are reused; new colours are
 * added while there is room (index 0 stays transparent); beyond that the nearest colour is used.
 */
export function indexImage(
  rgba: Uint8ClampedArray | Uint8Array,
  palette: readonly string[],
  maxColors = 256,
): { indices: Uint8Array; palette: string[]; added: number; approximated: number } {
  const pal = [...palette];
  const lookup = new Map<string, number>();
  pal.forEach((c, i) => {
    if (i > 0) lookup.set(c.toLowerCase(), i);
  });
  const indices = new Uint8Array(rgba.length / 4);
  let added = 0;
  let approximated = 0;
  const hex = (n: number): string => n.toString(16).padStart(2, '0');
  for (let i = 0; i < indices.length; i++) {
    const a = rgba[i * 4 + 3]!;
    if (a < 8) continue; // transparent
    const key = `#${hex(rgba[i * 4]!)}${hex(rgba[i * 4 + 1]!)}${hex(rgba[i * 4 + 2]!)}${hex(a)}`;
    let idx = lookup.get(key);
    if (idx === undefined) {
      if (pal.length < maxColors) {
        idx = pal.length;
        pal.push(key);
        lookup.set(key, idx);
        added++;
      } else {
        let best = 1;
        let bestD = Infinity;
        for (let p = 1; p < pal.length; p++) {
          const c = pal[p]!;
          const dr = parseInt(c.slice(1, 3), 16) - rgba[i * 4]!;
          const dg = parseInt(c.slice(3, 5), 16) - rgba[i * 4 + 1]!;
          const db = parseInt(c.slice(5, 7), 16) - rgba[i * 4 + 2]!;
          const d = dr * dr + dg * dg + db * db;
          if (d < bestD) {
            bestD = d;
            best = p;
          }
        }
        idx = best;
        approximated++;
      }
    }
    indices[i] = idx;
  }
  return { indices, palette: pal, added, approximated };
}
