import { type ShapeData, type SpriteData } from './format';
import { ellipsePoints, isoBoxFaces, newCel, polygonPoints, setPixel, type Cel, type Pt } from './raster';
import { encodeRle } from './rle';

/** Pixels per half-cell: matches the game's 64 x 32 tiles, so shapes drawn at 1 cell are 1 cell in the game. */
export const PROCEDURAL_S = 32;

/** Darker shades of an 0xRRGGBB colour for the sides of a shape. */
function shadeColor(color: number, f: number): number {
  const r = Math.min(255, Math.round(((color >> 16) & 255) * f));
  const g = Math.min(255, Math.round(((color >> 8) & 255) * f));
  const b = Math.min(255, Math.round((color & 255) * f));
  return (r << 16) | (g << 8) | b;
}

/** Find or add an opaque colour in the palette; returns its index (or the nearest if the palette is full). */
export function paletteIndexFor(palette: string[], color: number): number {
  const hex = `#${color.toString(16).padStart(6, '0')}ff`;
  const found = palette.findIndex((c, i) => i > 0 && c.toLowerCase() === hex);
  if (found > 0) return found;
  if (palette.length < 256) {
    palette.push(hex);
    return palette.length - 1;
  }
  let best = 1;
  let bestD = Infinity;
  for (let i = 1; i < palette.length; i++) {
    const c = palette[i]!;
    const d = (parseInt(c.slice(1, 3), 16) - ((color >> 16) & 255)) ** 2 + (parseInt(c.slice(3, 5), 16) - ((color >> 8) & 255)) ** 2 + (parseInt(c.slice(5, 7), 16) - (color & 255)) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/** Rasterise one parametric shape into a cel (shapes sit on the sprite origin; `x`,`y` are pixel offsets). */
export function drawShape(cel: Cel, sprite: Pick<SpriteData, 'width' | 'height' | 'origin' | 'palette'>, shape: ShapeData): void {
  const size = { w: sprite.width, h: sprite.height };
  const cx = sprite.origin.x + shape.x;
  const cy = sprite.origin.y + shape.y;
  const top = paletteIndexFor(sprite.palette as string[], shape.color);
  const left = paletteIndexFor(sprite.palette as string[], shadeColor(shape.color, 0.72));
  const right = paletteIndexFor(sprite.palette as string[], shadeColor(shape.color, 0.52));
  const fill = (pts: Pt[], v: number): void => {
    for (const p of pts) setPixel(cel, size, p.x, p.y, v);
  };
  if (shape.type === 'box') {
    const f = isoBoxFaces({ cx, cy, w: shape.w, d: shape.d, h: shape.h, s: PROCEDURAL_S });
    fill(polygonPoints(f.left), left);
    fill(polygonPoints(f.right), right);
    fill(polygonPoints(f.top), top);
  } else if (shape.type === 'diamond') {
    const f = isoBoxFaces({ cx, cy, w: shape.w, d: shape.d, h: shape.h, s: PROCEDURAL_S });
    fill(polygonPoints(f.top), top);
  } else if (shape.type === 'ellipse') {
    const rx = Math.max(1, Math.round(((shape.w + shape.d) * PROCEDURAL_S) / 2));
    const ry = Math.max(1, Math.round(shape.h));
    fill(ellipsePoints({ x: Math.round(cx - rx / 2), y: Math.round(cy - ry) }, { x: Math.round(cx + rx / 2), y: Math.round(cy) }, true), top);
  } else {
    // cylinder: ellipse top over a body with shaded side
    const rx = Math.max(1, Math.round(((shape.w + shape.d) * PROCEDURAL_S) / 2));
    const ry = Math.max(1, Math.round(rx / 2));
    const x0 = Math.round(cx - rx / 2);
    const x1 = Math.round(cx + rx / 2);
    const bottom = ellipsePoints({ x: x0, y: Math.round(cy - ry / 2) }, { x: x1, y: Math.round(cy + ry / 2) }, true);
    const body: Pt[] = [];
    for (let y = Math.round(cy - shape.h); y <= Math.round(cy); y++) for (let x = x0; x <= x1; x++) body.push({ x, y });
    fill(bottom, left);
    fill(body, left);
    for (const p of body) if (p.x > (x0 + x1) / 2) setPixel(cel, size, p.x, p.y, right);
    fill(ellipsePoints({ x: x0, y: Math.round(cy - shape.h - ry / 2) }, { x: x1, y: Math.round(cy - shape.h + ry / 2) }, true), top);
  }
}

/** Draw every shape of a procedural sprite into frame 0 of the first layer (replacing what is there). */
export function bakeShapes(sprite: SpriteData): SpriteData {
  if (!sprite.procedural) return sprite;
  const copy: SpriteData = structuredClone(sprite);
  const cel = newCel(copy.width, copy.height);
  for (const s of copy.procedural!.shapes) drawShape(cel, copy, s);
  const layerId = copy.layers[0]!.id;
  copy.frames[0]!.cels[layerId] = encodeRle(cel);
  return copy;
}
