import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION } from '../project/schema';

/**
 * Data tables: spreadsheets of game data (items, units, buildings, recipes, waves, cards, barks: anything). Plain data in
 * `assets/tables/<name>.table.json`. Every row has an `id`; the other columns are named and typed. Event sheets, behaviours,
 * the UI and the logic graph read a cell as the value `Table.row.column` (for example `Units.knight.hp`).
 */

export const COLUMN_TYPES = ['text', 'number', 'boolean', 'color', 'select', 'ref', 'sprite', 'prefab', 'sound'] as const;
export type ColumnType = (typeof COLUMN_TYPES)[number];

export const COLUMN_TYPE_NAMES: Record<ColumnType, string> = {
  text: 'Text',
  number: 'Number',
  boolean: 'Yes / no',
  color: 'Colour',
  select: 'One of a list',
  ref: 'A row of another table',
  sprite: 'Sprite',
  prefab: 'Prefab',
  sound: 'Sound',
};

export type CellValue = string | number | boolean;

export const ColumnSchema = z.object({
  id: z.string().regex(/^[A-Za-z_][A-Za-z0-9_]{0,31}$/, 'Column names use letters, numbers and _, and start with a letter'),
  label: z.string().default(''),
  type: z.enum(COLUMN_TYPES).default('text'),
  /** For "one of a list". */
  options: z.array(z.string()).default([]),
  /** For "a row of another table": that table's name. */
  table: z.string().default(''),
  default: z.union([z.string(), z.number(), z.boolean()]).optional(),
});
export type Column = z.infer<typeof ColumnSchema>;

export type TableRow = { id: string } & Record<string, CellValue>;
export const TableRowSchema = z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).refine((r) => typeof r.id === 'string' && r.id !== '', 'Every row needs an id') as unknown as z.ZodType<TableRow>;

export const TableSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  name: z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,31}$/, 'Table names use letters, numbers and _, and start with a letter'),
  description: z.string().default(''),
  columns: z.array(ColumnSchema).default([]),
  rows: z.array(TableRowSchema).default([]),
});
export type TableData = z.infer<typeof TableSchema>;

export function newTable(name: string): TableData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, name, description: '', columns: [{ id: 'name', label: 'Name', type: 'text', options: [], table: '' }], rows: [] };
}

/** The empty value of a column type (what a new cell starts as). */
export function defaultCell(c: Column): CellValue {
  if (c.default !== undefined) return c.default;
  switch (c.type) {
    case 'number':
      return 0;
    case 'boolean':
      return false;
    case 'color':
      return '#ffffff';
    case 'select':
      return c.options[0] ?? '';
    default:
      return '';
  }
}

/** Make a typed value out of whatever was typed into a cell (numbers from text, yes/no from words). */
export function coerceCell(c: Column, raw: unknown): CellValue {
  switch (c.type) {
    case 'number': {
      const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
      return Number.isFinite(n) ? n : 0;
    }
    case 'boolean':
      return typeof raw === 'boolean' ? raw : /^(true|yes|y|1|on)$/i.test(String(raw).trim());
    default:
      return typeof raw === 'string' || typeof raw === 'number' || typeof raw === 'boolean' ? (raw as CellValue) : String(raw ?? '');
  }
}

export function newRow(t: TableData, id: string): TableRow {
  const row: TableRow = { id };
  for (const c of t.columns) row[c.id] = defaultCell(c);
  return row;
}

/** An id for a new row that no row of the table uses. */
export function freshRowId(t: TableData, base = 'row'): string {
  const taken = new Set(t.rows.map((r) => r.id));
  let n = t.rows.length + 1;
  while (taken.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export function findRow(t: TableData | undefined, id: string): TableRow | undefined {
  return t?.rows.find((r) => r.id === id);
}

export function columnOf(t: TableData | undefined, id: string): Column | undefined {
  return t?.columns.find((c) => c.id === id);
}

/** One cell as the game reads it; `id` is the row's own id. */
export function tableCell(t: TableData | undefined, rowId: string, col: string): CellValue | undefined {
  const row = findRow(t, rowId);
  if (!row) return undefined;
  if (col === 'id') return row.id;
  const c = columnOf(t, col);
  if (!c) return undefined;
  const v = row[col];
  return v === undefined ? defaultCell(c) : v;
}

export type Tables = ReadonlyMap<string, TableData>;

/** "Units.knight.hp" -> the cell, or undefined when the table, row or column does not exist. */
export function readCell(tables: Tables, path: string): CellValue | undefined {
  const [table, row, col, ...rest] = path.split('.');
  if (!table || !row || !col || rest.length > 0) return undefined;
  return tableCell(tables.get(table), row, col);
}

/** The values of one column over all rows (for lists and pickers). */
export function columnValues(t: TableData, col: string): CellValue[] {
  return t.rows.map((r) => tableCell(t, r.id, col)).filter((v): v is CellValue => v !== undefined);
}

/** Rows whose cells equal what was asked for (`where` maps column to wanted value). */
export function selectRows(t: TableData | undefined, where: Record<string, CellValue>): TableRow[] {
  if (!t) return [];
  return t.rows.filter((r) => Object.entries(where).every(([k, v]) => tableCell(t, r.id, k) === v));
}

/** Mistakes in a table, in plain English. `known` are the names of other tables, sprites and so on, when known. */
export function checkTable(t: TableData, tables: Tables, known: { sprites?: ReadonlySet<string>; prefabs?: ReadonlySet<string>; sounds?: ReadonlySet<string> } = {}): string[] {
  const out: string[] = [];
  const ids = new Set<string>();
  const cols = new Set<string>();
  for (const c of t.columns) {
    if (cols.has(c.id)) out.push(`Two columns of "${t.name}" are both called "${c.id}".`);
    if (c.id === 'id') out.push(`A column of "${t.name}" is called "id", which every row already has.`);
    cols.add(c.id);
    if (c.type === 'select' && c.options.length === 0) out.push(`The column "${c.id}" of "${t.name}" is a list but has no choices.`);
    if (c.type === 'ref' && (c.table === '' || !tables.has(c.table))) out.push(`The column "${c.id}" of "${t.name}" points at the table "${c.table}", which does not exist.`);
  }
  for (const r of t.rows) {
    if (ids.has(r.id)) out.push(`Two rows of "${t.name}" are both called "${r.id}".`);
    ids.add(r.id);
    for (const c of t.columns) {
      const v = r[c.id];
      if (v === undefined) continue;
      if (c.type === 'number' && typeof v !== 'number') out.push(`"${t.name}" row "${r.id}": ${c.id} should be a number.`);
      if (c.type === 'select' && !c.options.includes(String(v))) out.push(`"${t.name}" row "${r.id}": ${c.id} is "${String(v)}", which is not one of ${c.options.join(', ')}.`);
      if (c.type === 'ref' && v !== '' && tables.has(c.table) && !findRow(tables.get(c.table), String(v))) out.push(`"${t.name}" row "${r.id}": ${c.id} points at "${String(v)}", which is not a row of ${c.table}.`);
      if (c.type === 'sprite' && v !== '' && known.sprites && !known.sprites.has(String(v))) out.push(`"${t.name}" row "${r.id}": the sprite "${String(v)}" does not exist.`);
      if (c.type === 'prefab' && v !== '' && known.prefabs && !known.prefabs.has(String(v))) out.push(`"${t.name}" row "${r.id}": the prefab "${String(v)}" does not exist.`);
      if (c.type === 'sound' && v !== '' && known.sounds && !known.sounds.has(String(v))) out.push(`"${t.name}" row "${r.id}": the sound "${String(v)}" does not exist.`);
    }
  }
  return out;
}

/** CSV text of a table (header row, then one line per row), so data can be edited in a real spreadsheet. */
export function tableToCsv(t: TableData): string {
  const esc = (v: CellValue | undefined): string => {
    const s = v === undefined ? '' : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = ['id', ...t.columns.map((c) => c.id)];
  const lines = [header.join(',')];
  for (const r of t.rows) lines.push([r.id, ...t.columns.map((c) => tableCell(t, r.id, c.id))].map(esc).join(','));
  return lines.join('\n') + '\n';
}

/** Rows from CSV text: the first line names the columns (`id` first); columns the table does not have are added as text. */
export function csvIntoTable(t: TableData, csv: string): TableData {
  const rows: string[][] = [];
  let cur: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < csv.length; i++) {
    const ch = csv[i]!;
    if (quoted) {
      if (ch === '"' && csv[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cur.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && csv[i + 1] === '\n') i++;
      cur.push(cell);
      cell = '';
      if (cur.some((c) => c !== '')) rows.push(cur);
      cur = [];
    } else cell += ch;
  }
  if (cell !== '' || cur.length > 0) {
    cur.push(cell);
    if (cur.some((c) => c !== '')) rows.push(cur);
  }
  const [header, ...body] = rows;
  if (!header) return t;
  const columns = [...t.columns];
  for (const h of header) if (h !== 'id' && !columns.some((c) => c.id === h) && /^[A-Za-z_][A-Za-z0-9_]{0,31}$/.test(h)) columns.push({ id: h, label: h, type: 'text', options: [], table: '' });
  const next: TableData = { ...t, columns, rows: [] };
  for (const line of body) {
    const row: TableRow = { id: '' };
    header.forEach((h, i) => {
      const raw = line[i] ?? '';
      if (h === 'id') row.id = raw;
      else {
        const c = columns.find((x) => x.id === h);
        if (c) row[h] = coerceCell(c, raw);
      }
    });
    if (row.id !== '') next.rows.push(row);
  }
  return next;
}
