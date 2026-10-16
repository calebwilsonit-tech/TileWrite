import { unzlibSync } from 'fflate';
import { SPRITE_SCHEMA_VERSION, type ClipData, type SpriteData } from './format';
import { encodeRle } from './rle';

/**
 * Reads Aseprite (.ase / .aseprite) files into a sprite: layers, frames with durations, palette,
 * and tags as animation clips. Supports 8-bit indexed, 16-bit grayscale and 32-bit RGBA files, raw and
 * compressed cels, linked cels. Groups and tilemap layers are skipped.
 */

export class AsepriteError extends Error {}

interface Layer {
  name: string;
  visible: boolean;
  type: number;
}

interface CelData {
  layer: number;
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint8Array;
  linkedFrame?: number;
}

export function parseAseprite(bytes: Uint8Array, name: string): SpriteData {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length < 128 || dv.getUint16(4, true) !== 0xa5e0) throw new AsepriteError('This file is not an Aseprite (.ase / .aseprite) file.');
  const frameCount = dv.getUint16(6, true);
  const width = dv.getUint16(8, true);
  const height = dv.getUint16(10, true);
  const depth = dv.getUint16(12, true);
  const transparentIndex = bytes[28]!;
  if (![8, 16, 32].includes(depth)) throw new AsepriteError(`Colour depth ${depth} is not supported.`);
  if (width < 1 || height < 1 || width > 512 || height > 512) throw new AsepriteError(`A ${width} x ${height} image is too large for a Tilewright sprite (limit 512).`);

  const layers: Layer[] = [];
  const durations: number[] = [];
  const cels: CelData[][] = [];
  let filePalette: number[] | null = null;
  const tags: { name: string; from: number; to: number; dir: number }[] = [];

  let pos = 128;
  const str = (p: number): { s: string; next: number } => {
    const len = dv.getUint16(p, true);
    return { s: new TextDecoder().decode(bytes.subarray(p + 2, p + 2 + len)), next: p + 2 + len };
  };

  for (let f = 0; f < frameCount; f++) {
    if (pos + 16 > bytes.length || dv.getUint16(pos + 4, true) !== 0xf1fa) throw new AsepriteError(`Frame ${f + 1} is damaged.`);
    const frameBytes = dv.getUint32(pos, true);
    const oldChunks = dv.getUint16(pos + 6, true);
    durations.push(dv.getUint16(pos + 8, true) || 100);
    const newChunks = dv.getUint32(pos + 12, true);
    const chunkCount = newChunks !== 0 ? newChunks : oldChunks;
    const frameCels: CelData[] = [];
    cels.push(frameCels);
    let cp = pos + 16;
    for (let c = 0; c < chunkCount; c++) {
      const size = dv.getUint32(cp, true);
      const type = dv.getUint16(cp + 4, true);
      const body = cp + 6;
      if (type === 0x2004) {
        const flags = dv.getUint16(body, true);
        const ltype = dv.getUint16(body + 2, true);
        layers.push({ name: str(body + 16).s, visible: (flags & 1) !== 0, type: ltype });
      } else if (type === 0x2005) {
        const layer = dv.getUint16(body, true);
        const x = dv.getInt16(body + 2, true);
        const y = dv.getInt16(body + 4, true);
        const ctype = dv.getUint16(body + 7, true);
        if (ctype === 1) {
          frameCels.push({ layer, x, y, w: 0, h: 0, pixels: new Uint8Array(0), linkedFrame: dv.getUint16(body + 16, true) });
        } else if (ctype === 0 || ctype === 2) {
          const w = dv.getUint16(body + 16, true);
          const h = dv.getUint16(body + 18, true);
          const raw = bytes.subarray(body + 20, cp + size);
          const pixels = ctype === 2 ? unzlibSync(raw) : raw.slice();
          frameCels.push({ layer, x, y, w, h, pixels });
        }
      } else if (type === 0x2019) {
        const first = dv.getUint32(body + 4, true);
        const last = dv.getUint32(body + 8, true);
        filePalette ??= [];
        let p = body + 20;
        for (let i = first; i <= last; i++) {
          const flags = dv.getUint16(p, true);
          filePalette[i] = (((bytes[p + 2]! << 24) | (bytes[p + 3]! << 16) | (bytes[p + 4]! << 8) | bytes[p + 5]!) >>> 0);
          p += 6;
          if (flags & 1) p = str(p).next;
        }
      } else if (type === 0x2018) {
        const count = dv.getUint16(body, true);
        let p = body + 10;
        for (let i = 0; i < count; i++) {
          const from = dv.getUint16(p, true);
          const to = dv.getUint16(p + 2, true);
          const dir = bytes[p + 4]!;
          const s = str(p + 17);
          tags.push({ name: s.s, from, to, dir });
          p = s.next;
        }
      }
      cp += size;
    }
    pos += frameBytes;
  }

  // Map file colours to a palette of at most 255 entries (plus transparent).
  const palette: string[] = ['#00000000'];
  const lookup = new Map<number, number>();
  const toIndex = (rgba: number): number => {
    if ((rgba & 255) === 0) return 0;
    let idx = lookup.get(rgba);
    if (idx === undefined) {
      if (palette.length >= 256) throw new AsepriteError('This image uses more than 255 different colours. Reduce its palette in Aseprite (Sprite > Color Mode > Indexed) and import again.');
      idx = palette.length;
      palette.push(`#${rgba.toString(16).padStart(8, '0')}`);
      lookup.set(rgba, idx);
    }
    return idx;
  };

  const pixelRgba = (data: Uint8Array, i: number): number => {
    if (depth === 32) return ((data[i * 4]! << 24) | (data[i * 4 + 1]! << 16) | (data[i * 4 + 2]! << 8) | data[i * 4 + 3]!) >>> 0;
    if (depth === 16) {
      const g = data[i * 2]!;
      return ((g << 24) | (g << 16) | (g << 8) | data[i * 2 + 1]!) >>> 0;
    }
    const idx = data[i]!;
    if (idx === transparentIndex) return 0;
    return filePalette?.[idx] ?? (((idx << 24) | (idx << 16) | (idx << 8) | 255) >>> 0);
  };

  const usable = layers.map((l, i) => ({ l, i })).filter((x) => x.l.type === 0);
  if (usable.length === 0) throw new AsepriteError('This file has no ordinary layers to import.');
  const layerIds = new Map<number, string>();
  const outLayers = usable.map(({ l, i }, n) => {
    const id = `l${n + 1}`;
    layerIds.set(i, id);
    return { id, name: l.name || `Layer ${n + 1}`, visible: l.visible };
  });

  const frames: SpriteData['frames'] = [];
  for (let f = 0; f < frameCount; f++) {
    const out: Record<string, string> = {};
    const frameCels = cels[f]!;
    const resolved = frameCels.map((c) => (c.linkedFrame !== undefined ? { ...(cels[c.linkedFrame]!.find((o) => o.layer === c.layer) ?? c), layer: c.layer } : c));
    for (const c of resolved) {
      const id = layerIds.get(c.layer);
      if (!id || c.pixels.length === 0) continue;
      const cel = new Uint8Array(width * height);
      for (let y = 0; y < c.h; y++) {
        for (let x = 0; x < c.w; x++) {
          const dx = c.x + x;
          const dy = c.y + y;
          if (dx < 0 || dy < 0 || dx >= width || dy >= height) continue;
          cel[dy * width + dx] = toIndex(pixelRgba(c.pixels, y * c.w + x));
        }
      }
      out[id] = encodeRle(cel);
    }
    frames.push({ duration: Math.max(10, durations[f]!), cels: out, boxes: [] });
  }

  const clips: ClipData[] = tags.map((t) => {
    const range: number[] = [];
    for (let i = t.from; i <= Math.min(t.to, frameCount - 1); i++) range.push(i);
    const list = t.dir === 1 ? [...range].reverse() : t.dir === 2 && range.length > 2 ? [...range, ...range.slice(1, -1).reverse()] : range;
    return { name: t.name, loop: true, mirror: false, all: list, dirs: {}, events: [] };
  });

  return {
    schemaVersion: SPRITE_SCHEMA_VERSION,
    name,
    width,
    height,
    palette,
    layers: outLayers,
    frames,
    origin: { x: Math.floor(width / 2), y: height - 1 },
    clips,
    procedural: null,
  };
}
