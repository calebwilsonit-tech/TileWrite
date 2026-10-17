import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { CURRENT_SCHEMA_VERSION } from '../project/schema';

/**
 * Translations. The text you write in conversations, cutscenes, items and event rows is the *source language*; a
 * language file maps that exact text to another language. Anything with no translation shows the source text, so a
 * half-translated game still works. Plain data in `assets/localization/<code>.strings.json`.
 */
export const LanguageSchema = z.object({
  schemaVersion: z.number().int().min(1).default(CURRENT_SCHEMA_VERSION),
  /** Short code used in file names and settings: "fr", "pt-br". */
  code: z.string().regex(/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/, 'a language code like fr or pt-br'),
  /** What the language is called in its own words, shown in the settings menu: "Français". */
  name: z.string().min(1),
  /** Source text to translated text. Empty translations count as missing. */
  strings: z.record(z.string(), z.string()).default({}),
});
export type LanguageData = z.infer<typeof LanguageSchema>;

export function newLanguage(code: string, name: string): LanguageData {
  return { schemaVersion: CURRENT_SCHEMA_VERSION, code, name, strings: {} };
}

/** The loaded languages and the one in use ('' = the text as written). */
export class StringTables {
  private readonly languages = new Map<string, LanguageData>();
  language = '';

  set(lang: LanguageData): void {
    this.languages.set(lang.code, lang);
  }

  clear(): void {
    this.languages.clear();
    this.language = '';
  }

  list(): { code: string; name: string }[] {
    return [...this.languages.values()].map((l) => ({ code: l.code, name: l.name })).sort((a, b) => a.code.localeCompare(b.code));
  }

  get(code: string): LanguageData | undefined {
    return this.languages.get(code);
  }

  /** The text in the current language, or as written when there is no translation. */
  t(text: string): string {
    if (this.language === '' || text === '') return text;
    const hit = this.languages.get(this.language)?.strings[text];
    return hit ? hit : text;
  }

  /** Translate a template and fill in its {placeholders}: `fmt('Received {item}', { item: 'Bread' })`. */
  fmt(template: string, values: Record<string, string | number>): string {
    return this.t(template).replace(/\{([^{}]+)\}/g, (m, k: string) => (k in values ? String(values[k]) : m));
  }
}

/** Language codes the settings menu may offer, in the order players expect to see them: the source first. */
export function languageChoices(tables: StringTables, sourceName = 'Default'): { code: string; name: string }[] {
  return [{ code: '', name: sourceName }, ...tables.list()];
}

// ---------- CSV, for sending strings to a translator ----------

/** Rows of [source, translation] as CSV (UTF-8, quotes doubled), with a header row. */
export function stringsToCsv(rows: readonly (readonly [string, string])[]): string {
  const cell = (s: string): string => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  return ['source,translation', ...rows.map(([a, b]) => `${cell(a)},${cell(b)}`)].join('\r\n') + '\r\n';
}

/** Parse CSV text into rows of cells. Handles quoted cells with commas, quotes and line breaks. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cur = '';
  let quoted = false;
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // a byte-order mark from a spreadsheet
  for (let i = 0; i < src.length; i++) {
    const c = src[i]!;
    if (quoted) {
      if (c === '"') {
        if (src[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(cur);
      cur = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && src[i + 1] === '\n') i++;
      row.push(cur);
      cur = '';
      rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== '' || row.length > 0) {
    row.push(cur);
    rows.push(row);
  }
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

/** Read a translator's CSV back: only rows whose source is in `known` are taken; the rest are reported. */
export function csvToStrings(text: string, known: ReadonlySet<string>): { strings: Record<string, string>; skipped: number } {
  const strings: Record<string, string> = {};
  let skipped = 0;
  const rows = parseCsv(text);
  for (const [i, r] of rows.entries()) {
    if (i === 0 && r[0] === 'source') continue;
    const [source, translation] = [r[0] ?? '', r[1] ?? ''];
    if (!known.has(source)) {
      skipped++;
      continue;
    }
    if (translation.trim() !== '') strings[source] = translation;
  }
  return { strings, skipped };
}
