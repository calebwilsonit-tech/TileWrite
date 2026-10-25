/**
 * The rules for a name inside a project, with no file system and no Node: usable in the editor's window as well as in its main process.
 */

/** A path that is not allowed, worded for the person (and for Claude, who reads it and tries something else). */
export class PathProblem extends Error {}

const RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9]|conin\$|conout\$)$/i;

/**
 * A relative path inside a project, tidied: slashes forward, no `.` parts. Refuses everything that is not plainly a path to
 * a file or folder below the project: an empty name, `..`, absolute paths, drive letters, network paths, device names, streams.
 */
export function cleanRelative(rel: string): string {
  if (typeof rel !== 'string') throw new PathProblem('The path must be text.');
  if (rel.length === 0 || rel.trim().length === 0) throw new PathProblem('The path is empty.');
  if (rel.length > 400) throw new PathProblem('The path is too long.');
  if ([...rel].some((c) => c.charCodeAt(0) < 32)) throw new PathProblem('The path has a control character in it.');
  // percent-encoding is not decoded anywhere, but a path that says "%2e%2e" is trying something
  if (/%2e|%2f|%5c/i.test(rel)) throw new PathProblem('The path has an encoded dot or slash in it, which is not allowed.');
  const slashed = rel.replace(/\\/g, '/');
  if (slashed.startsWith('/')) throw new PathProblem('Give the path from the project folder (like "assets/screens.json"), not from the root of the disk.');
  if (/^[A-Za-z]:/.test(slashed)) throw new PathProblem('Give the path from the project folder (like "assets/screens.json"), without a drive letter.');
  if (slashed.startsWith('~')) throw new PathProblem('Give the path from the project folder; "~" is not understood.');
  const parts: string[] = [];
  for (const part of slashed.split('/')) {
    if (part === '' || part === '.') continue;
    if (part === '..') throw new PathProblem('".." (going up a folder) is not allowed: only files inside the project can be used.');
    if (part.includes(':')) throw new PathProblem(`"${part}" has a colon in it (a drive or a hidden stream), which is not allowed.`);
    if (/[<>"|?*]/.test(part)) throw new PathProblem(`"${part}" has a character that cannot be in a file name.`);
    if (/[. ]$/.test(part)) throw new PathProblem(`"${part}" ends with a dot or a space, which Windows treats as something else.`);
    if (RESERVED.test(part.split('.')[0]!)) throw new PathProblem(`"${part}" is a reserved name (a device on Windows).`);
    if (/~\d/.test(part) && /^[^.]{1,8}~\d(\.|$)/.test(part)) throw new PathProblem(`"${part}" looks like a short Windows name; use the full name.`);
    parts.push(part);
  }
  if (parts.length === 0) throw new PathProblem('The path names the project folder itself; name a file or a folder inside it.');
  return parts.join('/');
}

/**
 * Files that very likely hold a secret (a password, a key, a token). The assistant neither reads nor lists them, whatever they are
 * called inside the project; the person can add more patterns in Project settings. A pattern is matched against the whole path and
 * against each part of it: `*` is any run of letters, `**` as a part means "everything below", and case does not matter.
 */
export const SECRET_PATTERNS: readonly string[] = [
  '.env',
  '.env.*',
  '*.env',
  '*.pem',
  '*.key',
  '*.p12',
  '*.pfx',
  '*.jks',
  '*.keystore',
  '*.ppk',
  '*.kdbx',
  '*.secret',
  '*.secrets',
  'secrets.*',
  'secret.*',
  'id_rsa*',
  'id_dsa*',
  'id_ecdsa*',
  'id_ed25519*',
  '.npmrc',
  '.pypirc',
  '.netrc',
  '.git-credentials',
  '.htpasswd',
  'credentials',
  'credentials.*',
  'service-account*.json',
  'kubeconfig',
  '.ssh/**',
  '.aws/**',
  '.gnupg/**',
  '.docker/config.json',
  '.git/**',
];

const globCache = new Map<string, RegExp>();

function globToRegExp(pattern: string): RegExp {
  let re = globCache.get(pattern);
  if (!re) {
    const body = pattern
      .replace(/\\/g, '/')
      .split('/')
      .map((part) => (part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]')))
      .join('/');
    re = new RegExp(`^${body}$`, 'i');
    globCache.set(pattern, re);
  }
  return re;
}

/** Why a path may not be read or listed (worded for Claude and the person), or null when it may. `rel` is already tidied by `cleanRelative`. */
export function secretReason(rel: string, extra: readonly string[] = []): string | null {
  const parts = rel.replace(/\\/g, '/').split('/').filter(Boolean);
  const whole = parts.join('/');
  for (const pattern of [...SECRET_PATTERNS, ...extra]) {
    const p = pattern.trim();
    if (!p) continue;
    const re = globToRegExp(p);
    const hit = p.includes('/') ? re.test(whole) || (p.endsWith('/**') && new RegExp(`(^|/)${globToRegExp(p).source.slice(1, -1)}$`, 'i').test(whole)) : parts.some((part) => re.test(part));
    if (hit) return `"${whole}" is kept from the assistant because it may hold a secret (it matches "${p}"). The person can change the list in Project settings.`;
  }
  return null;
}
