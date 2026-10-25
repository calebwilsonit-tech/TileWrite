import {
  SPRITE_SCHEMA_VERSION,
  SpriteSchema,
  VectorShapeSchema,
  celFor,
  encodeRle,
  floodPoints,
  indexImage,
  newCel,
  newSprite,
  rasterizeShapes,
  setPixel,
  shapeProblems,
  type Cel,
  type SpriteData,
  type VectorShape,
} from '@tilewright/runtime';
import type { Raster } from './pictures';

/**
 * How Claude draws. A drawing is a palette and layers; each layer is rows of characters (pixels), shapes that stay editable in
 * the studio (rectangles, ellipses and paths, with fills and outlines in palette colours), or an SVG that is turned into pixels
 * and snapped to the palette. Flood fills can be added to a pixel layer. This turns that description into a sprite file. Pure:
 * an SVG is drawn by the window and handed in.
 */

export interface DrawShape {
  type: 'rect' | 'ellipse' | 'path';
  [key: string]: unknown;
}

export interface DrawLayer {
  name: string;
  /** Pixels: one text row per row of the picture ("." is clear, "1" the first palette colour...). */
  rows?: string[] | undefined;
  /** Editable shapes (they are drawn into the layer's pixels too). */
  shapes?: DrawShape[] | undefined;
  /** Flood fills, applied after the rows: fill the area around a pixel with a colour. */
  fills?: { x: number; y: number; color: number }[] | undefined;
  /** A drawing in SVG (needs a window to draw it). */
  svg?: string | undefined;
}

export interface DrawSpec {
  name: string;
  width: number;
  height: number;
  /** "#rrggbb" or "#rrggbbaa" (index 0 of the sprite is always clear). Missing: made from the SVG layers. */
  palette?: string[] | undefined;
  /** The first frame as rows (kept from when this was all a drawing tool did): it becomes a layer called "Pixels", below the others. */
  rows?: string[] | undefined;
  /** Further frames of the "Pixels" layer (an animation). */
  moreFrames?: string[][] | undefined;
  layers?: DrawLayer[] | undefined;
  frameMs?: number | undefined;
}

export class DrawProblem extends Error {}

const CHARS = '0123456789abcdefghijklmnopqrstuvwxyz';

/** "#rrggbb" or "#rrggbbaa" as the palette's "#rrggbbaa". */
export const withAlpha = (hex: string): string => (hex.length === 7 ? `${hex.toLowerCase()}ff` : hex.toLowerCase());

/** Rows of characters as palette indices. Every mistake says which row and what to do. */
export function indicesOf(rows: readonly string[], width: number, height: number, colours: number, label: string): Uint8Array {
  if (rows.length !== height) throw new DrawProblem(`${label} has ${rows.length} rows but the picture is ${height} high. Give exactly ${height} rows.`);
  const out = new Uint8Array(width * height);
  rows.forEach((row, y) => {
    if (row.length !== width) throw new DrawProblem(`${label}, row ${y + 1} is ${row.length} characters long but the picture is ${width} wide ("${row.slice(0, 40)}"). Every row must be exactly ${width} characters.`);
    [...row].forEach((ch, x) => {
      if (ch === '.' || ch === ' ') return;
      const i = CHARS.indexOf(ch.toLowerCase());
      if (i < 1 || i > colours) throw new DrawProblem(`${label}, row ${y + 1}, column ${x + 1}: "${ch}" is not "." or one of the ${colours} palette colours (1 to ${CHARS[colours]}).`);
      out[y * width + x] = i;
    });
  });
  return out;
}

/**
 * An SVG made to draw at exactly w x h: its width and height are set to that, and when it has no viewBox the size it had (or w x h)
 * becomes its viewBox, so it is scaled and not cut.
 */
export function fitSvgTo(svg: string, w: number, h: number): string {
  const found = /<svg\b[^>]*>/.exec(svg);
  if (!found) throw new DrawProblem('The svg has no <svg> element.');
  let tag = found[0];
  const size = (name: string): number => Number(new RegExp('\\s' + name + '\\s*=\\s*["\']\\s*([0-9.]+)').exec(tag)?.[1] ?? 0);
  const box = /\sviewBox\s*=/.test(tag) ? '' : ` viewBox="0 0 ${size('width') || w} ${size('height') || h}"`;
  tag = tag.replace(/\s(width|height)\s*=\s*("[^"]*"|'[^']*')/g, '');
  const ns = /\sxmlns\s*=/.test(tag) ? '' : ' xmlns="http://www.w3.org/2000/svg"';
  tag = tag.replace(/<svg\b/, `<svg width="${w}" height="${h}"${box}${ns}`);
  return svg.replace(found[0], () => tag);
}

/** The nearest palette colour (never the clear one) for each pixel of a picture; pixels that are mostly clear stay clear. */
export function snapToPalette(r: Raster, palette: readonly string[]): Uint8Array {
  const colours = palette.map((p) => [parseInt(p.slice(1, 3), 16), parseInt(p.slice(3, 5), 16), parseInt(p.slice(5, 7), 16)] as const);
  const out = new Uint8Array(r.width * r.height);
  const cache = new Map<number, number>();
  for (let i = 0; i < out.length; i++) {
    if (r.rgba[i * 4 + 3]! < 128) continue;
    const key = (r.rgba[i * 4]! << 16) | (r.rgba[i * 4 + 1]! << 8) | r.rgba[i * 4 + 2]!;
    let best = cache.get(key);
    if (best === undefined) {
      let d = Infinity;
      best = 1;
      for (let p = 1; p < colours.length; p++) {
        const c = colours[p]!;
        // a little weight to green, as the eye has it
        const dist = 2 * (c[0] - r.rgba[i * 4]!) ** 2 + 4 * (c[1] - r.rgba[i * 4 + 1]!) ** 2 + 3 * (c[2] - r.rgba[i * 4 + 2]!) ** 2;
        if (dist < d) {
          d = dist;
          best = p;
        }
      }
      cache.set(key, best);
    }
    out[i] = best;
  }
  return out;
}

function shapesOf(layer: DrawLayer, palette: readonly string[]): VectorShape[] {
  const shapes: VectorShape[] = [];
  (layer.shapes ?? []).forEach((s, i) => {
    const r = VectorShapeSchema.safeParse(s);
    if (!r.success) throw new DrawProblem(`Layer "${layer.name}", shape ${i + 1} (${String(s.type)}) is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}${r.error.issues[0]?.path.length ? ` at "${r.error.issues[0].path.join('.')}"` : ''}.`);
    shapes.push(r.data);
  });
  const problems = shapeProblems(shapes, palette.length);
  if (problems.length > 0) throw new DrawProblem(`Layer "${layer.name}": ${problems[0]} The palette has ${palette.length - 1} colours (1 to ${palette.length - 1}).`);
  return shapes;
}

/** The sprite a drawing describes. `rasters` holds the SVG layers as pictures (by layer number), drawn at the sprite's size. */
export function buildSprite(spec: DrawSpec, rasters: ReadonlyMap<number, Raster> = new Map()): { sprite: SpriteData; notes: string[] } {
  const { width, height } = spec;
  const layers = spec.layers ?? [];
  if (!spec.rows && layers.length === 0) throw new DrawProblem('Give the drawing: "rows" (pixels), or "layers" with rows, shapes or an svg.');
  const notes: string[] = [];
  const palette = ['#00000000', ...(spec.palette ?? []).map(withAlpha)];
  const sprite = newSprite(spec.name, width, height);
  sprite.palette = palette;
  sprite.layers = [];
  const frames = [spec.rows, ...(spec.moreFrames ?? [])].filter((f): f is string[] => f !== undefined);
  sprite.frames = Array.from({ length: Math.max(1, frames.length) }, () => ({ duration: spec.frameMs ?? 120, cels: {} as Record<string, string>, boxes: [] as never[] }));
  let n = 0;
  const nextId = (): string => `l${++n}`;

  if (spec.rows) {
    const id = nextId();
    sprite.layers.push({ id, name: 'Pixels', visible: true });
    frames.forEach((rows, i) => {
      sprite.frames[i]!.cels[id] = encodeRle(indicesOf(rows, width, height, palette.length - 1, i === 0 ? 'The first frame' : `Frame ${i + 1}`));
    });
  } else if (spec.moreFrames && spec.moreFrames.length > 0) {
    throw new DrawProblem('"moreFrames" are further frames of "rows": give "rows" too.');
  }

  layers.forEach((layer, li) => {
    const kinds = [layer.rows ? 'rows' : '', layer.shapes ? 'shapes' : '', layer.svg ? 'svg' : ''].filter(Boolean);
    if (kinds.length > 1) throw new DrawProblem(`Layer "${layer.name}" has ${kinds.join(' and ')}. A layer is one of: rows, shapes, svg (flood fills can go with rows, or alone on an empty layer).`);
    if (kinds.length === 0 && !layer.fills) throw new DrawProblem(`Layer "${layer.name}" is empty: give rows, shapes, an svg or fills.`);
    const id = nextId();
    if (layer.shapes) {
      const shapes = shapesOf(layer, palette);
      sprite.layers.push({ id, name: layer.name, visible: true, kind: 'vector' });
      sprite.frames[0]!.cels[id] = encodeRle(rasterizeShapes(shapes, width, height));
      (sprite.frames[0] as { vectors?: Record<string, VectorShape[]> }).vectors = { ...((sprite.frames[0] as { vectors?: Record<string, VectorShape[]> }).vectors ?? {}), [id]: shapes };
      return;
    }
    let cel: Cel;
    if (layer.svg) {
      const r = rasters.get(li);
      if (!r) throw new DrawProblem(`Layer "${layer.name}": the SVG could not be drawn here.`);
      if (!spec.palette) {
        // no palette given: the colours of the drawing become the palette
        const made = indexImage(r.rgba, sprite.palette, 64);
        sprite.palette = made.palette;
        cel = made.indices;
        if (made.approximated > 0) notes.push(`The SVG had more than 63 colours; ${made.approximated} pixels were matched to the nearest.`);
      } else cel = snapToPalette(r, sprite.palette);
    } else if (layer.rows) cel = indicesOf(layer.rows, width, height, sprite.palette.length - 1, `Layer "${layer.name}"`);
    else cel = newCel(width, height);
    for (const f of layer.fills ?? []) {
      if (f.x < 0 || f.y < 0 || f.x >= width || f.y >= height) throw new DrawProblem(`Layer "${layer.name}": a fill at (${f.x}, ${f.y}) is outside the ${width} x ${height} picture.`);
      if (f.color < 0 || f.color >= sprite.palette.length) throw new DrawProblem(`Layer "${layer.name}": a fill uses colour ${f.color}, but the palette has ${sprite.palette.length - 1} colours.`);
      for (const p of floodPoints(cel, { w: width, h: height }, { x: f.x, y: f.y })) setPixel(cel, { w: width, h: height }, p.x, p.y, f.color);
    }
    sprite.layers.push({ id, name: layer.name, visible: true });
    sprite.frames[0]!.cels[id] = encodeRle(cel);
  });

  sprite.origin = { x: Math.floor(width / 2), y: height - 1 };
  if (sprite.frames.length > 1) sprite.clips = [{ name: 'idle', loop: true, mirror: false, all: sprite.frames.map((_f, i) => i), dirs: {}, events: [] }];
  if (sprite.layers.length === 0) throw new DrawProblem('Nothing was drawn.');
  sprite.schemaVersion = SPRITE_SCHEMA_VERSION;
  const checked = SpriteSchema.safeParse(sprite);
  if (!checked.success) throw new DrawProblem(`The drawing is not a valid sprite: ${checked.error.issues[0]?.message ?? 'unknown problem'}.`);
  const unused = (spec.palette ?? []).filter((_c, i) => !usesColour(sprite, i + 1));
  if (unused.length > 0) notes.push(`${unused.length} colour${unused.length === 1 ? '' : 's'} in the palette ${unused.length === 1 ? 'is' : 'are'} not used.`);
  return { sprite: checked.data, notes };
}

function usesColour(s: SpriteData, index: number): boolean {
  for (let f = 0; f < s.frames.length; f++) {
    for (const l of s.layers) {
      const cel = celFor(s, f, l.id);
      for (let i = 0; i < cel.length; i++) if (cel[i] === index) return true;
    }
  }
  return false;
}
