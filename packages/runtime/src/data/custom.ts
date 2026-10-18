import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION, EventRowSchema } from '../project/schema';

/**
 * Blocks a project makes for itself, with no code: custom components (named, typed data an object carries), custom
 * behaviours (event sheets with settings of their own, reusable on any object), and custom events (named things that can
 * happen, with the facts they carry). Plain data in `assets/components/`, `assets/behaviors/` and `assets/events.json`.
 */

export const FIELD_TYPES = ['number', 'boolean', 'text', 'select', 'color', 'sprite', 'sound', 'prefab', 'tableRow'] as const;
export type CustomFieldType = (typeof FIELD_TYPES)[number];

export const FIELD_TYPE_NAMES: Record<CustomFieldType, string> = {
  number: 'Number',
  boolean: 'Yes / no',
  text: 'Text',
  select: 'One of a list',
  color: 'Colour',
  sprite: 'Sprite',
  sound: 'Sound',
  prefab: 'Prefab',
  tableRow: 'A row of a data table',
};

export const CustomFieldSchema = z.object({
  key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, 'Field names use letters, numbers and _, and start with a letter'),
  label: z.string().default(''),
  type: z.enum(FIELD_TYPES).default('number'),
  default: z.union([z.string(), z.number(), z.boolean()]).default(0),
  help: z.string().default(''),
  options: z.array(z.string()).default([]),
  min: z.number().optional(),
  max: z.number().optional(),
  step: z.number().optional(),
  /** For "a row of a data table": the table. */
  table: z.string().default(''),
});
export type CustomField = z.infer<typeof CustomFieldSchema>;

/** Names become component ids, so keep them simple. */
export const BLOCK_NAME = /^[A-Za-z][A-Za-z0-9]{0,30}$/;
const NameSchema = z.string().regex(BLOCK_NAME, 'Names use letters and numbers, and start with a letter');

export const CustomComponentSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  name: NameSchema,
  description: z.string().default(''),
  fields: z.array(CustomFieldSchema).default([]),
});
export type CustomComponentData = z.infer<typeof CustomComponentSchema>;

export const SignalDefSchema = z.object({ name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]*$/), label: z.string().default('') });

export const CustomBehaviorSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  name: NameSchema,
  description: z.string().default(''),
  category: z.string().default('Custom'),
  /** Settings shown in the Inspector; the rows read them as `self.<name>`. */
  params: z.array(CustomFieldSchema).default([]),
  inputs: z.array(SignalDefSchema).default([]),
  outputs: z.array(SignalDefSchema).default([]),
  /** The event rows that run for every object that has the behaviour each tick; "the picked object" means that object. */
  rows: z.array(EventRowSchema).default([]),
});
export type CustomBehaviorData = z.infer<typeof CustomBehaviorSchema>;

export const EventDefSchema = z.object({
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_-]{0,31}$/, 'Event names use letters, numbers, - and _'),
  label: z.string().default(''),
  description: z.string().default(''),
  /** The facts that come with it (named values other rows can read as `event.<key>`). */
  fields: z.array(z.object({ key: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/), type: z.enum(['number', 'text', 'boolean']).default('text') })).default([]),
});
export type EventDef = z.infer<typeof EventDefSchema>;

export const EventsFileSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  events: z.array(EventDefSchema).default([]),
});

export function newCustomComponent(name: string): CustomComponentData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, description: '', fields: [] };
}

export function newCustomBehavior(name: string): CustomBehaviorData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, description: '', category: 'Custom', params: [], inputs: [], outputs: [], rows: [] };
}

/** The value a field starts with. */
export function fieldDefault(f: CustomField): string | number | boolean {
  if (f.type === 'select') return f.options.includes(String(f.default)) ? f.default : (f.options[0] ?? '');
  if (f.type === 'number') return typeof f.default === 'number' ? f.default : Number(f.default) || 0;
  if (f.type === 'boolean') return f.default === true;
  if (f.type === 'color') return typeof f.default === 'string' && /^#[0-9a-fA-F]{6}$/.test(f.default) ? f.default : '#ffffff';
  return typeof f.default === 'string' ? f.default : f.type === 'text' ? String(f.default) : '';
}

/** Mistakes in a custom block's fields, in plain English. */
export function checkFields(what: string, fields: readonly CustomField[], tables: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const f of fields) {
    if (seen.has(f.key)) out.push(`${what} has two fields called "${f.key}".`);
    seen.add(f.key);
    if (f.type === 'select' && f.options.length === 0) out.push(`The field "${f.key}" of ${what} is a list but has no choices.`);
    if (f.type === 'tableRow' && !tables.has(f.table)) out.push(`The field "${f.key}" of ${what} picks from the table "${f.table}", which does not exist.`);
  }
  return out;
}
