import { compositeFrame, type SpriteData } from '@tilewright/runtime';
import { blankRgba, clipTo, crop, isEmpty, shadeFaces, type Rgba } from './pixels';
import type { IsoSize } from './presets';
import { tileTemplate, type TileKind, type TileTemplate } from './make-tile';

/**
 * Taking a picture made elsewhere (a picture provider's answer, a tile sheet from an artist) and making it a tile of this project:
 * cut it into tiles, fit each to the project's isometric template (the diamond of a floor tile, the three faces of a block), and
 * bring its colours to the project's palette so it sits with the art that is already there. Pure.
 *
 * Two kinds of picture arrive. A *texture* is flat and seen from above (grass, stone, water: a square picture): it is laid on the
 * diamond, and for a block on all three faces, shaded. A *picture* already has the isometric angle (a tile or a block drawn in
 * perspective): its background is taken away, it is cut to its edges and fitted to the template.
 */

export type TileSource = 'texture' | 'picture';

export interface ImportOptions {
  iso: IsoSize;
  kind: TileKind;
  levels?: number;
  source: TileSource;
  /** A sheet of tiles: how many across and down (default one tile). */
  columns?: number;
  rows?: number;
  /** Colours to bring the tiles to ("#rrggbbaa"), most important first. Missing: the tiles are reduced to `maxColours`. */
  palette?: readonly string[] | undefined;
  maxColours?: number;
  /** Take away the background of a picture (the colour of its corners). Default true for a picture. */
  removeBackground?: boolean;
}

export interface ImportedTile {
  col: number;
  row: number;
  /** The tile at the template's size, with the project's palette. */
  img: Rgba;
}

export interface ImportResult {
  tiles: ImportedTile[];
  template: TileTemplate;
  notes: string[];
}

// ---------- pixels ----------

/** Resize to exactly w x h: average the pixels that fall in each new one when it gets smaller, nearest when it gets bigger. */
export function resize(img: Rgba, w: number, h: number): Rgba {
  const out = blankRgba(w, h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor((y * img.height) / h);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * img.height) / h));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor((x * img.width) / w);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * img.width) / w));
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      let n = 0;
      for (let yy = y0; yy < Math.min(y1, img.height); yy++) {
        for (let xx = x0; xx < Math.min(x1, img.width); xx++) {
          const i = (yy * img.width + xx) * 4;
          const al = img.data[i + 3]!;
          r += img.data[i]! * al;
          g += img.data[i + 1]! * al;
          b += img.data[i + 2]! * al;
          a += al;
          n++;
        }
      }
      const o = (y * w + x) * 4;
      if (a > 0) {
        out.data[o] = r / a;
        out.data[o + 1] = g / a;
        out.data[o + 2] = b / a;
      }
      out.data[o + 3] = n > 0 ? a / n : 0;
    }
  }
  return out;
}

/** The part of the picture with something in it. */
export function trim(img: Rgba): Rgba {
  let x0 = img.width;
  let y0 = img.height;
  let x1 = -1;
  let y1 = -1;
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3]! > 8) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x);
        y1 = Math.max(y1, y);
      }
    }
  }
  return x1 < 0 ? img : crop(img, x0, y0, x1 - x0 + 1, y1 - y0 + 1);
}

/** Make the background see-through: the colour of the corners, spreading in from the edge over pixels close to it. */
export function removeBackground(img: Rgba, tolerance = 28): Rgba {
  const out: Rgba = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const at = (x: number, y: number): number => (y * img.width + x) * 4;
  const corners = [at(0, 0), at(img.width - 1, 0), at(0, img.height - 1), at(img.width - 1, img.height - 1)];
  // a picture that already has a see-through edge needs nothing done
  if (corners.every((c) => img.data[c + 3]! < 8)) return out;
  const key = [0, 1, 2].map((c) => Math.round(corners.reduce((s, i) => s + img.data[i + c]!, 0) / 4));
  const close = (i: number): boolean => Math.abs(img.data[i]! - key[0]!) + Math.abs(img.data[i + 1]! - key[1]!) + Math.abs(img.data[i + 2]! - key[2]!) <= tolerance * 3;
  // the corners must agree with each other, or there is no plain background to take away
  if (!corners.every(close)) return out;
  const seen = new Uint8Array(img.width * img.height);
  const stack: number[] = [];
  const push = (x: number, y: number): void => {
    if (x < 0 || y < 0 || x >= img.width || y >= img.height || seen[y * img.width + x]) return;
    seen[y * img.width + x] = 1;
    if (close(at(x, y))) stack.push(y * img.width + x);
  };
  for (let x = 0; x < img.width; x++) {
    push(x, 0);
    push(x, img.height - 1);
  }
  for (let y = 0; y < img.height; y++) {
    push(0, y);
    push(img.width - 1, y);
  }
  while (stack.length > 0) {
    const p = stack.pop()!;
    out.data[p * 4 + 3] = 0;
    const x = p % img.width;
    const y = Math.floor(p / img.width);
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }
  return out;
}

/** Sample a picture at (u, v) in 0..1 (nearest pixel). */
function sample(img: Rgba, u: number, v: number): [number, number, number, number] {
  const x = Math.min(img.width - 1, Math.max(0, Math.floor(u * img.width)));
  const y = Math.min(img.height - 1, Math.max(0, Math.floor(v * img.height)));
  const i = (y * img.width + x) * 4;
  return [img.data[i]!, img.data[i + 1]!, img.data[i + 2]!, img.data[i + 3]!];
}

/** A flat picture laid on the floor diamond (rotated a quarter turn and squashed to the diamond's shape). */
function onDiamond(tex: Rgba, w: number, h: number, out: Rgba, atY = 0): void {
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const a = (x + 0.5) / (w / 2);
      const b = (y + 0.5) / (h / 2);
      const gx = (a + b - 1) / 2;
      const gy = (b - a + 1) / 2;
      if (gx < 0 || gx > 1 || gy < 0 || gy > 1) continue;
      out.data.set(sample(tex, gx, gy), ((y + atY) * out.width + x) * 4);
    }
  }
}

/** A flat picture laid on a block: the top as above, the two sides as the same picture slanted and made darker. */
function onBlock(tex: Rgba, iso: IsoSize, levels: number, out: Rgba): void {
  const w = iso.tileW;
  const h = iso.tileH;
  const H = Math.round(levels * iso.heightPx);
  onDiamond(tex, w, h, out);
  for (let x = 0; x < w / 2; x++) {
    const u = (x + 0.5) / (w / 2);
    for (let y = 0; y < out.height; y++) {
      // left face: its top edge runs from (0, h/2) down to (w/2, h)
      const top = h / 2 + u * (h / 2);
      const v = (y + 0.5 - top) / H;
      if (v >= 0 && v <= 1) out.data.set(sample(tex, u, v), (y * out.width + x) * 4);
      // right face: its top edge runs from (w/2, h) up to (w, h/2)
      const rx = w / 2 + x;
      const rtop = h - u * (h / 2);
      const rv = (y + 0.5 - rtop) / H;
      if (rv >= 0 && rv <= 1) out.data.set(sample(tex, 1 - u, rv), (y * out.width + rx) * 4);
    }
  }
}

// ---------- palette ----------

const hexRgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

/** Bring every visible pixel to the nearest colour of the palette. */
export function snapColours(img: Rgba, palette: readonly string[]): Rgba {
  const cols = palette.map(hexRgb);
  if (cols.length === 0) return img;
  const out: Rgba = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
  const cache = new Map<number, number>();
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i + 3]! < 128) {
      out.data[i + 3] = 0;
      continue;
    }
    const key = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!;
    let best = cache.get(key);
    if (best === undefined) {
      let d = Infinity;
      best = 0;
      cols.forEach((c, p) => {
        const dist = 2 * (c[0] - img.data[i]!) ** 2 + 4 * (c[1] - img.data[i + 1]!) ** 2 + 3 * (c[2] - img.data[i + 2]!) ** 2;
        if (dist < d) {
          d = dist;
          best = p;
        }
      });
      cache.set(key, best);
    }
    const c = cols[best]!;
    out.data[i] = c[0];
    out.data[i + 1] = c[1];
    out.data[i + 2] = c[2];
    out.data[i + 3] = 255;
  }
  return out;
}

/** A palette of `k` colours that stands for the colours of these pictures (median cut: split the biggest range at its middle, again and again). */
export function quantize(imgs: readonly Rgba[], k: number): string[] {
  const counts = new Map<number, number>();
  for (const img of imgs) {
    for (let i = 0; i < img.data.length; i += 4) {
      if (img.data[i + 3]! < 128) continue;
      const c = (img.data[i]! << 16) | (img.data[i + 1]! << 8) | img.data[i + 2]!;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  type Box = { colours: [number, number][] };
  const channel = (c: number, ch: number): number => (c >> (16 - ch * 8)) & 255;
  const range = (b: Box, ch: number): number => {
    let lo = 255;
    let hi = 0;
    for (const [c] of b.colours) {
      lo = Math.min(lo, channel(c, ch));
      hi = Math.max(hi, channel(c, ch));
    }
    return hi - lo;
  };
  const boxes: Box[] = [{ colours: [...counts.entries()] }];
  while (boxes.length < k) {
    boxes.sort((a, b) => Math.max(range(b, 0), range(b, 1), range(b, 2)) - Math.max(range(a, 0), range(a, 1), range(a, 2)));
    const box = boxes[0]!;
    if (box.colours.length < 2) break;
    const ch = [0, 1, 2].sort((p, q) => range(box, q) - range(box, p))[0]!;
    box.colours.sort((a, b) => channel(a[0], ch) - channel(b[0], ch));
    const total = box.colours.reduce((s, [, n]) => s + n, 0);
    let run = 0;
    let at = 1;
    for (let i = 0; i < box.colours.length - 1; i++) {
      run += box.colours[i]![1];
      at = i + 1;
      if (run >= total / 2) break;
    }
    boxes.splice(0, 1, { colours: box.colours.slice(0, at) }, { colours: box.colours.slice(at) });
  }
  return boxes
    .filter((b) => b.colours.length > 0)
    .map((b) => {
      const total = b.colours.reduce((s, [, n]) => s + n, 0);
      const mean = (ch: number): number => Math.round(b.colours.reduce((s, [c, n]) => s + channel(c, ch) * n, 0) / total);
      return `#${[0, 1, 2].map((ch) => mean(ch).toString(16).padStart(2, '0')).join('')}ff`;
    });
}

// ---------- the whole job ----------

/** Cut a sheet into `columns` x `rows` equal pieces, leaving out the empty ones. */
export function cutSheet(img: Rgba, columns: number, rows: number): { col: number; row: number; img: Rgba }[] {
  const tw = Math.floor(img.width / columns);
  const th = Math.floor(img.height / rows);
  const out: { col: number; row: number; img: Rgba }[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const piece = crop(img, c * tw, r * th, tw, th);
      if (!isEmpty(piece)) out.push({ col: c, row: r, img: piece });
    }
  }
  return out;
}

/** A picture that already has the isometric angle: its background taken away, trimmed, made to fit the template and cut to its faces. */
function fitPicture(piece: Rgba, t: TileTemplate, clearBackground: boolean): Rgba {
  const cut = trim(clearBackground ? removeBackground(piece) : piece);
  const scale = Math.min(t.width / cut.width, t.height / cut.height);
  const w = Math.max(1, Math.round(cut.width * scale));
  const h = Math.max(1, Math.round(cut.height * scale));
  const small = resize(cut, w, h);
  const out = blankRgba(t.width, t.height);
  const ox = Math.floor((t.width - w) / 2);
  const oy = t.kind === 'block' ? t.height - h : Math.floor((t.height - h) / 2);
  for (let y = 0; y < h; y++) out.data.set(small.data.subarray(y * w * 4, (y + 1) * w * 4), ((y + oy) * t.width + ox) * 4);
  return clipTo(out, t.guides.map((g) => g.points));
}

export function importTiles(img: Rgba, opts: ImportOptions): ImportResult {
  const template = tileTemplate(opts.iso, opts.kind, opts.levels ?? 1);
  const columns = Math.max(1, Math.min(16, Math.round(opts.columns ?? 1)));
  const rows = Math.max(1, Math.min(16, Math.round(opts.rows ?? 1)));
  const notes: string[] = [];
  const pieces = columns * rows > 1 ? cutSheet(img, columns, rows) : [{ col: 0, row: 0, img }];
  if (pieces.length === 0) return { tiles: [], template, notes: ['The picture is empty: there was nothing to cut into tiles.'] };
  if (columns * rows > 1) notes.push(`Cut into ${columns} x ${rows}: ${pieces.length} tile${pieces.length === 1 ? '' : 's'}${pieces.length < columns * rows ? ` (${columns * rows - pieces.length} empty piece${columns * rows - pieces.length === 1 ? ' was' : 's were'} left out)` : ''}.`);
  const clearBackground = opts.removeBackground ?? opts.source === 'picture';
  let made = pieces.map((p) => {
    let out: Rgba;
    if (opts.source === 'texture') {
      out = blankRgba(template.width, template.height);
      if (template.kind === 'floor') onDiamond(p.img, template.width, template.height, out);
      else {
        onBlock(p.img, opts.iso, template.levels, out);
        out = shadeFaces(out, opts.iso, template.levels);
      }
    } else out = fitPicture(p.img, template, clearBackground);
    return { col: p.col, row: p.row, img: out };
  });
  notes.push(opts.source === 'texture' ? `Laid on the ${template.kind === 'floor' ? 'floor diamond' : 'three faces of a block'} (${template.width} x ${template.height}) as a flat texture seen from above${template.kind === 'block' ? ', the sides darker' : ''}.` : `Fitted to the ${template.kind === 'floor' ? 'floor tile' : 'block'} template (${template.width} x ${template.height})${clearBackground ? ' after taking away the background' : ''}, and cut to its edges.`);
  // the colours: the project's own, or one shared small set so a sheet is consistent
  const palette = opts.palette && opts.palette.length > 0 ? [...opts.palette] : quantize(made.map((m) => m.img), Math.max(2, Math.min(64, opts.maxColours ?? 24)));
  made = made.map((m) => ({ ...m, img: snapColours(m.img, palette) }));
  notes.push(opts.palette && opts.palette.length > 0 ? `Colours matched to the ${palette.length} colours the project's tiles already use.` : `Colours reduced to ${palette.length} (the project has no tile art yet to match).`);
  return { tiles: made, template, notes };
}

/**
 * The colours the project's tile art uses most (from its tile, wall and cliff sprites; every sprite when there are none), most used
 * first: what new tiles are matched to so they sit with the old ones.
 */
export function projectPalette(sprites: Iterable<SpriteData>, max = 32): string[] {
  const all = [...sprites];
  const art = all.filter((s) => s.meta && ['tile', 'wall', 'cliff'].includes(s.meta.kind));
  const counts = new Map<number, number>();
  for (const s of (art.length > 0 ? art : all).slice(0, 80)) {
    const data = compositeFrame(s, 0);
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3]! < 128) continue;
      const c = (data[i]! << 16) | (data[i + 1]! << 8) | data[i + 2]!;
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0] - b[0])
    .slice(0, max)
    .map(([c]) => `#${c.toString(16).padStart(6, '0')}ff`);
}
