import { GROUP_IDS, groupIdOf, type IndexedFile } from './readers';

/**
 * Searching a project for Claude: words inside the text files, and files by name or by kind. Pure (the lists and the text come
 * in; the editor reads the files). The answers are short and say how much was left out, so a thin result is not mistaken for
 * "nothing there".
 */

export class SearchProblem extends Error {}

export interface SearchHit {
  path: string;
  line: number;
  /** The line, or the part of a long line around the match. */
  text: string;
}

export interface TextOptions {
  caseSensitive?: boolean;
  /** The query is a regular expression. */
  regex?: boolean;
}

/** A function that finds the query in a line (the index of the match, or -1). */
export function textMatcher(query: string, opts: TextOptions = {}): (line: string) => number {
  if (query.length === 0) throw new SearchProblem('Give something to look for.');
  if (opts.regex) {
    let re: RegExp;
    try {
      re = new RegExp(query, opts.caseSensitive ? '' : 'i');
    } catch (e) {
      throw new SearchProblem(`"${query}" is not a valid pattern (${e instanceof Error ? e.message : String(e)}).`);
    }
    return (line) => line.search(re);
  }
  if (opts.caseSensitive) return (line) => line.indexOf(query);
  const lower = query.toLowerCase();
  return (line) => line.toLowerCase().indexOf(lower);
}

const WINDOW = 90;

/** The matches of one file's text, line by line (up to `room` of them). */
export function searchText(path: string, text: string, match: (line: string) => number, room: number): SearchHit[] {
  const out: SearchHit[] = [];
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length && out.length < room; i++) {
    const line = lines[i]!;
    const at = match(line);
    if (at < 0) continue;
    let shown = line.trim();
    if (line.length > WINDOW * 2) {
      const from = Math.max(0, at - WINDOW);
      shown = `${from > 0 ? '...' : ''}${line.slice(from, at + WINDOW).trim()}${at + WINDOW < line.length ? '...' : ''}`;
    }
    out.push({ path, line: i + 1, text: shown });
  }
  return out;
}

/** A file-name pattern: plain words match anywhere in the name; "*" stands for any run of characters, "?" for one. */
function nameMatcher(query: string): (p: string) => boolean {
  const q = query.trim().toLowerCase();
  if (!/[*?]/.test(q)) return (p) => p.toLowerCase().includes(q);
  const re = new RegExp(`^${q.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`);
  // a pattern with a slash is matched against the whole path, otherwise against the file's own name
  return q.includes('/') ? (p) => re.test(p.toLowerCase()) : (p) => re.test((p.split('/').pop() ?? p).toLowerCase());
}

export interface FileFilter {
  kind?: string | undefined;
  folder?: string | undefined;
}

export function filterFiles(files: readonly IndexedFile[], f: FileFilter): IndexedFile[] {
  if (f.kind !== undefined && !GROUP_IDS.includes(f.kind)) throw new SearchProblem(`"${f.kind}" is not a kind of file. The kinds are: ${GROUP_IDS.join(', ')}.`);
  const folder = f.folder?.trim().replace(/\\/g, '/').replace(/^\.?\/+|\/+$/g, '') ?? '';
  return files.filter((x) => (f.kind === undefined || groupIdOf(x.path) === f.kind) && (folder === '' || x.path === folder || x.path.startsWith(`${folder}/`)));
}

/** Files whose name fits the query, best first (an exact file name, then names that start with it, then the rest). */
export function findByName(files: readonly IndexedFile[], query: string): IndexedFile[] {
  const q = query.trim().toLowerCase();
  if (!q) return [...files].sort((a, b) => a.path.localeCompare(b.path));
  const fits = nameMatcher(q);
  const rank = (p: string): number => {
    const base = (p.split('/').pop() ?? p).toLowerCase();
    const stem = base.split('.')[0] ?? base; // "tree" of "tree.sprite.json"
    return base === q || stem === q ? 0 : base.startsWith(q) ? 1 : base.includes(q) ? 2 : 3;
  };
  return files.filter((f) => fits(f.path)).sort((a, b) => rank(a.path) - rank(b.path) || a.path.localeCompare(b.path));
}

const kb = (n: number): string => (n < 1024 ? `${n} bytes` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`);

export interface SearchReport {
  query: string;
  names: IndexedFile[];
  hits: SearchHit[];
  /** How many files had their text searched, and how many text files could not be (too big or unreadable). */
  searched: number;
  skipped: number;
  /** The search stopped at its limits: there may be more. */
  cut: boolean;
  kind?: string | undefined;
}

/** The answer, as Claude reads it. */
export function formatSearch(r: SearchReport, limits: { names: number; hits: number }): string {
  const out: string[] = [];
  const scope = r.kind ? ` among the ${r.kind}` : '';
  if (r.names.length > 0) {
    out.push(`Files${r.query ? ` named like "${r.query}"` : ''}${scope}: ${r.names.length}`);
    for (const f of r.names.slice(0, limits.names)) out.push(`  ${f.path}${f.size !== undefined ? ` (${kb(f.size)})` : ''}`);
    if (r.names.length > limits.names) out.push(`  ... and ${r.names.length - limits.names} more (narrow it with kind or folder)`);
  } else if (r.query) out.push(`No file${scope} has a name like "${r.query}".`);
  if (r.query && (r.hits.length > 0 || r.searched > 0)) {
    const files = new Set(r.hits.map((h) => h.path)).size;
    out.push(r.hits.length === 0 ? `No text${scope} contains "${r.query}" (${r.searched} files searched).` : `Text containing "${r.query}": ${r.hits.length}${r.cut ? ' or more' : ''} line${r.hits.length === 1 ? '' : 's'} in ${files} file${files === 1 ? '' : 's'} (${r.searched} searched).`);
    let last = '';
    for (const h of r.hits.slice(0, limits.hits)) {
      if (h.path !== last) out.push(`  ${h.path}`);
      last = h.path;
      out.push(`    ${h.line}: ${h.text}`);
    }
  }
  if (r.cut) out.push('The search stopped at its limit: ask for a narrower one (a kind, a folder, a longer word) to see the rest.');
  if (r.skipped > 0) out.push(`${r.skipped} text file${r.skipped === 1 ? ' was' : 's were'} too big or could not be read, so ${r.skipped === 1 ? 'it was' : 'they were'} not searched.`);
  return out.join('\n');
}
