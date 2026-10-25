import { z } from 'zod';
import type { Assets } from '@tilewright/runtime';
import { host } from './plugins/host';
import type { DataKindDef, DataKnown } from './plugins/extensions';

/**
 * The kinds of data plugins keep in the project's own files (items, minigames...): what the editor, the checks, the translations list and
 * the running game ask of them, in one place. A kind exists while the plugin that adds it is on; with it off its file is left as it is.
 */

/** The records of every kind that is on, by kind. */
export type ProjectDataSet = Record<string, readonly unknown[]>;

/** The kinds that are on, in the order the plugins were turned on. */
export function dataKinds(): DataKindDef[] {
  return [...host.ext.dataKinds.values()];
}

/** The names of the records of each kind, and of everything that can be carried, for checks. */
export function dataKnown(data: ProjectDataSet): DataKnown {
  const ids = (kind: string): ReadonlySet<string> => {
    const def = host.ext.dataKinds.get(kind);
    return new Set(def ? (data[kind] ?? []).map((r) => def.keyOf(r)) : []);
  };
  const carried = new Set<string>();
  for (const def of host.ext.dataKinds.values()) if (def.carries) for (const r of data[def.id] ?? []) carried.add(def.keyOf(r));
  return { ids, carried };
}

/** Put the project's records where the game reads them (`assets.data`). Kinds that are not on are not loaded. */
export function fillAssetData(assets: Pick<Assets, 'data'>, data: ProjectDataSet): void {
  assets.data.clear();
  for (const def of host.ext.dataKinds.values()) assets.data.set(def.id, new Map((data[def.id] ?? []).map((r) => [def.keyOf(r), r])));
}

/** Put one record where the game reads it (for tests and tools that build a game by hand). */
export function putRecord(assets: Pick<Assets, 'data'>, kind: string, key: string, record: unknown): void {
  let m = assets.data.get(kind);
  if (!m) assets.data.set(kind, (m = new Map()));
  m.set(key, record);
}

/** The records of a kind as the running game has them (empty when no plugin that is on keeps that kind). */
export function dataOf<T = unknown>(assets: Pick<Assets, 'data'>, kind: string): ReadonlyMap<string, T> {
  return (assets.data.get(kind) ?? new Map()) as ReadonlyMap<string, T>;
}

/** Plain-English problems with every kind that is on. */
export function checkData(data: ProjectDataSet): string[] {
  const known = dataKnown(data);
  return dataKinds().flatMap((def) => def.check?.(data[def.id] ?? [], known) ?? []);
}

/** The words of every record of every kind, for the translations list. */
export function dataTexts(data: ProjectDataSet): { text: string; where: string }[] {
  return dataKinds().flatMap((def) => (data[def.id] ?? []).flatMap((r) => def.texts?.(r) ?? []));
}

/** Read the records out of the text of a kind's file. Every record must be valid, or none is used (and the reason is said). */
export function parseDataFile(def: DataKindDef, text: string): { records: unknown[]; problems: string[] } {
  const what = def.label.toLowerCase();
  try {
    const raw = JSON.parse(text) as Record<string, unknown>;
    const list = raw?.[def.listKey];
    const records: unknown[] = [];
    for (const r of Array.isArray(list) ? list : []) {
      const parsed = def.schema.safeParse(r);
      if (!parsed.success) return { records: [], problems: [`The ${what} file is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`] };
      records.push(parsed.data);
    }
    if (list !== undefined && !Array.isArray(list)) return { records: [], problems: [`The ${what} file is not valid: ${def.listKey} must be a list.`] };
    return { records, problems: [] };
  } catch (e) {
    return { records: [], problems: [`The ${what} file could not be read (${(e as Error).message}).`] };
  }
}

/** The assistant's tool for a kind of data: replace the whole list. Its input is the kind's own schema, so Claude is told exactly what a record is. */
export function dataToolOf(def: DataKindDef): { name: string; description: string; input_schema: Record<string, unknown>; kind: 'act' } {
  const item = z.toJSONSchema(def.schema as unknown as z.ZodType, { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
  delete item.$schema;
  return {
    name: `write_${def.id}`,
    description: def.assistant?.description ?? `Replace the project's whole list of ${def.label.toLowerCase()} (start from story_overview and send everything back, changed).`,
    input_schema: { type: 'object', properties: { [def.listKey]: { type: 'array', items: item, maxItems: 100 } }, required: [def.listKey] },
    kind: 'act',
  };
}

/** The first name two records share, or null. */
export function duplicateKey(def: DataKindDef, records: readonly unknown[]): string | null {
  const seen = new Set<string>();
  for (const r of records) {
    const k = def.keyOf(r);
    if (seen.has(k)) return k;
    seen.add(k);
  }
  return null;
}
