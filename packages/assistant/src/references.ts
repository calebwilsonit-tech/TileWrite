import { groupIdOf, type IndexedFile } from './readers';

/**
 * What in a project points at what: a scene at the sprites and prefabs it places, a screen at the table it lists, a script at the
 * sound it plays, project.json at its scenes. Found by reading the project's own files for the names and paths of its other files,
 * so it needs no knowledge of what each plugin keeps where. It is a good guess, not a proof: it finds a name that is written out
 * exactly, which is how the editor writes every reference, and it cannot see one built from pieces in a script. Pure (the text of
 * the files comes in).
 */

export interface TextFile {
  path: string;
  text: string;
}

export interface Reference {
  /** The file that mentions the other. */
  from: string;
  /** The file it points at. */
  to: string;
  /** Where in the file it was found (a field's name, or "script"): up to three examples. */
  via: string[];
}

export interface ProjectRefs {
  uses: Map<string, Reference[]>;
  usedBy: Map<string, Reference[]>;
  /** How many text files were read for it, and how many were left out (too big, or over the limit). */
  read: number;
  skipped: number;
}

/** Groups whose files are things other files use (a sprite is used by a scene; nothing "uses" a scene but the project). */
export const ASSET_GROUPS: ReadonlySet<string> = new Set(['sprites', 'structures', 'tables', 'sounds', 'images']);

const base = (path: string): string => path.split('/').pop() ?? path;

/** The names a file can be referred to by, besides its path: a sprite by its name, a table by its name, a sound by its file name. */
function namesOf(path: string): string[] {
  const out = new Set<string>([path]);
  const b = base(path);
  const stem = /^(.+?)\.(sprite|prefab|table|dialogue|cutscene|structure|scene)\.json$/.exec(b);
  if (stem) out.add(stem[1]!);
  const g = groupIdOf(path);
  if (g === 'sounds' || g === 'images' || g === 'scripts') {
    out.add(b);
    out.add(b.replace(/\.[^.]+$/, ''));
  }
  const slash = path.indexOf('/');
  if (slash > 0) out.add(path.slice(slash + 1)); // "audio/jump.wav" for "assets/audio/jump.wav"
  return [...out].filter((n) => n.length >= 3);
}

/** The ids a list file defines (items, minigames, skins...): a file at assets/ whose one array is made of objects with an "id". */
function idsOf(path: string, json: unknown): string[] {
  if (!/^assets\/[^/]+\.json$/.test(path) || json === null || typeof json !== 'object' || Array.isArray(json)) return [];
  const arrays = Object.values(json as Record<string, unknown>).filter((v): v is Record<string, unknown>[] => Array.isArray(v) && v.length > 0 && v.every((x) => x !== null && typeof x === 'object' && typeof (x as { id?: unknown }).id === 'string'));
  if (arrays.length !== 1) return [];
  return arrays[0]!.map((x) => String(x.id)).filter((id) => id.length >= 3);
}

/** Screens a screens file defines. */
function screenNames(path: string, json: unknown): string[] {
  if (!/(^|\/)screens\.json$/.test(path) || json === null || typeof json !== 'object') return [];
  const screens = (json as { screens?: unknown }).screens;
  return Array.isArray(screens) ? screens.map((s) => String((s as { name?: unknown }).name ?? '')).filter((n) => n.length >= 3) : [];
}

interface Mention {
  text: string;
  via: string;
}

function* stringsOf(value: unknown, key = '', depth = 0): Generator<Mention> {
  if (depth > 40) return;
  if (typeof value === 'string') yield { text: value, via: key };
  else if (Array.isArray(value)) for (const v of value) yield* stringsOf(v, key, depth + 1);
  else if (value !== null && typeof value === 'object') for (const [k, v] of Object.entries(value as Record<string, unknown>)) yield* stringsOf(v, k, depth + 1);
}

/** Strings written in a script, between single or double quotes or back ticks (what it names: sounds, sprites, prefabs, tables). */
function* scriptStrings(text: string): Generator<Mention> {
  for (const m of text.matchAll(/(['"`])((?:\\.|(?!\1)[^\\\n]){2,200}?)\1/g)) yield { text: m[2]!, via: 'script' };
}

export function buildReferences(files: readonly IndexedFile[], texts: readonly TextFile[]): ProjectRefs {
  const defs = new Map<string, Set<string>>();
  const define = (key: string, file: string): void => {
    if (key.length < 3) return;
    const set = defs.get(key) ?? new Set<string>();
    set.add(file);
    defs.set(key, set);
  };
  for (const f of files) for (const n of namesOf(f.path)) define(n, f.path);
  const parsed = new Map<string, unknown>();
  for (const t of texts) {
    if (!t.path.endsWith('.json')) continue;
    try {
      const json: unknown = JSON.parse(t.text);
      parsed.set(t.path, json);
      for (const id of idsOf(t.path, json)) define(id, t.path);
      for (const n of screenNames(t.path, json)) define(n, t.path);
    } catch {
      /* not JSON: it is searched as text only if it is a script */
    }
  }

  const found = new Map<string, Map<string, Set<string>>>(); // from -> to -> via
  const add = (from: string, to: string, via: string): void => {
    if (from === to) return;
    const tos = found.get(from) ?? new Map<string, Set<string>>();
    const vias = tos.get(to) ?? new Set<string>();
    if (vias.size < 3) vias.add(via || 'text');
    tos.set(to, vias);
    found.set(from, tos);
  };
  const consider = (from: string, m: Mention): void => {
    const direct = defs.get(m.text);
    if (direct) for (const to of direct) add(from, to, m.via);
    // a table is named inside words ("{Buildings.hut.cost}", "table:Buildings") and a variable holds an item ("item:key")
    for (const t of m.text.matchAll(/\{([A-Za-z][A-Za-z0-9 _-]{1,40})\./g)) for (const to of defs.get(t[1]!) ?? []) add(from, to, m.via);
    for (const t of m.text.matchAll(/\btable:([A-Za-z][A-Za-z0-9 _-]{1,40})/g)) for (const to of defs.get(t[1]!) ?? []) add(from, to, m.via);
    const item = /^(?:item|slot):(.+)$/.exec(m.text);
    if (item) for (const to of defs.get(item[1]!) ?? []) add(from, to, m.via);
  };
  for (const t of texts) {
    const json = parsed.get(t.path);
    if (json !== undefined) for (const m of stringsOf(json)) consider(t.path, m);
    else if (/\.(ts|js)$/.test(t.path)) for (const m of scriptStrings(t.text)) consider(t.path, m);
  }

  const uses = new Map<string, Reference[]>();
  const usedBy = new Map<string, Reference[]>();
  for (const [from, tos] of found) {
    for (const [to, vias] of tos) {
      const ref: Reference = { from, to, via: [...vias] };
      uses.set(from, [...(uses.get(from) ?? []), ref]);
      usedBy.set(to, [...(usedBy.get(to) ?? []), ref]);
    }
  }
  for (const list of [...uses.values(), ...usedBy.values()]) list.sort((a, b) => a.from.localeCompare(b.from) || a.to.localeCompare(b.to));
  return { uses, usedBy, read: texts.length, skipped: 0 };
}

/** Files of the asset groups that nothing refers to (a candidate to clean up, or a thing the project forgot). */
export function unusedAssets(files: readonly IndexedFile[], refs: ProjectRefs): string[] {
  return files
    .filter((f) => ASSET_GROUPS.has(groupIdOf(f.path)) && !(refs.usedBy.get(f.path)?.length ?? 0))
    .map((f) => f.path)
    .sort();
}

const list = (names: readonly string[], most = 3): string => `${names.slice(0, most).join(', ')}${names.length > most ? ` and ${names.length - most} more` : ''}`;

/** The words after a file in the index: what uses it, or what it uses. Empty when it has neither. */
export function referenceNote(path: string, refs: ProjectRefs): string {
  const by = refs.usedBy.get(path) ?? [];
  const uses = refs.uses.get(path) ?? [];
  const parts: string[] = [];
  if (by.length > 0) parts.push(`used by ${list(by.map((r) => r.from))}`);
  else if (ASSET_GROUPS.has(groupIdOf(path))) parts.push('nothing uses it');
  if (uses.length > 0 && !ASSET_GROUPS.has(groupIdOf(path))) {
    const counts = new Map<string, number>();
    for (const r of uses) counts.set(groupIdOf(r.to), (counts.get(groupIdOf(r.to)) ?? 0) + 1);
    parts.push(`uses ${[...counts].map(([g, n]) => `${n} ${n === 1 && g !== 'other' && g !== 'story' ? g.replace(/s$/, '') : g}`).join(', ')}`);
  }
  return parts.join('; ');
}

/** What one file uses and what uses it, with where each reference was found (for the project_references tool). */
export function describeReferences(path: string, refs: ProjectRefs): string {
  const lines: string[] = [];
  const fmt = (r: Reference, other: string): string => `  ${other}${r.via.length > 0 ? ` (in ${r.via.join(', ')})` : ''}`;
  const uses = refs.uses.get(path) ?? [];
  const by = refs.usedBy.get(path) ?? [];
  lines.push(`${path} uses ${uses.length} file${uses.length === 1 ? '' : 's'}:`, ...(uses.length > 0 ? uses.map((r) => fmt(r, r.to)) : ['  (none)']));
  lines.push(`${path} is used by ${by.length} file${by.length === 1 ? '' : 's'}:`, ...(by.length > 0 ? by.map((r) => fmt(r, r.from)) : ['  (none)']));
  lines.push('A reference is found when a file writes out the name or path of another exactly; one built from pieces in a script is not seen.');
  return lines.join('\n');
}
