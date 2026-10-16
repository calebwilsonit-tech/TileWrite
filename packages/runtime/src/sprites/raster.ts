import { decodeRle } from './rle';
import { parseColor, type SpriteData } from './format';

/** One layer's pixels for one frame: palette indices, row by row. */
export type Cel = Uint8Array;

export interface Size {
  w: number;
  h: number;
}

export interface Pt {
  x: number;
  y: number;
}

export function newCel(w: number, h: number): Cel {
  return new Uint8Array(w * h);
}

export function inBounds(s: Size, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < s.w && y < s.h;
}

export function getPixel(cel: Cel, s: Size, x: number, y: number): number {
  return inBounds(s, x, y) ? cel[y * s.w + x]! : 0;
}

export function setPixel(cel: Cel, s: Size, x: number, y: number, v: number): void {
  if (inBounds(s, x, y)) cel[y * s.w + x] = v;
}

/** Pixels on a one-pixel line (Bresenham), both ends included. */
export function linePoints(a: Pt, b: Pt): Pt[] {
  const out: Pt[] = [];
  let x = a.x;
  let y = a.y;
  const dx = Math.abs(b.x - a.x);
  const dy = Math.abs(b.y - a.y);
  const sx = a.x < b.x ? 1 : -1;
  const sy = a.y < b.y ? 1 : -1;
  let err = dx - dy;
  for (;;) {
    out.push({ x, y });
    if (x === b.x && y === b.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      x += sx;
    }
    if (e2 < dx) {
      err += dx;
      y += sy;
    }
  }
  return out;
}

export function rectPoints(a: Pt, b: Pt, filled: boolean): Pt[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const out: Pt[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (filled || x === x0 || x === x1 || y === y0 || y === y1) out.push({ x, y });
    }
  }
  return out;
}

/** Ellipse inscribed in the box spanned by a and b (midpoint algorithm on cell centres). */
export function ellipsePoints(a: Pt, b: Pt, filled: boolean): Pt[] {
  const x0 = Math.min(a.x, b.x);
  const x1 = Math.max(a.x, b.x);
  const y0 = Math.min(a.y, b.y);
  const y1 = Math.max(a.y, b.y);
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = (x1 - x0 + 1) / 2;
  const ry = (y1 - y0 + 1) / 2;
  const inside = (x: number, y: number): boolean => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;
  const out: Pt[] = [];
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y)) continue;
      if (filled) out.push({ x, y });
      else if (!inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1)) out.push({ x, y });
    }
  }
  return out;
}

/** Pixels whose centres lie inside a polygon (even-odd rule), scanning row by row. */
export function polygonPoints(poly: readonly { x: number; y: number }[]): Pt[] {
  if (poly.length < 3) return [];
  const minY = Math.ceil(Math.min(...poly.map((p) => p.y)) - 0.5);
  const maxY = Math.floor(Math.max(...poly.map((p) => p.y)) - 0.5);
  const out: Pt[] = [];
  for (let y = minY; y <= maxY; y++) {
    const cy = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i]!;
      const b = poly[(i + 1) % poly.length]!;
      if ((a.y <= cy && b.y > cy) || (b.y <= cy && a.y > cy)) xs.push(a.x + ((cy - a.y) / (b.y - a.y)) * (b.x - a.x));
    }
    xs.sort((p, q) => p - q);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      for (let x = Math.ceil(xs[i]! - 0.5); x <= Math.floor(xs[i + 1]! - 0.5); x++) out.push({ x, y });
    }
  }
  return out;
}

export interface IsoBox {
  /** Pixel the middle of the box's footprint sits on. */
  cx: number;
  cy: number;
  /** Footprint in cells along x and y; may be fractional. */
  w: number;
  d: number;
  /** Height in pixels. */
  h: number;
  /** Half the width of one cell on screen, in pixels (16 = a 32 x 16 tile; 32 matches the game's 64 x 32 tiles). */
  s: number;
}

/** The three visible faces of an isometric box (2:1 projection), as polygons in pixel space. */
export function isoBoxFaces(b: IsoBox): { top: Pt[]; left: Pt[]; right: Pt[] } {
  const P = (gx: number, gy: number, up: number): Pt => ({ x: b.cx + (gx - gy) * b.s, y: b.cy + ((gx + gy) * b.s) / 2 - up });
  const hw = b.w / 2;
  const hd = b.d / 2;
  const N = (up: number): Pt => P(-hw, -hd, up);
  const E = (up: number): Pt => P(hw, -hd, up);
  const S = (up: number): Pt => P(hw, hd, up);
  const W = (up: number): Pt => P(-hw, hd, up);
  return {
    top: [N(b.h), E(b.h), S(b.h), W(b.h)],
    left: [W(b.h), S(b.h), S(0), W(0)],
    right: [S(b.h), E(b.h), E(0), S(0)],
  };
}

/** Pixels connected (4-way) to the start with the same colour. */
export function floodPoints(cel: Cel, s: Size, start: Pt, limit = 1_000_000): Pt[] {
  if (!inBounds(s, start.x, start.y)) return [];
  const target = getPixel(cel, s, start.x, start.y);
  const seen = new Uint8Array(s.w * s.h);
  const stack: Pt[] = [start];
  const out: Pt[] = [];
  seen[start.y * s.w + start.x] = 1;
  while (stack.length > 0 && out.length < limit) {
    const p = stack.pop()!;
    out.push(p);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      if (!inBounds(s, nx, ny)) continue;
      const k = ny * s.w + nx;
      if (seen[k] || cel[k] !== target) continue;
      seen[k] = 1;
      stack.push({ x: nx, y: ny });
    }
  }
  return out;
}

export type Symmetry = { x: boolean; y: boolean };

/** Every pixel a stroke at (x, y) should also touch under mirror symmetry about the canvas centre. */
export function mirrored(p: Pt, s: Size, sym: Symmetry): Pt[] {
  const out: Pt[] = [p];
  if (sym.x) out.push({ x: s.w - 1 - p.x, y: p.y });
  if (sym.y) out.push({ x: p.x, y: s.h - 1 - p.y });
  if (sym.x && sym.y) out.push({ x: s.w - 1 - p.x, y: s.h - 1 - p.y });
  return out;
}

export function flipH(cel: Cel, s: Size): Cel {
  const out = newCel(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out[y * s.w + (s.w - 1 - x)] = cel[y * s.w + x]!;
  return out;
}

export function flipV(cel: Cel, s: Size): Cel {
  const out = newCel(s.w, s.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out[(s.h - 1 - y) * s.w + x] = cel[y * s.w + x]!;
  return out;
}

/** Rotate a square-or-not canvas by 90 degrees clockwise; the result has swapped width and height. */
export function rotate90(cel: Cel, s: Size): { cel: Cel; size: Size } {
  const size = { w: s.h, h: s.w };
  const out = newCel(size.w, size.h);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) out[x * size.w + (s.h - 1 - y)] = cel[y * s.w + x]!;
  return { cel: out, size };
}

/** Shift the picture; pixels moved off the canvas are lost, uncovered pixels are transparent. */
export function shift(cel: Cel, s: Size, dx: number, dy: number): Cel {
  const out = newCel(s.w, s.h);
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      const nx = x + dx;
      const ny = y + dy;
      if (inBounds(s, nx, ny)) out[ny * s.w + nx] = cel[y * s.w + x]!;
    }
  }
  return out;
}

/** Copy a rectangle of pixels out of a cel. */
export function copyRect(cel: Cel, s: Size, r: { x: number; y: number; w: number; h: number }): Cel {
  const out = newCel(r.w, r.h);
  for (let y = 0; y < r.h; y++) for (let x = 0; x < r.w; x++) out[y * r.w + x] = getPixel(cel, s, r.x + x, r.y + y);
  return out;
}

/** Paste `src` at (x, y); transparent source pixels leave the destination alone unless `overwrite`. */
export function pasteCel(dst: Cel, s: Size, src: Cel, srcSize: Size, x: number, y: number, overwrite = false): void {
  for (let j = 0; j < srcSize.h; j++) {
    for (let i = 0; i < srcSize.w; i++) {
      const v = src[j * srcSize.w + i]!;
      if (v !== 0 || overwrite) setPixel(dst, s, x + i, y + j, v);
    }
  }
}

/** Tight bounds of the non-transparent pixels, or null for an empty cel. */
export function bounds(cel: Cel, s: Size): { x: number; y: number; w: number; h: number } | null {
  let x0 = s.w;
  let y0 = s.h;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < s.h; y++) {
    for (let x = 0; x < s.w; x++) {
      if (cel[y * s.w + x] === 0) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

/** Palette as packed RGBA numbers (0xRRGGBBAA). */
export function paletteRgba(palette: readonly string[]): number[] {
  return palette.map(parseColor);
}

export interface CompositeOptions {
  /** Draw only these layers (default: all visible layers). */
  layers?: readonly string[];
  /** 0..1 multiplier on alpha (used for onion skins). */
  alpha?: number;
  /** Replace colours with this tint (0xRRGGBB), keeping alpha (used for onion skins). */
  tint?: number;
}

export function celFor(sprite: SpriteData, frame: number, layerId: string): Cel {
  const text = sprite.frames[frame]?.cels[layerId];
  return text === undefined ? newCel(sprite.width, sprite.height) : decodeRle(text, sprite.width * sprite.height);
}

/** Layers' pixels (bottom first) flattened into RGBA bytes. Used while editing, where cels are already decoded. */
export function compositeCels(width: number, height: number, palette: readonly string[], cels: readonly Cel[], opts: Pick<CompositeOptions, 'alpha' | 'tint'> = {}): Uint8ClampedArray {
  const out = new Uint8ClampedArray(width * height * 4);
  const pal = paletteRgba(palette);
  const alpha = opts.alpha ?? 1;
  for (const cel of cels) {
    for (let i = 0; i < cel.length; i++) {
      const idx = cel[i]!;
      if (idx === 0) continue;
      const c = pal[idx] ?? 0;
      const a = ((c & 255) / 255) * alpha;
      if (a <= 0) continue;
      let r = (c >>> 24) & 255;
      let g = (c >>> 16) & 255;
      let b = (c >>> 8) & 255;
      if (opts.tint !== undefined) {
        r = (opts.tint >>> 16) & 255;
        g = (opts.tint >>> 8) & 255;
        b = opts.tint & 255;
      }
      const o = i * 4;
      const da = out[o + 3]! / 255;
      const oa = a + da * (1 - a);
      out[o] = (r * a + out[o]! * da * (1 - a)) / oa;
      out[o + 1] = (g * a + out[o + 1]! * da * (1 - a)) / oa;
      out[o + 2] = (b * a + out[o + 2]! * da * (1 - a)) / oa;
      out[o + 3] = oa * 255;
    }
  }
  return out;
}

/** All layers of a frame flattened into RGBA bytes (bottom layer first). */
export function compositeFrame(sprite: SpriteData, frame: number, opts: CompositeOptions = {}): Uint8ClampedArray {
  const cels: Cel[] = [];
  for (const layer of sprite.layers) {
    if (opts.layers ? !opts.layers.includes(layer.id) : !layer.visible) continue;
    cels.push(celFor(sprite, frame, layer.id));
  }
  return compositeCels(sprite.width, sprite.height, sprite.palette, cels, opts);
}