import type { ClipData, SpriteBox, SpriteData } from './format';
import { encodePng } from './png';
import { bounds, compositeFrame } from './raster';

export interface Placement {
  x: number;
  y: number;
}

/**
 * Shelf packing: rectangles sorted tallest first are laid out left to right in rows no wider than
 * `maxWidth`. Returns where each rectangle (by input index) goes and the sheet size.
 */
export function packRects(
  sizes: readonly { w: number; h: number }[],
  maxWidth = 1024,
  padding = 1,
  powerOfTwo = true,
): { positions: Placement[]; width: number; height: number } {
  const order = sizes.map((_, i) => i).sort((a, b) => sizes[b]!.h - sizes[a]!.h || sizes[b]!.w - sizes[a]!.w || a - b);
  const widest = Math.max(0, ...sizes.map((s) => s.w + padding * 2));
  const limit = Math.max(maxWidth, widest);
  const positions: Placement[] = new Array(sizes.length);
  let x = 0;
  let y = 0;
  let rowH = 0;
  let usedW = 0;
  for (const i of order) {
    const s = sizes[i]!;
    const cw = s.w + padding * 2;
    const ch = s.h + padding * 2;
    if (x + cw > limit) {
      x = 0;
      y += rowH;
      rowH = 0;
    }
    positions[i] = { x: x + padding, y: y + padding };
    x += cw;
    usedW = Math.max(usedW, x);
    rowH = Math.max(rowH, ch);
  }
  let width = Math.max(1, usedW);
  let height = Math.max(1, y + rowH);
  if (powerOfTwo) {
    const pot = (n: number): number => 2 ** Math.ceil(Math.log2(Math.max(1, n)));
    width = pot(width);
    height = pot(height);
  }
  return { positions, width, height };
}

export interface AtlasFrame {
  index: number;
  /** Where the (trimmed) picture sits on the sheet. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Offset of the trimmed picture inside the original frame. */
  trimX: number;
  trimY: number;
  sourceW: number;
  sourceH: number;
  duration: number;
  boxes: SpriteBox[];
}

export interface Atlas {
  name: string;
  image: string;
  width: number;
  height: number;
  origin: { x: number; y: number };
  frames: AtlasFrame[];
  clips: ClipData[];
}

export interface SheetResult {
  rgba: Uint8ClampedArray;
  width: number;
  height: number;
  atlas: Atlas;
  png: Uint8Array;
}

export interface SheetOptions {
  maxWidth?: number;
  padding?: number;
  trim?: boolean;
  powerOfTwo?: boolean;
  imageName?: string;
  /** Skip PNG encoding when only the pixels are needed (e.g. to upload a texture). */
  png?: boolean;
}

/** Flatten every frame, trim the empty borders, pack them on one sheet and describe where everything is. */
export function exportSheet(sprite: SpriteData, opts: SheetOptions = {}): SheetResult {
  const trim = opts.trim ?? true;
  const frames = sprite.frames.map((_, i) => {
    const rgba = compositeFrame(sprite, i);
    const alphaCel = new Uint8Array(sprite.width * sprite.height);
    for (let p = 0; p < alphaCel.length; p++) alphaCel[p] = rgba[p * 4 + 3]! > 0 ? 1 : 0;
    const b = trim ? bounds(alphaCel, { w: sprite.width, h: sprite.height }) : { x: 0, y: 0, w: sprite.width, h: sprite.height };
    return { rgba, rect: b ?? { x: 0, y: 0, w: 1, h: 1 } };
  });
  const packed = packRects(
    frames.map((f) => ({ w: f.rect.w, h: f.rect.h })),
    opts.maxWidth ?? 1024,
    opts.padding ?? 1,
    opts.powerOfTwo ?? true,
  );
  const sheet = new Uint8ClampedArray(packed.width * packed.height * 4);
  const atlasFrames: AtlasFrame[] = [];
  frames.forEach((f, i) => {
    const pos = packed.positions[i]!;
    for (let y = 0; y < f.rect.h; y++) {
      for (let x = 0; x < f.rect.w; x++) {
        const s = ((f.rect.y + y) * sprite.width + (f.rect.x + x)) * 4;
        const d = ((pos.y + y) * packed.width + (pos.x + x)) * 4;
        sheet[d] = f.rgba[s]!;
        sheet[d + 1] = f.rgba[s + 1]!;
        sheet[d + 2] = f.rgba[s + 2]!;
        sheet[d + 3] = f.rgba[s + 3]!;
      }
    }
    atlasFrames.push({
      index: i,
      x: pos.x,
      y: pos.y,
      w: f.rect.w,
      h: f.rect.h,
      trimX: f.rect.x,
      trimY: f.rect.y,
      sourceW: sprite.width,
      sourceH: sprite.height,
      duration: sprite.frames[i]!.duration,
      boxes: sprite.frames[i]!.boxes,
    });
  });
  return {
    rgba: sheet,
    width: packed.width,
    height: packed.height,
    png: opts.png === false ? new Uint8Array(0) : encodePng(packed.width, packed.height, sheet),
    atlas: {
      name: sprite.name,
      image: opts.imageName ?? `${sprite.name}.png`,
      width: packed.width,
      height: packed.height,
      origin: sprite.origin,
      frames: atlasFrames,
      clips: sprite.clips,
    },
  };
}
