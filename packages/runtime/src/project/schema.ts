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
    /** Optional (only maps with level-limited blockers have them). */
    blockLow: rows.optional(),
    blockHigh: rows.optional(),
    /** Cells edited block by block (only maps that have some carry this). */
    stacks: z
      .array(
        z.object({
          x: z.number().int().min(0),
          y: z.number().int().min(0),
          floor: z.number().int().min(0),
          blocks: z.array(z.object({ z: z.number().int().min(0).max(254), tile: z.number().int().min(1), faces: z.object({ top: z.number().int().min(1).optional(), n: z.number().int().min(1).optional(), e: z.number().int().min(1).optional(), s: z.number().int().min(1).optional(), w: z.number().int().min(1).optional() }).optional() })),
        }),
      )
      .optional(),
  })
  .superRefine((m, ctx) => {
    for (const key of ['tiles', 'heights', 'slopes', 'flags', 'decks', 'deckTiles', 'oneWay', 'blockLow', 'blockHigh'] as const) {
      const layer = m[key];
      if (layer === undefined) continue;
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
  /**
   * Component data by name. Known components are checked by the engine; unknown ones are kept as-is.
   * For an instance of a prefab this holds only the OVERRIDES (what differs from the prefab).
   */
  components: z.record(z.string(), z.unknown()).default({}),
  /** Name of the prefab this object is an instance of, if any. */
  prefab: z.string().min(1).optional(),
});
export type EntityData = z.infer<typeof EntitySchema>;

/** A connection from one object's output signal to another object's input. */
export const WireSchema = z.object({
  id: z.string().min(1),
  from: z.object({ entity: z.string().min(1), output: z.string().min(1) }),
  to: z.object({ entity: z.string().min(1), input: z.string().min(1) }),
});
export type WireData = z.infer<typeof WireSchema>;

export const VariableValueSchema = z.union([z.number(), z.string(), z.boolean()]);
export type VariableValue = z.infer<typeof VariableValueSchema>;

export const VariableSchema = z.object({
  name: z.string().min(1),
  value: VariableValueSchema.default(0),
});
export type VariableData = z.infer<typeof VariableSchema>;

const EventConditionSchema = z.object({
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
  negate: z.boolean().default(false),
});
const EventActionSchema = z.object({
  type: z.string().min(1),
  params: z.record(z.string(), z.unknown()).default({}),
});

/** One row of an event sheet: "when [conditions] do [actions]", with sub-events that run only if it holds. */
export const EventRowSchema = z.object({
  id: z.string().min(1),
  enabled: z.boolean().default(true),
  comment: z.string().default(''),
  /** 'all' = every condition must hold (AND); 'any' = at least one (OR). */
  mode: z.enum(['all', 'any']).default('all'),
  /** Run the actions only on the tick the row becomes true, not on every tick it stays true. */
  once: z.boolean().default(false),
  /** Loop: check the row once for each object matching this reference (like 	ag:enemy); picked then means that object. */
  forEach: z.string().default(''),
  /** Run the actions this many times each time the row fires. */
  repeat: z.number().int().min(1).max(100).default(1),
  conditions: z.array(EventConditionSchema).default([]),
  actions: z.array(EventActionSchema).default([]),
  get children() {
    return z.array(EventRowSchema).default([]);
  },
});
export type EventRow = z.infer<typeof EventRowSchema>;
export type EventCondition = z.infer<typeof EventConditionSchema>;
export type EventAction = z.infer<typeof EventActionSchema>;

export interface PrefabNode {
  name: string;
  tags: string[];
  components: Record<string, unknown>;
  /** Another prefab this node is an instance of (nested prefabs). */
  prefab?: string | undefined;
  /** Parts that come with it; their positions are offsets from the parent. */
  children: PrefabNode[];
}

const PrefabNodeSchema: z.ZodType<PrefabNode, unknown> = z.lazy(() =>
  z.object({
    name: z.string(),
    tags: z.array(z.string()).default([]),
    components: z.record(z.string(), z.unknown()).default({}),
    prefab: z.string().min(1).optional(),
    children: z.array(PrefabNodeSchema).default([]),
  }),
) as z.ZodType<PrefabNode, unknown>;

/** A reusable object (`assets/prefabs/<name>.prefab.json`). Instances in scenes follow it, except for their overrides. */
export const PrefabSchema = z.object({
  schemaVersion: z.number().int().min(1),
  name: z.string().min(1),
  root: PrefabNodeSchema,
});
export type PrefabData = z.infer<typeof PrefabSchema>;

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
  /** Connections between objects' signals (plate -> gate). */
  wires: z.array(WireSchema).default([]),
  /** Variables the scene starts with (counters, flags, text). */
  variables: z.array(VariableSchema).default([]),
  /** The scene's event sheet. */
  events: z.array(EventRowSchema).default([]),
});
export type SceneData = z.infer<typeof SceneSchema>;

export const TileDefSchema = z.object({
  id: z.number().int().min(1),
  name: z.string().min(1),
  top: z.number().int().min(0).max(0xffffff),
  left: z.number().int().min(0).max(0xffffff),
  right: z.number().int().min(0).max(0xffffff),
  group: z.number().int().min(1).optional(),
  wall: z.boolean().optional(),
  rim: z.object({ sides: z.number().int().min(0).max(15), corners: z.number().int().min(0).max(15), color: z.number().int().min(0).max(0xffffff) }).optional(),
  /** Name of a sprite that covers the top face. */
  art: z.string().optional(),
});
export type TileDefData = z.infer<typeof TileDefSchema>;

export const AutotileRuleSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  base: z.number().int().min(1),
  /** Eight characters, one per neighbour (N, NE, E, SE, S, SW, W, NW): 1 same, 0 other, * any, L lower, H higher. */
  pattern: z.string().regex(/^[01*LH]{8}$/),
  result: z.number().int().min(1),
});
export type AutotileRuleData = z.infer<typeof AutotileRuleSchema>;

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
  /** Autotiling rules, tried in order for each cell (see tilemap/autotile.ts). */
  autotile: z.array(AutotileRuleSchema).default([]),
  /** Scene file paths relative to the project folder. */
  scenes: z.array(z.string()).min(1),
  startScene: z.string(),
  /** A title screen shown when the game starts (New game, Continue, Load game, Settings, Quit). */
  title: z.object({ enabled: z.boolean().default(false), subtitle: z.string().default('') }).optional(),
  /** The packs this game uses (see packs in the behaviours package). Missing means all of them, as before packs existed. */
  packs: z.array(z.string()).optional(),
});
export type ProjectData = z.infer<typeof ProjectSchema>;

/** Plain-English message for the first problem in a Zod error (no jargon for the Problems panel). */
export function describeSchemaError(error: z.ZodError, what: string): string {
  const issue = error.issues[0];
  if (!issue) return `${what} is not valid.`;
  const where = issue.path.length > 0 ? ` at "${issue.path.join('.')}"` : '';
  return `${what} is not valid${where}: ${issue.message}`;
}
