import {
  CURRENT_SCHEMA_VERSION,
  CustomBehaviorSchema,
  CustomComponentSchema,
  EventsFileSchema,
  TableSchema,
  type CustomBehaviorData,
  type CustomComponentData,
  type EventDef,
  type TableData,
} from '@tilewright/runtime';
import type { z } from 'zod';
import type { AssetFs } from '../studio/assets';
import { joinPath } from './api';
import { UserError } from './io';

/** Files the project's own data and blocks live in. */
export const TABLE_DIR = 'assets/tables';
export const COMPONENT_DIR = 'assets/components';
export const BEHAVIOR_DIR = 'assets/behaviors';
export const EVENTS_FILE = 'assets/events.json';
const TABLE_EXT = '.table.json';
const COMPONENT_EXT = '.component.json';
const BEHAVIOR_EXT = '.behavior.json';

const json = (v: unknown): string => JSON.stringify(v, null, 2) + '\n';

async function loadFolder<S extends z.ZodTypeAny>(fs: AssetFs, dir: string, folder: string, ext: string, schema: S, what: string): Promise<{ items: z.output<S>[]; problems: string[] }> {
  const items: z.output<S>[] = [];
  const problems: string[] = [];
  let entries: { name: string; dir: boolean }[] = [];
  try {
    entries = await fs.list(joinPath(dir, folder));
  } catch {
    return { items, problems };
  }
  for (const e of entries.filter((x) => !x.dir && x.name.endsWith(ext)).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const r = schema.safeParse(JSON.parse(await fs.read(joinPath(dir, folder, e.name))));
      if (r.success) items.push(r.data);
      else problems.push(`The ${what} file "${e.name}" is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`);
    } catch (err) {
      problems.push(`The ${what} file "${e.name}" could not be read (${(err as Error).message}).`);
    }
  }
  return { items, problems };
}

export const loadTables = (fs: AssetFs, dir: string) => loadFolder(fs, dir, TABLE_DIR, TABLE_EXT, TableSchema, 'table');
export const loadComponents = (fs: AssetFs, dir: string) => loadFolder(fs, dir, COMPONENT_DIR, COMPONENT_EXT, CustomComponentSchema, 'component');
export const loadCustomBehaviors = (fs: AssetFs, dir: string) => loadFolder(fs, dir, BEHAVIOR_DIR, BEHAVIOR_EXT, CustomBehaviorSchema, 'behaviour');

export async function loadEventDefs(fs: AssetFs, dir: string): Promise<{ events: EventDef[]; problems: string[] }> {
  const file = joinPath(dir, EVENTS_FILE);
  try {
    if (!(await fs.exists(file))) return { events: [], problems: [] };
    const r = EventsFileSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { events: [], problems: [`The events file is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { events: r.data.events, problems: [] };
  } catch (e) {
    return { events: [], problems: [`The events file could not be read (${(e as Error).message}).`] };
  }
}

export async function saveTable(fs: AssetFs, dir: string, t: TableData): Promise<void> {
  const r = TableSchema.safeParse(t);
  if (!r.success) throw new UserError(`The table "${t.name}" cannot be saved: ${r.error.issues[0]?.message ?? 'it is not valid'}.`);
  await fs.write(joinPath(dir, TABLE_DIR, `${t.name}${TABLE_EXT}`), json({ ...t, schemaVersion: CURRENT_SCHEMA_VERSION }));
}

export async function saveComponent(fs: AssetFs, dir: string, c: CustomComponentData): Promise<void> {
  await fs.write(joinPath(dir, COMPONENT_DIR, `${c.name}${COMPONENT_EXT}`), json({ ...c, schemaVersion: CURRENT_SCHEMA_VERSION }));
}

export async function saveCustomBehavior(fs: AssetFs, dir: string, b: CustomBehaviorData): Promise<void> {
  await fs.write(joinPath(dir, BEHAVIOR_DIR, `${b.name}${BEHAVIOR_EXT}`), json({ ...b, schemaVersion: CURRENT_SCHEMA_VERSION }));
}

export async function saveEventDefs(fs: AssetFs, dir: string, events: readonly EventDef[]): Promise<void> {
  const names = new Set<string>();
  for (const e of events) {
    if (names.has(e.name)) throw new UserError(`Two events are both called "${e.name}".`);
    names.add(e.name);
  }
  await fs.write(joinPath(dir, EVENTS_FILE), json({ schemaVersion: CURRENT_SCHEMA_VERSION, events }));
}

export async function deleteTable(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(joinPath(dir, TABLE_DIR, `${name}${TABLE_EXT}`));
}

export async function deleteComponent(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(joinPath(dir, COMPONENT_DIR, `${name}${COMPONENT_EXT}`));
}

export async function deleteCustomBehavior(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(joinPath(dir, BEHAVIOR_DIR, `${name}${BEHAVIOR_EXT}`));
}
