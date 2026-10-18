import type { SpriteMeta } from '@tilewright/runtime';

/**
 * Canvas presets for the tile studio: the size of a picture and the guides drawn over it (the diamond of a floor tile, the
 * parallelogram of a wall face, the footprint of a house), so art comes out at the right angle without measuring.
 */

export interface IsoSize {
  tileW: number;
  tileH: number;
  heightPx: number;
}

export type Pt = [number, number];

export interface Guide {
  /** A polygon in picture pixels. */
  points: Pt[];
  color: string;
  label: string;
  /** Art outside this polygon is cut away when the sprite is saved as this part ("clip to guides"). */
  clip?: boolean;
}

export interface Preset {
  id: string;
  label: string;
  group: 'Floor tiles' | 'Walls and cliffs' | 'Tall props and buildings' | 'Attachments and decals';
  kind: SpriteMeta['kind'];
  width: number;
  height: number;
  origin: Pt;
  guides: Guide[];
  /** What to put in the sprite's `meta` when it is made. */
  meta: Partial<SpriteMeta>;
  /** More than one frame (stairs in four facings). */
  frames?: number;
  hint: string;
}

const diamond = (w: number, h: number, ox = 0, oy = 0): Pt[] => [
  [ox + w / 2, oy],
  [ox + w, oy + h / 2],
  [ox + w / 2, oy + h],
  [ox, oy + h / 2],
];

/** The three faces of a block of `levels` height: top diamond, left and right sides. */
export function blockGuides(iso: IsoSize, levels: number): Guide[] {
  const { tileW: w, tileH: h } = iso;
  const H = levels * iso.heightPx;
  return [
    { points: diamond(w, h), color: '#ffd34a', label: 'top', clip: true },
    { points: [[0, h / 2], [w / 2, h], [w / 2, h + H], [0, h / 2 + H]], color: '#6aa8ff', label: 'left', clip: true },
    { points: [[w / 2, h], [w, h / 2], [w, h / 2 + H], [w / 2, h + H]], color: '#e0866f', label: 'right', clip: true },
  ];
}

/** A wall face seen from the left (its top edge runs down to the right) or the right (up to the right). */
export function wallGuides(iso: IsoSize, levels: number, side: 'left' | 'right'): Guide[] {
  const w = iso.tileW / 2;
  const h = iso.tileH / 2;
  const H = levels * iso.heightPx;
  const pts: Pt[] = side === 'left' ? [[0, 0], [w, h], [w, h + H], [0, H]] : [[0, h], [w, 0], [w, H], [0, h + H]];
  return [{ points: pts, color: side === 'left' ? '#6aa8ff' : '#e0866f', label: `${side} face`, clip: true }];
}

export function wallSize(iso: IsoSize, levels: number): { width: number; height: number } {
  return { width: iso.tileW / 2, height: iso.tileH / 2 + levels * iso.heightPx };
}

/** The canvas for something that stands on a footprint of `fw` x `fd` cells and rises `levels` high. */
export function propCanvas(iso: IsoSize, fw: number, fd: number, levels: number): { width: number; height: number; origin: Pt; base: Pt[] } {
  const { tileW: tw, tileH: th } = iso;
  const H = Math.round(levels * iso.heightPx);
  const width = Math.round((fw + fd) * (tw / 2));
  const baseH = Math.round((fw + fd) * (th / 2));
  const n: Pt = [fd * (tw / 2), H];
  const e: Pt = [n[0] + fw * (tw / 2), n[1] + fw * (th / 2)];
  const w: Pt = [n[0] - fd * (tw / 2), n[1] + fd * (th / 2)];
  const s: Pt = [n[0] + (fw - fd) * (tw / 2), n[1] + (fw + fd) * (th / 2)];
  const origin: Pt = [(n[0] + s[0]) / 2, (n[1] + s[1]) / 2];
  return { width, height: baseH + H, origin, base: [n, e, s, w] };
}

export function presetsFor(iso: IsoSize): Preset[] {
  const { tileW: w, tileH: h, heightPx: hp } = iso;
  const out: Preset[] = [];
  out.push({
    id: 'flat',
    label: `Flat floor tile (${w} x ${h})`,
    group: 'Floor tiles',
    kind: 'tile',
    width: w,
    height: h,
    origin: [w / 2, h / 2],
    guides: [{ points: diamond(w, h), color: '#ffd34a', label: 'floor', clip: true }],
    meta: { kind: 'tile', preset: 'flat', footprint: { w: 1, d: 1 }, heightCells: 0 },
    hint: 'The top of one cell. Draw inside the diamond; it is stretched over the cell, and repeats edge to edge.',
  });
  for (const [id, levels, label] of [['half', 0.5, 'Half-height block'], ['block', 1, 'Full-height block']] as const) {
    const H = levels * hp;
    out.push({
      id,
      label: `${label} (${w} x ${Math.round(h + H)})`,
      group: 'Floor tiles',
      kind: 'tile',
      width: w,
      height: Math.round(h + H),
      origin: [w / 2, h / 2],
      guides: blockGuides(iso, levels),
      meta: { kind: 'tile', preset: id, footprint: { w: 1, d: 1 }, heightCells: levels },
      hint: 'Draw all three faces in one picture; "Split into faces" cuts it into the top, left and right pictures a tile uses.',
    });
  }
  for (const levels of [1, 2]) {
    for (const side of ['left', 'right'] as const) {
      const size = wallSize(iso, levels);
      out.push({
        id: `wall-${side}-${levels}`,
        label: `${levels === 1 ? 'Wall' : 'Cliff'} face, ${side}, ${levels} level${levels === 1 ? '' : 's'} (${size.width} x ${size.height})`,
        group: 'Walls and cliffs',
        kind: levels === 1 ? 'wall' : 'cliff',
        width: size.width,
        height: size.height,
        origin: [size.width / 2, size.height],
        guides: wallGuides(iso, levels, side),
        meta: { kind: levels === 1 ? 'wall' : 'cliff', preset: `wall-${side}-${levels}`, footprint: { w: 1, d: 1 }, heightCells: levels },
        hint: 'One side of a block, already at the iso angle. Use it as the left or right face of a tile; stacked blocks repeat it upwards.',
      });
    }
  }
  out.push({
    id: 'stairs',
    label: `Stairs, four facings (${w} x ${Math.round(h + hp)})`,
    group: 'Walls and cliffs',
    kind: 'stairs',
    width: w,
    height: Math.round(h + hp),
    origin: [w / 2, h / 2],
    guides: blockGuides(iso, 1),
    frames: 4,
    meta: { kind: 'stairs', preset: 'stairs', footprint: { w: 1, d: 1 }, heightCells: 1 },
    hint: 'Frame 1 faces north, 2 east, 3 south, 4 west. Draw the steps inside the block outline.',
  });
  for (const [id, label, fw, fd, levels, collision] of [
    ['prop-1x1', 'Tall prop, 1 x 1 (lamp post, statue)', 1, 1, 3, { x: 0.35, y: 0.35, w: 0.3, d: 0.3 }],
    ['tree', 'Tree, 2 x 2 (trunk blocks, canopy fades)', 2, 2, 4, { x: 0.8, y: 0.8, w: 0.4, d: 0.4 }],
    ['house-2x3', 'House, 2 x 3 (whole footprint blocks)', 2, 3, 3, { x: 0, y: 0, w: 2, d: 3 }],
  ] as const) {
    const c = propCanvas(iso, fw, fd, levels);
    out.push({
      id,
      label: `${label} (${c.width} x ${c.height})`,
      group: 'Tall props and buildings',
      kind: 'prop',
      width: c.width,
      height: c.height,
      origin: c.origin,
      guides: [{ points: c.base, color: '#ffd34a', label: 'footprint' }],
      meta: { kind: 'prop', preset: id, footprint: { w: fw, d: fd }, heightCells: levels, collision, sortOffset: 0 },
      hint: 'Draw the whole picture. The yellow diamond is the ground it stands on (the feet are its middle). Mark what blocks and what fades in the Prop section.',
    });
  }
  for (const side of ['left', 'right'] as const) {
    const size = wallSize(iso, 1);
    out.push({
      id: `attach-${side}`,
      label: `Wall attachment, ${side}-facing (${size.width} x ${size.height})`,
      group: 'Attachments and decals',
      kind: 'attachment',
      width: size.width,
      height: size.height,
      origin: [size.width / 2, size.height / 2],
      guides: wallGuides(iso, 1, side),
      meta: { kind: 'attachment', preset: `attach-${side}`, face: 'wall', footprint: { w: 0.5, d: 0.5 }, heightCells: 1 },
      hint: 'A window, door, torch or poster drawn on the wall face. Make the other side with "Make the other side" (mirrored, and you can touch it up).',
    });
  }
  out.push({
    id: 'attach-floor',
    label: `Floor attachment or decal (${w} x ${h})`,
    group: 'Attachments and decals',
    kind: 'attachment',
    width: w,
    height: h,
    origin: [w / 2, h / 2],
    guides: [{ points: diamond(w, h), color: '#ffd34a', label: 'floor' }],
    meta: { kind: 'attachment', preset: 'attach-floor', face: 'floor', footprint: { w: 1, d: 1 }, heightCells: 0 },
    hint: 'A rug, puddle or crack that lies on a floor or on top of a block.',
  });
  return out;
}

/** The preset a sprite was made from, to draw its guides again. */
export function presetOf(iso: IsoSize, meta: { preset?: string } | null | undefined): Preset | null {
  if (!meta?.preset) return null;
  const direct = presetsFor(iso).find((p) => p.id === meta.preset);
  return direct ?? null;
}

/** Whether a point is inside a polygon (to clip art to the guides). */
export function inside(p: Pt, poly: readonly Pt[]): boolean {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!;
    const [xj, yj] = poly[j]!;
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
}

/** Where a rectangle given in cells inside a footprint falls in the picture (N is the top corner of the footprint's base). */
export function cellsToPx(iso: IsoSize, n: Pt, rect: { x: number; y: number; w: number; d: number }): Pt[] {
  const at = (fx: number, fy: number): Pt => [n[0] + (fx - fy) * (iso.tileW / 2), n[1] + (fx + fy) * (iso.tileH / 2)];
  return [at(rect.x, rect.y), at(rect.x + rect.w, rect.y), at(rect.x + rect.w, rect.y + rect.d), at(rect.x, rect.y + rect.d)];
}

/** Everything drawn over a picture to help: the preset's outlines, what blocks, and where the fading part ends. */
export function spriteGuides(iso: IsoSize, meta: SpriteMeta | null | undefined): { guides: Guide[]; fadeRow?: number } {
  if (!meta) return { guides: [] };
  const preset = presetOf(iso, meta);
  const guides: Guide[] = preset ? [...preset.guides] : [];
  if (meta.kind === 'prop') {
    const c = propCanvas(iso, meta.footprint.w, meta.footprint.d, meta.heightCells);
    if (!preset) guides.push({ points: c.base, color: '#ffd34a', label: 'footprint' });
    if (meta.collision) guides.push({ points: cellsToPx(iso, c.base[0]!, meta.collision), color: '#ff8a3c', label: 'blocks' });
  }
  return { guides, ...(meta.fade ? { fadeRow: meta.fade.toY } : {}) };
}
