import { z } from 'zod';
import { FACING_NAMES } from '../iso/math';
import { VectorShapeSchema } from './vector';

/**
 * Sprite file format (`*.sprite.json`). Pixels are palette indices (0 = transparent) stored run-length
 * encoded per layer per frame, so files stay small and diff-friendly. Everything else is plain JSON.
 */

export const SPRITE_SCHEMA_VERSION = 1;
export const MAX_SPRITE_SIZE = 512;
export const MAX_PALETTE = 256;

export const FACING_KEYS = FACING_NAMES;
export type FacingKey = (typeof FACING_NAMES)[number];

const BoxSchema = z.object({
  kind: z.enum(['hit', 'hurt']),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
});
export type SpriteBox = z.infer<typeof BoxSchema>;

const FrameSchema = z.object({
  /** Milliseconds this frame is shown. */
  duration: z.number().int().min(10).max(60000),
  /** Layer id -> RLE-encoded palette indices (missing layer = empty). */
  cels: z.record(z.string(), z.string()),
  boxes: z.array(BoxSchema).default([]),
  /** Vector layer id -> its shapes in this frame (the layer's `cels` entry is what they look like drawn). */
  vectors: z.record(z.string(), z.array(VectorShapeSchema)).optional(),
});

const FrameListSchema = z.array(z.number().int().min(0));

const ClipSchema = z.object({
  name: z.string().min(1),
  loop: z.boolean().default(true),
  /** Directions W/SW/NW reuse E/SE/NE flipped when they have no frames of their own. */
  mirror: z.boolean().default(false),
  /** Frames used for every facing that has no entry in `dirs`. */
  all: FrameListSchema.default([]),
  dirs: z
    .object(Object.fromEntries(FACING_NAMES.map((d) => [d, FrameListSchema.optional()])) as Record<FacingKey, z.ZodOptional<typeof FrameListSchema>>)
    .partial()
    .default({}),
  /** Named events fired when the clip reaches position `at` (index into the frame list). */
  events: z.array(z.object({ at: z.number().int().min(0), name: z.string().min(1) })).default([]),
});
export type ClipData = z.infer<typeof ClipSchema>;

export const ShapeSchema = z.object({
  type: z.enum(['box', 'cylinder', 'ellipse', 'diamond']),
  color: z.number().int().min(0).max(0xffffff),
  /** Position of the shape's base centre, in pixels from the sprite origin (x right, y down). */
  x: z.number(),
  y: z.number(),
  /** Footprint in cells (w along x, d along y) and height in pixels. */
  w: z.number().min(0.05),
  d: z.number().min(0.05),
  h: z.number().min(0),
});
export type ShapeData = z.infer<typeof ShapeSchema>;

/**
 * What a sprite is for. Plain sprites have none. Tiles, tall props, wall and floor attachments and decals say how they sit in the
 * world: where they stand, what blocks, what is drawn behind and what fades when the player walks behind.
 */
export const SpriteMetaSchema = z.object({
  kind: z.enum(['sprite', 'tile', 'wall', 'cliff', 'stairs', 'prop', 'attachment', 'decal']).default('sprite'),
  /** The studio canvas this started from (`flat`, `block`, `wall-left`, `prop-2x3`...), for guides. */
  preset: z.string().default(''),
  /** The cells the base stands on: w along x, d along y. */
  footprint: z.object({ w: z.number().min(0.25).max(12).default(1), d: z.number().min(0.25).max(12).default(1) }).default({ w: 1, d: 1 }),
  /** How tall it is in cells (draw order, and what walls it can hide behind). */
  heightCells: z.number().min(0).max(40).default(1),
  /** What blocks, as a rectangle inside the footprint in cells ({x, y} from the footprint's top-left corner); null = nothing blocks. */
  collision: z.object({ x: z.number(), y: z.number(), w: z.number().min(0.05), d: z.number().min(0.05) }).nullable().default(null),
  /** The rows of the picture (from its top) that fade when something stands behind it: the canopy of a tree. null = nothing fades. */
  fade: z.object({ fromY: z.number().int().min(0), toY: z.number().int().min(1) }).nullable().default(null),
  /** Draw-order point as an offset in cells from the feet (0 = the feet). */
  sortOffset: z.number().default(0),
  /** Sways gently (trees, grass). */
  sway: z.boolean().default(false),
  /** Other sprites that can be used instead of this one, chosen at random by weight. */
  variants: z.array(z.object({ sprite: z.string(), weight: z.number().min(0).max(100) })).default([]),
  /** Wall and floor attachments: the face they sit on, and the sprite for the face on the other side (empty = this one mirrored). */
  face: z.enum(['wall', 'floor']).default('wall'),
  otherSide: z.string().default(''),
  /** Attachments can bring behaviours with them: a light, something to interact with, a portal. */
  light: z.number().min(0).max(12).default(0),
  /** The tile properties of a tile sprite are stored with the tile; a prop may also carry these. */
  tags: z.array(z.string()).default([]),
});
export type SpriteMeta = z.infer<typeof SpriteMetaSchema>;

export const SpriteSchema = z
  .object({
    schemaVersion: z.number().int().min(1),
    name: z.string().min(1),
    width: z.number().int().min(1).max(MAX_SPRITE_SIZE),
    height: z.number().int().min(1).max(MAX_SPRITE_SIZE),
    /** "#rrggbbaa"; entry 0 is always fully transparent. */
    palette: z.array(z.string().regex(/^#[0-9a-fA-F]{8}$/)).min(1).max(MAX_PALETTE),
    layers: z.array(z.object({ id: z.string().min(1), name: z.string(), visible: z.boolean().default(true), kind: z.enum(['pixel', 'vector']).optional() })).min(1),
    frames: z.array(FrameSchema).min(1),
    /** The feet point: where the sprite stands on its cell, in pixels from the top-left. */
    origin: z.object({ x: z.number(), y: z.number() }),
    clips: z.array(ClipSchema).default([]),
    /** Present for sprites built from shapes with sliders; `bake` turns them into pixels. */
    procedural: z.object({ shapes: z.array(ShapeSchema) }).nullable().default(null),
    /** What the sprite is for in the world (a tile, a tall prop, a wall attachment...). */
    meta: SpriteMetaSchema.optional(),
  })
  .superRefine((s, ctx) => {
    const ids = new Set<string>();
    const vectorIds = new Set(s.layers.filter((l) => l.kind === 'vector').map((l) => l.id));
    for (const l of s.layers) {
      if (ids.has(l.id)) ctx.addIssue({ code: 'custom', message: `layer id "${l.id}" is used twice`, path: ['layers'] });
      ids.add(l.id);
    }
    if (s.palette[0] && !s.palette[0].toLowerCase().endsWith('00')) {
      ctx.addIssue({ code: 'custom', message: 'palette entry 0 must be transparent', path: ['palette', 0] });
    }
    s.frames.forEach((f, i) => {
      for (const id of Object.keys(f.cels)) {
        if (!ids.has(id)) ctx.addIssue({ code: 'custom', message: `frame ${i + 1} has pixels for a layer that does not exist ("${id}")`, path: ['frames', i, 'cels'] });
      }
    });
    s.frames.forEach((f, i) => {
      for (const id of Object.keys(f.vectors ?? {})) {
        if (!vectorIds.has(id)) ctx.addIssue({ code: 'custom', message: `frame ${i + 1} has shapes for a layer that is not a vector layer ("${id}")`, path: ['frames', i, 'vectors'] });
      }
    });
    const n = s.frames.length;
    s.clips.forEach((c, ci) => {
      const lists = [c.all, ...Object.values(c.dirs)].filter((x): x is number[] => Array.isArray(x));
      for (const list of lists) {
        if (list.some((f) => f >= n)) ctx.addIssue({ code: 'custom', message: `clip "${c.name}" uses a frame that does not exist`, path: ['clips', ci] });
      }
    });
  });
export type SpriteData = z.infer<typeof SpriteSchema>;

export const DEFAULT_PALETTE: string[] = [
  '#00000000',
  '#000000ff',
  '#ffffffff',
  '#e8553dff',
  '#f4a259ff',
  '#f6d55cff',
  '#6fae5bff',
  '#2f6f4eff',
  '#4a90d9ff',
  '#2b4c7eff',
  '#8e7cc3ff',
  '#c9964aff',
  '#7b5a3aff',
  '#a3a7b3ff',
  '#5c6070ff',
  '#2a2d38ff',
];

export function newSprite(name: string, width = 32, height = 32): SpriteData {
  return {
    schemaVersion: SPRITE_SCHEMA_VERSION,
    name,
    width,
    height,
    palette: [...DEFAULT_PALETTE],
    layers: [{ id: 'l1', name: 'Layer 1', visible: true }],
    frames: [{ duration: 120, cels: {}, boxes: [] }],
    origin: { x: Math.floor(width / 2), y: height - 2 },
    clips: [],
    procedural: null,
  };
}

export type SpriteResult = { ok: true; value: SpriteData } | { ok: false; error: string };

export function parseSprite(json: unknown): SpriteResult {
  const r = SpriteSchema.safeParse(json);
  if (r.success) return { ok: true, value: r.data };
  const issue = r.error.issues[0];
  const where = issue && issue.path.length > 0 ? ` at "${issue.path.join('.')}"` : '';
  return { ok: false, error: `This sprite file is not valid${where}: ${issue?.message ?? 'unknown problem'}` };
}

export function stringifySprite(s: SpriteData): string {
  // frames and cels on their own lines keep diffs readable
  const head = JSON.stringify({ ...s, frames: '__FRAMES__' }, null, 2);
  const frames = s.frames.map((f) => '    ' + JSON.stringify(f)).join(',\n');
  return head.replace('"__FRAMES__"', () => `[\n${frames}\n  ]`) + '\n';
}

/** "#rrggbbaa" -> packed 0xRRGGBBAA as an unsigned number. */
export function parseColor(hex: string): number {
  return parseInt(hex.slice(1), 16) >>> 0;
}

export function colorToHex(rgba: number): string {
  return `#${(rgba >>> 0).toString(16).padStart(8, '0')}`;
}

export const rgb = (r: number, g: number, b: number, a = 255): number => (((r & 255) << 24) | ((g & 255) << 16) | ((b & 255) << 8) | (a & 255)) >>> 0;
