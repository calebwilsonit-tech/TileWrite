import { compositeFrame, decodeRle, encodeRle, indexImage, newSprite, type AutotileRuleData, type SpriteData } from '@tilewright/runtime';
import { blockGuides, inside, wallGuides, wallSize, type IsoSize, type Pt } from './presets';

/** Pixel work for the tile studio on plain RGBA pictures: cutting faces, recolouring, shading, slicing, mirroring, edges. Pure functions. */

export interface Rgba {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export function blankRgba(width: number, height: number): Rgba {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** The first frame of a sprite, all layers flattened. */
export function rgbaOf(sprite: SpriteData, frame = 0): Rgba {
  return { width: sprite.width, height: sprite.height, data: compositeFrame(sprite, frame) };
}

/** A sprite from a picture (one frame, one layer, a palette of what is used). */
export function spriteFromRgba(name: string, img: Rgba, origin?: Pt): SpriteData {
  const base = newSprite(name, img.width, img.height);
  const indexed = indexImage(img.data, ['#00000000']);
  const layer = base.layers[0]!.id;
  return {
    ...base,
    palette: indexed.palette,
    frames: [{ duration: 100, cels: { [layer]: encodeRle(indexed.indices) }, boxes: [] }],
    origin: origin ? { x: origin[0], y: origin[1] } : { x: Math.floor(img.width / 2), y: Math.floor(img.height / 2) },
  };
}

/** A sprite whose frames are these pictures (animations, stairs in four facings). */
export function spriteFromFrames(name: string, imgs: Rgba[], origin?: Pt): SpriteData {
  const first = imgs[0]!;
  const base = newSprite(name, first.width, first.height);
  // one shared palette for every frame
  const all = blankRgba(first.width, first.height * imgs.length);
  imgs.forEach((im, i) => all.data.set(im.data, i * first.width * first.height * 4));
  const indexed = indexImage(all.data, ['#00000000']);
  const layer = base.layers[0]!.id;
  const n = first.width * first.height;
  return {
    ...base,
    palette: indexed.palette,
    frames: imgs.map((_, i) => ({ duration: 150, cels: { [layer]: encodeRle(indexed.indices.slice(i * n, (i + 1) * n)) }, boxes: [] })),
    origin: origin ? { x: origin[0], y: origin[1] } : { x: Math.floor(first.width / 2), y: Math.floor(first.height / 2) },
  };
}

/** Keep only what is inside the polygons (everything else becomes see-through). */
export function clipTo(img: Rgba, polys: readonly (readonly Pt[])[]): Rgba {
  const out = blankRgba(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p: Pt = [x + 0.5, y + 0.5];
      if (!polys.some((poly) => inside(p, poly))) continue;
      const i = (y * img.width + x) * 4;
      out.data.set(img.data.subarray(i, i + 4), i);
    }
  }
  return out;
}

/** Cut a rectangle out of a picture. */
export function crop(img: Rgba, x0: number, y0: number, w: number, h: number): Rgba {
  const out = blankRgba(w, h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x0 + x;
      const sy = y0 + y;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const i = (sy * img.width + sx) * 4;
      out.data.set(img.data.subarray(i, i + 4), (y * w + x) * 4);
    }
  }
  return out;
}

export function isEmpty(img: Rgba): boolean {
  for (let i = 3; i < img.data.length; i += 4) if (img.data[i]! > 0) return false;
  return true;
}

/** The three pictures a tile uses, cut from one drawing of a block: the top diamond, and the left and right faces. */
export function splitBlock(img: Rgba, iso: IsoSize, levels: number): { top: Rgba; left: Rgba; right: Rgba } {
  const guides = blockGuides(iso, levels);
  const [top, left, right] = guides.map((g) => clipTo(img, [g.points])) as [Rgba, Rgba, Rgba];
  const H = Math.round(levels * iso.heightPx);
  const w2 = iso.tileW / 2;
  const sideH = Math.round(iso.tileH / 2 + H);
  return {
    top: crop(top, 0, 0, iso.tileW, iso.tileH),
    // each face's bounding box inside the block picture
    left: crop(left, 0, iso.tileH / 2, w2, sideH),
    right: crop(right, w2, iso.tileH / 2, w2, sideH),
  };
}

/** The other side of a wall attachment: the same picture mirrored (the wall faces the other way). */
export function mirror(img: Rgba): Rgba {
  const out = blankRgba(img.width, img.height);
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const s = (y * img.width + x) * 4;
      const d = (y * img.width + (img.width - 1 - x)) * 4;
      out.data.set(img.data.subarray(s, s + 4), d);
    }
  }
  return out;
}

// ---------- colour ----------

const hex = (r: number, g: number, b: number, a: number): string => `#${[r, g, b, a].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('')}`;

function toHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  const h = max === rr ? (gg - bb) / d + (gg < bb ? 6 : 0) : max === gg ? (bb - rr) / d + 2 : (rr - gg) / d + 4;
  return [h * 60, s, l];
}

function fromHsl(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hh = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hh % 2) - 1));
  const [r1, g1, b1] = hh < 1 ? [c, x, 0] : hh < 2 ? [x, c, 0] : hh < 3 ? [0, c, x] : hh < 4 ? [0, x, c] : hh < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [(r1 + m) * 255, (g1 + m) * 255, (b1 + m) * 255];
}

export interface Recolour {
  /** Degrees to turn the colours round the colour wheel. */
  hue: number;
  /** 1 = as is; 0 = grey. */
  saturation: number;
  /** 1 = as is; below darkens, above lightens. */
  lightness: number;
  /** Blend toward this colour (0 to 1 strength). */
  tint?: { colour: string; strength: number };
  /** Exact colour swaps ("#rrggbb" to "#rrggbb"), applied first. */
  swap?: Record<string, string>;
}

export const RECOLOUR_PRESETS: Record<string, Recolour> = {
  snow: { hue: 0, saturation: 0.35, lightness: 1.25, tint: { colour: '#eef4ff', strength: 0.5 } },
  autumn: { hue: -35, saturation: 1.05, lightness: 1, tint: { colour: '#c9772b', strength: 0.25 } },
  desert: { hue: -60, saturation: 0.8, lightness: 1.15, tint: { colour: '#e8c98a', strength: 0.4 } },
  night: { hue: 15, saturation: 0.7, lightness: 0.6, tint: { colour: '#1a2a6a', strength: 0.35 } },
  grey: { hue: 0, saturation: 0, lightness: 1 },
  'blue-shift': { hue: 70, saturation: 1, lightness: 1 },
};

export function recolourPalette(palette: readonly string[], op: Recolour): string[] {
  return palette.map((c, i) => {
    if (i === 0) return c;
    let r = parseInt(c.slice(1, 3), 16);
    let g = parseInt(c.slice(3, 5), 16);
    let b = parseInt(c.slice(5, 7), 16);
    const a = parseInt(c.slice(7, 9), 16);
    const swapped = op.swap?.[c.slice(0, 7).toLowerCase()];
    if (swapped) {
      r = parseInt(swapped.slice(1, 3), 16);
      g = parseInt(swapped.slice(3, 5), 16);
      b = parseInt(swapped.slice(5, 7), 16);
    }
    let [h, s, l] = toHsl(r, g, b);
    h += op.hue;
    s = Math.max(0, Math.min(1, s * op.saturation));
    l = Math.max(0, Math.min(1, l * op.lightness));
    [r, g, b] = fromHsl(h, s, l);
    if (op.tint) {
      const t = op.tint.colour;
      const k = op.tint.strength;
      r = r * (1 - k) + parseInt(t.slice(1, 3), 16) * k;
      g = g * (1 - k) + parseInt(t.slice(3, 5), 16) * k;
      b = b * (1 - k) + parseInt(t.slice(5, 7), 16) * k;
    }
    return hex(r, g, b, a);
  });
}

/** A recoloured copy of a sprite (every frame, since they share a palette). */
export function recolourSprite(sprite: SpriteData, op: Recolour, name: string): SpriteData {
  return { ...structuredClone(sprite), name, palette: recolourPalette(sprite.palette, op) };
}

/** Light and shadow for the three faces of a block: the left face a little darker than the top, the right darker still. */
export function shadeFaces(img: Rgba, iso: IsoSize, levels: number, amounts = { top: 1, left: 0.8, right: 0.62 }): Rgba {
  const out: Rgba = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const guides = blockGuides(iso, levels);
  const k = [amounts.top, amounts.left, amounts.right];
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      const p: Pt = [x + 0.5, y + 0.5];
      const f = guides.findIndex((g) => inside(p, g.points));
      if (f < 0) continue;
      const i = (y * img.width + x) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = Math.round(out.data[i + c]! * k[f]!);
    }
  }
  return out;
}

// ---------- slicing ----------

export interface Grid {
  tileW: number;
  tileH: number;
  /** Space left of and above the first tile. */
  offsetX: number;
  offsetY: number;
  /** Space between tiles. */
  gapX: number;
  gapY: number;
}

/** The tiles of a tile sheet, row by row, without the empty ones. */
export function sliceSheet(img: Rgba, grid: Grid): { x: number; y: number; img: Rgba }[] {
  const out: { x: number; y: number; img: Rgba }[] = [];
  if (grid.tileW < 1 || grid.tileH < 1) return out;
  for (let y = grid.offsetY, row = 0; y + grid.tileH <= img.height; y += grid.tileH + grid.gapY, row++) {
    for (let x = grid.offsetX, col = 0; x + grid.tileW <= img.width; x += grid.tileW + grid.gapX, col++) {
      const t = crop(img, x, y, grid.tileW, grid.tileH);
      if (!isEmpty(t)) out.push({ x: col, y: row, img: t });
    }
  }
  return out;
}

/** Tiles laid side by side in a sheet (the opposite of slicing), `columns` across. */
export function packSheet(tiles: readonly Rgba[], columns: number, gap = 0): Rgba {
  if (tiles.length === 0) return blankRgba(1, 1);
  const tw = Math.max(...tiles.map((t) => t.width));
  const th = Math.max(...tiles.map((t) => t.height));
  const cols = Math.max(1, Math.min(columns, tiles.length));
  const rows = Math.ceil(tiles.length / cols);
  const out = blankRgba(cols * tw + (cols - 1) * gap, rows * th + (rows - 1) * gap);
  tiles.forEach((t, i) => {
    const ox = (i % cols) * (tw + gap);
    const oy = Math.floor(i / cols) * (th + gap);
    for (let y = 0; y < t.height; y++) {
      for (let x = 0; x < t.width; x++) {
        const s = (y * t.width + x) * 4;
        out.data.set(t.data.subarray(s, s + 4), ((oy + y) * out.width + ox + x) * 4);
      }
    }
  });
  return out;
}

// ---------- edges (a starter set from one tile) ----------

const parseHex = (c: string): [number, number, number] => [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];

export interface EdgeBrush {
  colour: string;
  /** Width in picture pixels. */
  width: number;
  /** 0 = hard line, 1 = soft fade. */
  soften: number;
}

/**
 * Draw the edge of a terrain on a flat floor tile: a band along each side that borders something else (`sides`: letters of the
 * grid directions N E S W), and a corner mark where only the diagonal does (`corners`: NE SE SW NW). The sides are the ones of
 * the cell in the grid, so N is the upper right edge of the diamond in the picture.
 */
export function drawEdges(base: Rgba, sides: readonly string[], corners: readonly string[], brush: EdgeBrush): Rgba {
  const w = base.width;
  const h = base.height;
  const out: Rgba = { width: w, height: h, data: new Uint8ClampedArray(base.data) };
  const [er, eg, eb] = parseHex(brush.colour);
  // grid coordinates of the cell: fx along x (east), fy along y (south); the diamond's top vertex is (0, 0)
  const bandX = brush.width / (w / 2) / 2;
  const bandY = brush.width / (h / 2) / 2;
  const band = (bandX + bandY) / 2;
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const i = (py * w + px) * 4;
      if (out.data[i + 3] === 0) continue;
      const cx = (px + 0.5 - w / 2) / (w / 2);
      const cy = (py + 0.5) / (h / 2);
      const fx = (cx + cy) / 2;
      const fy = (cy - cx) / 2;
      // how far inside each side the pixel is, as a fraction of the band (0 = on the edge)
      let strength = 0;
      const dist = { N: fy, E: 1 - fx, S: 1 - fy, W: fx } as Record<string, number>;
      for (const s of sides) {
        const d = dist[s]!;
        if (d < band) strength = Math.max(strength, 1 - (d / band) * brush.soften);
      }
      for (const c of corners) {
        const [a, b] = [c[0]!, c[1]!];
        const d = Math.hypot(dist[a]!, dist[b]!);
        if (d < band * 1.6) strength = Math.max(strength, 1 - (d / (band * 1.6)) * Math.max(0.3, brush.soften));
      }
      if (strength <= 0) continue;
      out.data[i] = Math.round(out.data[i]! * (1 - strength) + er * strength);
      out.data[i + 1] = Math.round(out.data[i + 1]! * (1 - strength) + eg * strength);
      out.data[i + 2] = Math.round(out.data[i + 2]! * (1 - strength) + eb * strength);
    }
  }
  return out;
}

// ---------- the 47 pieces of an edge set ----------

export interface BlobSlot {
  id: string;
  label: string;
  /** Eight characters for N NE E SE S SW W NW: 1 the same terrain, 0 something else, * does not matter. */
  pattern: string;
  /** Sides that border something else (letters N E S W). */
  sides: string[];
  /** Corners that border something else while both their sides do not. */
  corners: string[];
}

const SIDE_BITS = ['N', 'E', 'S', 'W'] as const;
const NEIGHBOURS = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'] as const;

/** Every distinct way the eight neighbours of a tile can matter: 47 of them. */
export function blobSlots(): BlobSlot[] {
  const seen = new Map<string, BlobSlot>();
  for (let mask = 0; mask < 256; mask++) {
    const same = NEIGHBOURS.map((_, i) => (mask >> i) & 1);
    const at = (name: string): number => same[NEIGHBOURS.indexOf(name as (typeof NEIGHBOURS)[number])]!;
    const chars = NEIGHBOURS.map((n, i) => {
      if (n.length === 1) return String(same[i]);
      // a diagonal only matters when both its sides are the same terrain
      return at(n[0]!) === 1 && at(n[1]!) === 1 ? String(same[i]) : '*';
    });
    const pattern = chars.join('');
    if (seen.has(pattern)) continue;
    const sides = SIDE_BITS.filter((s) => at(s) === 0);
    const corners = (['NE', 'SE', 'SW', 'NW'] as const).filter((c) => at(c[0]!) === 1 && at(c[1]!) === 1 && at(c) === 0);
    const id = sides.length === 0 && corners.length === 0 ? 'centre' : [sides.length ? `edge-${sides.join('')}` : '', corners.length ? `inner-${corners.join('-')}` : ''].filter(Boolean).join('+');
    const label = sides.length === 0 && corners.length === 0 ? 'Centre (surrounded)' : [sides.length ? `Edge ${sides.join('')}` : '', corners.length ? `inner corner ${corners.join(', ')}` : ''].filter(Boolean).join(' with ');
    seen.set(pattern, { id, label, pattern, sides, corners });
  }
  return [...seen.values()];
}

/** The autotile rules that choose each piece of an edge set for a base tile. `tileOf` gives the tile id of a piece. */
export function blobRules(baseTile: number, set: string, slots: readonly BlobSlot[], tileOf: (slotId: string) => number): AutotileRuleData[] {
  return slots
    .filter((s) => s.id !== 'centre')
    .map((s) => ({ id: `${set}-${s.id}`, name: `${set}: ${s.label}`, base: baseTile, pattern: s.pattern, result: tileOf(s.id) }));
}

export { decodeRle, wallGuides, wallSize };
