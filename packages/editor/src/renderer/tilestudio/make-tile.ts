import type { SpriteData, SpriteMeta } from '@tilewright/runtime';
import { blankRgba, clipTo, spriteFromRgba, splitBlock, type Rgba } from './pixels';
import { blockGuides, inside, type Guide, type IsoSize, type Pt } from './presets';
import { emptyTileForm, type TileForm } from './tiles';

/**
 * Making a usable isometric tile without the studio's mouse: the template for the project's tile size (the canvas and the faces
 * that count), the pictures a tile is made of cut from one drawing, and a preview of the tile repeated over a patch of ground the
 * way the world draws it. Pure; the assistant's drawing tool and the picture import both end here.
 */

export type TileKind = 'floor' | 'block';

export interface TileTemplate {
  kind: TileKind;
  /** Levels tall (a floor tile has none). */
  levels: number;
  width: number;
  height: number;
  /** The studio preset it is (`flat`, `half`, `block`), so the sprite carries the same guides when it is opened. */
  preset: string;
  guides: Guide[];
}

const diamond = (w: number, h: number): Pt[] => [[w / 2, 0], [w, h / 2], [w / 2, h], [0, h / 2]];

export function tileTemplate(iso: IsoSize, kind: TileKind, levels = 1): TileTemplate {
  if (kind === 'floor') return { kind, levels: 0, width: iso.tileW, height: iso.tileH, preset: 'flat', guides: [{ points: diamond(iso.tileW, iso.tileH), color: '#ffd34a', label: 'floor', clip: true }] };
  const lv = Math.max(0.5, Math.min(4, levels));
  return { kind, levels: lv, width: iso.tileW, height: Math.round(iso.tileH + lv * iso.heightPx), preset: lv === 0.5 ? 'half' : 'block', guides: blockGuides(iso, lv) };
}

/** The template as rows of characters: "T" the top face, "L" the left face, "R" the right face, "." outside (what is cut away). */
export function templateRows(t: TileTemplate): string[] {
  const letters = t.kind === 'floor' ? ['T'] : ['T', 'L', 'R'];
  const rows: string[] = [];
  for (let y = 0; y < t.height; y++) {
    let row = '';
    for (let x = 0; x < t.width; x++) {
      const g = t.guides.findIndex((guide) => inside([x + 0.5, y + 0.5], guide.points));
      row += g < 0 ? '.' : letters[g] ?? 'T';
    }
    rows.push(row);
  }
  return rows;
}

/** Which of the template's faces (index into `guides`) a pixel belongs to, or -1. */
export const faceAt = (t: TileTemplate, x: number, y: number): number => t.guides.findIndex((g) => inside([x + 0.5, y + 0.5], g.points));

const META = (kind: SpriteMeta['kind'], preset: string, levels: number): SpriteMeta => ({ kind, preset, footprint: { w: 1, d: 1 }, heightCells: levels, collision: null, fade: null, sortOffset: 0, sway: false, variants: [], face: 'wall', otherSide: '', light: 0, tags: [], });

export interface MadeTile {
  /** The sprites to save: for a floor tile its picture; for a block the whole block (to edit) and its top, left and right pictures. */
  sprites: SpriteData[];
  /** The sprite whose picture is the tile's top (the tile is made from it). */
  topSprite: string;
  form: TileForm;
  /** The picture, cut to the guides. */
  picture: Rgba;
}

/** The sprites and tile form for a drawing made on the template. Everything outside the guides is cut away first. */
export function makeTile(img: Rgba, iso: IsoSize, t: TileTemplate, name: string): MadeTile {
  const picture = clipTo(img, t.guides.map((g) => g.points));
  if (t.kind === 'floor') {
    const sprite: SpriteData = { ...spriteFromRgba(name, picture, [t.width / 2, t.height / 2]), meta: META('tile', 'flat', 0) };
    return { sprites: [sprite], topSprite: name, form: emptyTileForm(name), picture };
  }
  const faces = splitBlock(picture, iso, t.levels);
  const mk = (suffix: string, face: Rgba, kind: SpriteMeta['kind'], preset: string): SpriteData => ({
    ...spriteFromRgba(`${name}_${suffix}`, face, [face.width / 2, kind === 'tile' ? face.height / 2 : face.height]),
    meta: META(kind, preset, t.levels),
  });
  const whole: SpriteData = { ...spriteFromRgba(name, picture, [t.width / 2, iso.tileH / 2]), meta: META('tile', t.preset, t.levels) };
  const sprites = [whole, mk('top', faces.top, 'tile', 'flat'), mk('left', faces.left, 'wall', 'wall-left-1'), mk('right', faces.right, 'wall', 'wall-right-1')];
  return { sprites, topSprite: `${name}_top`, form: { ...emptyTileForm(name), leftArt: `${name}_left`, rightArt: `${name}_right`, faceLevels: t.levels }, picture };
}

/** The tile repeated over a patch of ground, `cols` x `rows` cells, seen at the game's angle, then enlarged `scale` times. */
export function tilePatch(img: Rgba, iso: IsoSize, cols = 4, rows = 4, scale = 2): Rgba {
  const w = (cols + rows) * (iso.tileW / 2) + iso.tileW / 2;
  const h = (cols + rows) * (iso.tileH / 2) + (img.height - iso.tileH) + iso.tileH / 2;
  const out = blankRgba(Math.ceil(w), Math.ceil(h));
  const ox = rows * (iso.tileW / 2);
  for (let sum = 0; sum <= cols + rows - 2; sum++) {
    for (let gx = Math.max(0, sum - (rows - 1)); gx <= Math.min(cols - 1, sum); gx++) {
      const gy = sum - gx;
      const left = Math.round(ox + (gx - gy) * (iso.tileW / 2));
      // a block is drawn with its top diamond at the top of the picture, so it rises above the ground diamond it stands on (the room for that is kept at the top)
      blit(out, img, left, Math.round((gx + gy) * (iso.tileH / 2)));
    }
  }
  return scale <= 1 ? out : enlarge(out, scale);
}

function blit(dst: Rgba, src: Rgba, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const dx = ox + x;
      const dy = oy + y;
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue;
      const s = (y * src.width + x) * 4;
      const a = src.data[s + 3]! / 255;
      if (a === 0) continue;
      const d = (dy * dst.width + dx) * 4;
      for (let c = 0; c < 3; c++) dst.data[d + c] = src.data[s + c]! * a + dst.data[d + c]! * (1 - a);
      dst.data[d + 3] = Math.min(255, src.data[s + 3]! + dst.data[d + 3]! * (1 - a));
    }
  }
}

function enlarge(img: Rgba, k: number): Rgba {
  const out = blankRgba(img.width * k, img.height * k);
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const s = (Math.floor(y / k) * img.width + Math.floor(x / k)) * 4;
      out.data.set(img.data.subarray(s, s + 4), (y * out.width + x) * 4);
    }
  }
  return out;
}
