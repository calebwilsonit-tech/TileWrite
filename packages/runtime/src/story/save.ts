import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { VariableValueSchema } from '../project/schema';
import type { Simulation } from '../core/simulation';
import { C, type TransformIso } from '../scene/components';
import { applyTableEdits } from '../data/tables';

/**
 * Save games: what to keep (flags and inventory, where the player is, the last lantern, and the state of
 * objects tagged "persistent"), a versioned format with migrations, several slots plus an autosave, and
 * recovery from damaged files (the previous save is kept as a backup).
 */

export const CURRENT_SAVE_VERSION = 1;

const CheckpointSchema = z.object({ scene: z.string(), x: z.number(), y: z.number(), h: z.number(), name: z.string() });

export const SaveSchema = z.object({
  saveVersion: z.number().int().min(1),
  /** ISO time the host stamped on it. */
  savedAt: z.string().default(''),
  /** Short text shown in the slot list ("Hub, 12 min"). */
  label: z.string().default(''),
  scene: z.string().default(''),
  vars: z.record(z.string(), VariableValueSchema).default({}),
  checkpoint: CheckpointSchema.nullable().default(null),
  difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  playSeconds: z.number().min(0).default(0),
  player: z.object({ x: z.number(), y: z.number(), h: z.number(), facing: z.number().default(2), hp: z.number().nullable().default(null) }).nullable().default(null),
  /** Objects tagged "persistent": their saved parts, by scene id. */
  objects: z.array(z.object({ id: z.string(), components: z.record(z.string(), z.unknown()) })).default([]),
  /** Persistent objects that no longer exist (a picked-up coin, a broken pot). */
  gone: z.array(z.string()).default([]),
  /** Rows of data tables the game changed (an inventory, a deck), by table name. */
  tables: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))).default({}),
});
export type SaveData = z.infer<typeof SaveSchema>;

export const PERSISTENT_TAG = 'persistent';

/** Parts of an object that never go in a save (they are rebuilt, or too big and boring). */
const SKIP = new Set(['label', 'animator', 'meta']);

function sceneIdOf(e: { get<T>(c: string): T | undefined }): string | undefined {
  return e.get<{ sceneId: string }>('meta')?.sceneId;
}

/** Everything worth keeping from a running game. `stamp` and `label` come from the host (the simulation has no clock). */
export function serializeGame(sim: Simulation, meta: { stamp: string; label?: string; playSeconds?: number } = { stamp: '' }): SaveData {
  const r = sim.runtime;
  const playerEntity = sim.world.withTag('player')[0];
  const t = playerEntity?.get<TransformIso>(C.Transform);
  const hp = playerEntity?.get<{ hp: number }>('state:health')?.hp ?? null;
  const objects: SaveData['objects'] = [];
  const present = new Set<string>();
  for (const e of sim.world.withTag(PERSISTENT_TAG)) {
    const id = sceneIdOf(e);
    if (!id) continue;
    present.add(id);
    const comps: Record<string, unknown> = {};
    for (const [k, v] of e.components) {
      if (SKIP.has(k)) continue;
      try {
        comps[k] = JSON.parse(JSON.stringify(v));
      } catch {
        /* not plain data: leave it out */
      }
    }
    objects.push({ id, components: comps });
  }
  const gone = [...r.ids.keys()].filter((id) => {
    const live = r.ids.get(id);
    return live !== undefined && !present.has(id) && sim.world.get(live) === undefined;
  });
  // only objects that were persistent when the scene loaded count as gone
  const persistentOnLoad = new Set(r.persistentIds ?? []);
  return SaveSchema.parse({
    saveVersion: CURRENT_SAVE_VERSION,
    savedAt: meta.stamp,
    label: meta.label ?? '',
    scene: r.scene,
    vars: JSON.parse(JSON.stringify(r.vars)),
    checkpoint: r.checkpoint,
    difficulty: r.difficulty,
    playSeconds: meta.playSeconds ?? 0,
    player: t ? { x: t.x, y: t.y, h: t.h, facing: t.facing, hp } : null,
    objects,
    gone: gone.filter((id) => persistentOnLoad.has(id)),
    tables: JSON.parse(JSON.stringify(r.tableEdits)),
  });
}

/**
 * Put a save into a game whose scene (`save.scene`) has just been loaded: flags and inventory, the last
 * lantern, the player, and persistent objects (their saved state, or gone if they were gone).
 */
export function applySave(sim: Simulation, save: SaveData): void {
  const r = sim.runtime;
  r.vars = { ...r.vars, ...save.vars };
  r.checkpoint = save.checkpoint;
  r.difficulty = save.difficulty;
  r.tableEdits = structuredClone(save.tables) as typeof r.tableEdits;
  applyTableEdits(sim.assets.tables, r.tableEdits);
  for (const id of save.gone) {
    const live = r.ids.get(id);
    if (live !== undefined) sim.world.destroy(live);
  }
  for (const o of save.objects) {
    const live = r.ids.get(o.id);
    const e = live !== undefined ? sim.world.get(live) : undefined;
    if (!e) continue;
    for (const [k, v] of Object.entries(o.components)) e.set(k, v);
  }
  const p = sim.world.withTag('player')[0];
  if (p && save.player) {
    const t = p.get<TransformIso>(C.Transform);
    if (t) {
      t.x = save.player.x;
      t.y = save.player.y;
      t.h = save.player.h;
      t.facing = save.player.facing;
    }
    const b = p.get<{ vx: number; vy: number; vz: number; state: string; peakZ: number }>(C.Body);
    if (b) {
      b.vx = b.vy = b.vz = 0;
      b.state = 'ground';
      b.peakZ = save.player.h;
    }
    const hs = p.get<{ hp: number; dead: boolean; iframes: number }>('state:health');
    if (hs && save.player.hp !== null) {
      hs.hp = save.player.hp;
      hs.dead = false;
      hs.iframes = 0;
    }
  }
}

// ---------- the file format ----------

export class SaveError extends Error {}

/** Bring an older save up to the current format. Throws SaveError (in plain English) when it cannot. */
export function migrateSave(raw: unknown): SaveData {
  if (typeof raw !== 'object' || raw === null) throw new SaveError('The save file is not a save game.');
  const version = (raw as { saveVersion?: unknown }).saveVersion;
  if (typeof version !== 'number') throw new SaveError('The save file is missing its version, so it cannot be read.');
  if (version > CURRENT_SAVE_VERSION) throw new SaveError(`This save was made by a newer version of the game (save format ${version}); this one understands up to ${CURRENT_SAVE_VERSION}.`);
  // older versions would be upgraded here, one step at a time
  const parsed = SaveSchema.safeParse(raw);
  if (!parsed.success) throw new SaveError(`The save file is damaged: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`);
  return parsed.data;
}

export function parseSave(text: string): SaveData {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SaveError('The save file is damaged: it is not readable text any more.');
  }
  return migrateSave(raw);
}

/** Where saves are kept (the editor uses the project folder; an exported game uses the player's app data). */
export interface SaveStorage {
  read(path: string): Promise<string>;
  write(path: string, text: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  remove(path: string): Promise<void>;
}

export interface SlotInfo {
  slot: string;
  exists: boolean;
  /** The file is damaged and there is no usable backup. */
  damaged: boolean;
  label: string;
  savedAt: string;
  scene: string;
}

export const SLOT_NAMES = ['autosave', 'slot1', 'slot2', 'slot3'] as const;

export class SaveManager {
  constructor(
    private readonly storage: SaveStorage,
    private readonly dir: string,
    private readonly join: (dir: string, name: string) => string = (d, n) => `${d.replace(/[\\/]+$/, '')}/${n}`,
  ) {}

  private file(slot: string, backup = false): string {
    return this.join(this.dir, `${slot}.save.json${backup ? '.bak' : ''}`);
  }

  /** Write a slot, keeping the previous save as its backup. */
  async write(slot: string, data: SaveData): Promise<void> {
    const text = JSON.stringify(data, null, 1) + '\n';
    if (await this.storage.exists(this.file(slot))) {
      try {
        const old = await this.storage.read(this.file(slot));
        parseSave(old); // never let a damaged file replace a good backup
        await this.storage.write(this.file(slot, true), old);
      } catch {
        /* the old file was unreadable: keep whatever backup there was */
      }
    }
    await this.storage.write(this.file(slot), text);
  }

  /** Read a slot. A damaged file falls back to its backup (`recovered` is true then). Throws SaveError when nothing works. */
  async read(slot: string): Promise<{ data: SaveData; recovered: boolean }> {
    if (!(await this.storage.exists(this.file(slot)))) throw new SaveError('There is no save in that slot.');
    try {
      return { data: parseSave(await this.storage.read(this.file(slot))), recovered: false };
    } catch (first) {
      if (await this.storage.exists(this.file(slot, true))) {
        try {
          return { data: parseSave(await this.storage.read(this.file(slot, true))), recovered: true };
        } catch {
          /* fall through to the original problem */
        }
      }
      throw first instanceof SaveError ? first : new SaveError('The save file could not be read.');
    }
  }

  async remove(slot: string): Promise<void> {
    for (const backup of [false, true]) if (await this.storage.exists(this.file(slot, backup))) await this.storage.remove(this.file(slot, backup));
  }

  async list(): Promise<SlotInfo[]> {
    const out: SlotInfo[] = [];
    for (const slot of SLOT_NAMES) {
      if (!(await this.storage.exists(this.file(slot)))) {
        out.push({ slot, exists: false, damaged: false, label: '', savedAt: '', scene: '' });
        continue;
      }
      try {
        const { data } = await this.read(slot);
        out.push({ slot, exists: true, damaged: false, label: data.label, savedAt: data.savedAt, scene: data.scene });
      } catch {
        out.push({ slot, exists: true, damaged: true, label: '', savedAt: '', scene: '' });
      }
    }
    return out;
  }
}
