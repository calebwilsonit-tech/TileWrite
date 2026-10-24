/**
 * Versions the way plugins use them: `major.minor.patch` (and an optional `-note`), and ranges made of the usual pieces:
 * `1.2.3` (exactly), `^1.2.3` (the same major, at least this), `~1.2.3` (the same minor, at least this), `>=1.2.0`, `<2.0.0`, `1.x`,
 * `*`, several joined with spaces (all must hold) and alternatives joined with `||`. Small on purpose: no dependency, and every
 * message a person reads about a version problem is plain English.
 */

export interface Version {
  major: number;
  minor: number;
  patch: number;
  /** After the dash: "beta.1". A version with a note is older than the same version without one. */
  note: string;
}

const VERSION = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(text: string): Version | null {
  const m = VERSION.exec(text.trim());
  return m ? { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]), note: m[4] ?? '' } : null;
}

export const isVersion = (text: string): boolean => parseVersion(text) !== null;

/** -1, 0 or 1 (a < b, equal, a > b). A version with a note is older than the plain one. */
export function compareVersions(a: Version, b: Version): number {
  for (const k of ['major', 'minor', 'patch'] as const) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  if (a.note === b.note) return 0;
  if (a.note === '') return 1;
  if (b.note === '') return -1;
  return a.note < b.note ? -1 : 1;
}

export const compareVersionText = (a: string, b: string): number => {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return a < b ? -1 : a > b ? 1 : 0;
  return compareVersions(x, y);
};

const wild = (s: string | undefined): boolean => s === undefined || s === '' || s === 'x' || s === 'X' || s === '*';

/** One comparator such as `^1.2.3`, `>=1.0.0` or `1.x`; true when the version satisfies it. */
function satisfiesOne(v: Version, piece: string): boolean | null {
  const m = /^(\^|~|>=|<=|>|<|=)?\s*v?(\d+|x|X|\*)(?:\.(\d+|x|X|\*))?(?:\.(\d+|x|X|\*))?(?:-([0-9A-Za-z.-]+))?$/.exec(piece.trim());
  if (!m) return null;
  const op = m[1] ?? '';
  const [, , a, b, c, note] = m;
  if (wild(a)) return true;
  const base: Version = { major: Number(a), minor: wild(b) ? 0 : Number(b), patch: wild(c) ? 0 : Number(c), note: note ?? '' };
  const cmp = compareVersions(v, base);
  switch (op) {
    case '^':
      // the same major (or, for 0.x, the same minor): at least this
      return cmp >= 0 && (base.major > 0 ? v.major === base.major : v.major === 0 && (base.minor > 0 ? v.minor === base.minor : v.minor === 0 && v.patch === base.patch));
    case '~':
      return cmp >= 0 && v.major === base.major && v.minor === base.minor;
    case '>=':
      return cmp >= 0;
    case '<=':
      return cmp <= 0 || (wild(b) && v.major === base.major) || (wild(c) && v.major === base.major && v.minor === base.minor);
    case '>':
      return cmp > 0;
    case '<':
      return cmp < 0;
    default:
      // "1.x", "1.2.x", "1.2.3"
      if (wild(b)) return v.major === base.major;
      if (wild(c)) return v.major === base.major && v.minor === base.minor;
      return cmp === 0;
  }
}

/** Is there a range this text could be? (So a manifest with `"^banana"` is refused with a message.) */
export function isRange(range: string): boolean {
  return range
    .split('||')
    .every((alt) => alt.trim() === '' || alt.trim().split(/\s+/).every((p) => satisfiesOne({ major: 1, minor: 0, patch: 0, note: '' }, p) !== null));
}

/** Does the version fit the range? An empty range or `*` fits every version. */
export function satisfies(version: string, range: string): boolean {
  const v = parseVersion(version);
  if (!v) return false;
  const r = range.trim();
  if (r === '' || r === '*') return true;
  return r.split('||').some((alt) =>
    alt
      .trim()
      .split(/\s+/)
      .filter((p) => p !== '')
      .every((piece) => satisfiesOne(v, piece) === true),
  );
}

/** The highest of these versions that fits the range, or undefined. */
export function maxSatisfying(versions: readonly string[], range: string): string | undefined {
  return versions.filter((v) => satisfies(v, range)).sort(compareVersionText).pop();
}

/** What changed between two versions, as a word: "major", "minor", "patch" or "none". */
export function bumpOf(from: string, to: string): 'major' | 'minor' | 'patch' | 'none' | 'older' {
  const a = parseVersion(from);
  const b = parseVersion(to);
  if (!a || !b) return 'none';
  if (compareVersions(b, a) < 0) return 'older';
  if (b.major !== a.major) return 'major';
  if (b.minor !== a.minor) return 'minor';
  if (b.patch !== a.patch) return 'patch';
  return 'none';
}
