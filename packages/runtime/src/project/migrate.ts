import { CURRENT_SCHEMA_VERSION } from './schema';

export type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Migrations keyed by the version they upgrade FROM. Add an entry here every time the format changes,
 * then bump CURRENT_SCHEMA_VERSION. Version 1 is the first release, so there is nothing to upgrade yet.
 */
export const SCENE_MIGRATIONS: Record<number, Migration> = {};
export const PROJECT_MIGRATIONS: Record<number, Migration> = {};

export type MigrateResult = { ok: true; value: Record<string, unknown>; from: number } | { ok: false; error: string };

function run(input: unknown, migrations: Record<number, Migration>, what: string): MigrateResult {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    return { ok: false, error: `This ${what} file is not a JSON object.` };
  }
  let data = { ...(input as Record<string, unknown>) };
  const from = data.schemaVersion;
  if (typeof from !== 'number' || !Number.isInteger(from) || from < 1) {
    return { ok: false, error: `This ${what} file has no valid schemaVersion, so Tilewright cannot tell which version made it.` };
  }
  if (from > CURRENT_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `This ${what} file was made by a newer Tilewright (format ${from}); this version understands up to ${CURRENT_SCHEMA_VERSION}. Update Tilewright to open it.`,
    };
  }
  let v = from;
  while (v < CURRENT_SCHEMA_VERSION) {
    const step = migrations[v];
    if (!step) return { ok: false, error: `No upgrade path from ${what} format ${v}.` };
    data = step(data);
    v++;
    data.schemaVersion = v;
  }
  return { ok: true, value: data, from };
}

export const migrateScene = (input: unknown): MigrateResult => run(input, SCENE_MIGRATIONS, 'scene');
export const migrateProject = (input: unknown): MigrateResult => run(input, PROJECT_MIGRATIONS, 'project');
