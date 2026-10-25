import nodePath from 'node:path';
import { PathProblem, cleanRelative, secretReason } from './path-rules';


/**
 * Where files may be touched. Two places use this: the assistant (a path Claude names must stay inside the open project) and
 * the editor's main process (a path the window asks for must stay inside a folder the person chose). Both used to be a plain
 * "is it under the folder" test, which a symbolic link, a Windows device name or an alternate data stream gets round; this
 * file keeps every such trick out, in one place, with a test for each (`sandbox.test.ts`).
 *
 * Pure: the file system is passed in (only `realpathSync` is needed), and the path flavour can be chosen, so the Windows rules
 * are tested on any computer.
 */

export { PathProblem, cleanRelative, secretReason };

export type PathLib = typeof nodePath.posix | typeof nodePath.win32;

export interface RealFs {
  /** The real place a path is (links followed). Throws when the path does not exist. */
  realpathSync(p: string): string;
}

const sameCase = (lib: PathLib): ((s: string) => string) => (lib === nodePath.win32 ? (s) => s.toLowerCase() : (s) => s);

/** Is `target` the folder `root` or below it? Compared by name only (no file system). */
export function isInside(root: string, target: string, lib: PathLib = nodePath): boolean {
  const fold = sameCase(lib);
  const rel = lib.relative(fold(lib.resolve(root)), fold(lib.resolve(target)));
  return rel === '' || (!rel.startsWith('..') && !lib.isAbsolute(rel));
}

/**
 * The path a name inside the project stands for, as an absolute path, or a PathProblem. `rel` is checked by `cleanRelative`;
 * the result is confirmed to be below `root` by name, and (when `fs` is given) by where it really is: a link inside the
 * project that leads outside is refused, whether the link is the file itself or a folder on the way to it.
 */
export function resolveInsideProject(root: string, rel: string, opts: { lib?: PathLib; fs?: RealFs; /** More patterns to keep from the assistant (the built-in list of secret files always applies). Leave out to skip the secret-file check. */ deny?: readonly string[] } = {}): string {
  const lib = opts.lib ?? nodePath;
  const clean = cleanRelative(rel);
  if (opts.deny) {
    const reason = secretReason(clean, opts.deny);
    if (reason) throw new PathProblem(reason);
  }
  const full = lib.resolve(root, ...clean.split('/'));
  if (!isInside(root, full, lib)) throw new PathProblem('That path leads outside the project folder.');
  if (opts.fs) checkReal(root, full, opts.fs, lib);
  return full;
}

/**
 * A path the window asked the main process for (absolute): it must be in one of the folders the person chose. Same checks for
 * links as above. Returns the path as given (resolved), not the real one, so callers keep using the names they know.
 */
export function resolveInsideAny(roots: Iterable<string>, file: string, opts: { lib?: PathLib; fs?: RealFs } = {}): string {
  const lib = opts.lib ?? nodePath;
  if (typeof file !== 'string' || file.length === 0 || file.includes('\u0000')) throw new PathProblem('That is not a file path.');
  const resolved = lib.resolve(file);
  for (const root of roots) {
    if (!isInside(root, resolved, lib)) continue;
    // a drive-relative or stream path ("C:foo", "file.txt:stream") resolves to somewhere else than it reads as
    const rest = lib.relative(lib.resolve(root), resolved);
    if (rest.split(/[\\/]/).some((p) => p.includes(':'))) continue;
    if (opts.fs) checkReal(root, resolved, opts.fs, lib);
    return resolved;
  }
  throw new PathProblem(`Tilewright can only use files inside a project folder you chose. "${file}" is outside.`);
}

/** The real place of a folder that may not exist yet (a library that is made on first use): the nearest part that does, with the rest put back on. */
function realOrNearest(folder: string, fs: RealFs, lib: PathLib): string {
  const rest: string[] = [];
  let probe = lib.resolve(folder);
  for (;;) {
    try {
      return lib.join(fs.realpathSync(probe), ...rest);
    } catch {
      const up = lib.dirname(probe);
      if (up === probe) return lib.resolve(folder);
      rest.unshift(lib.basename(probe));
      probe = up;
    }
  }
}

/** Follow links: the nearest part of the path that exists must really be inside the real folder. */
function checkReal(root: string, full: string, fs: RealFs, lib: PathLib): void {
  const realRoot = realOrNearest(root, fs, lib);
  let probe = full;
  for (;;) {
    try {
      const real = fs.realpathSync(probe);
      // nothing of the path inside the folder exists yet (it is new): the nearest part that does is the folder itself or above it
      if (!isInside(root, probe, lib)) return;
      if (!isInside(realRoot, real, lib)) throw new PathProblem('That path goes through a link that leads outside the project folder.');
      return;
    } catch (e) {
      if (e instanceof PathProblem) throw e;
      const up = lib.dirname(probe);
      if (up === probe) return; // nothing on the way exists (a new file in a new folder): the name check already passed
      probe = up;
    }
  }
}
