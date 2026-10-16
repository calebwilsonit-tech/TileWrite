import { z } from 'zod';

/**
 * Project and scene file formats. Everything on disk is plain JSON with a `schemaVersion`,
 * validated here before use. Old versions are upgraded by `migrate*` in ./migrate.ts.
 */

export const CURRENT_SCHEMA_VERSION = 1;

// Zod's JIT compiler probes for `new Function`, which the editor's Content-Security-Policy forbids
// (and logs an error for even though the probe is caught). Our files are small, so skip the JIT.
z.config({ jitless: true });

const rows = z.array(z.array(z.number().int().min(0)));

/** TileMap layers stored as rows so diffs and merges stay readable. */
export const TileMapRowsSchema = z
  .object({
    width: z.number().int().min(1).max(1024),
    height: z.number().int().min(1).max(1024),
    tiles: rows,
    heights: rows,
    slopes: rows,
    flags: rows,
    decks: rows,
    deckTiles: rows,
    oneWay: rows,
  })
  .superRefine((m, ctx) => {
    for (const key of ['tiles', 'heights', 'slopes', 'flags', 'decks', 'deckTiles', 'oneWay'] as const) {
      const layer = m[key];
      if (layer.length !== m.height || layer.some((r) => r.length !== m.width)) {
        ctx.addIssue({ code: 'custom', message: `map layer "${key}" must be ${m.width} x ${m.height}`, path: [key] });
      }
    }
  });
export type TileMapRows = z.infer<typeof TileMapRowsSchema>;

export const EntitySchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  tags: z.array(z.string()).default([]),
  /** Component data by name. Known components are checked by the engine; unknown ones are kept as-is. */
  components: z.record(z.string(), z.unknown()).default({}),
});
export type EntityData = z.infer<typeof EntitySchema>;

export const RegionSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  x: z.number().int(),
  y: z.number().int(),
  w: z.number().int().min(1),
  h: z.number().int().min(1),
  /** Keep the camera inside this region while the player is in it. */
  cameraBounds: z.boolean().default(false),
  music: z.string().default(''),
  /** 0 = fully lit, 1 = pitch dark. */
  darkness: z.number().min(0).max(1).default(0),
  /** Bosses placed here only act while the player is inside. */
  bossActive: z.boolean().default(false),
});
export type RegionData = z.infer<typeof RegionSchema>;

export const SceneSchema = z.object({
  schemaVersion: z.number().int().min(1),
  name: z.string().min(1),
  map: TileMapRowsSchema,
  entities: z.array(EntitySchema).default([]),
  regions: z.array(RegionSchema).default([]),
});
export type SceneData = z.infer<typeof SceneSchema>;

export const TileDefSchema = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1),
  top: z.number().int().min(0).max(0xffffff),
  left: z.number().int().min(0).max(0xffffff),
  right: z.number().int().min(0).max(0xffffff),
});
export type TileDefData = z.infer<typeof TileDefSchema>;

export const IsoConfigSchema = z.object({
  tileW: z.number().int().min(8).default(64),
  tileH: z.number().int().min(4).default(32),
  heightPx: z.number().int().min(1).default(16),
});

export const ProjectSchema = z.object({
  schemaVersion: z.number().int().min(1),
  name: z.string().min(1),
  iso: IsoConfigSchema.default({ tileW: 64, tileH: 32, heightPx: 16 }),
  tileset: z.array(TileDefSchema).default([]),
  /** Scene file paths relative to the project folder. */
  scenes: z.array(z.string()).min(1),
  startScene: z.string(),
});
export type ProjectData = z.infer<typeof ProjectSchema>;

/** Plain-English message for the first problem in a Zod error (no jargon for the Problems panel). */
export function describeSchemaError(error: z.ZodError, what: string): string {
  const issue = error.issues[0];
  if (!issue) return `${what} is not valid.`;
  const where = issue.path.length > 0 ? ` at "${issue.path.join('.')}"` : '';
  return `${what} is not valid${where}: ${issue.message}`;
}
