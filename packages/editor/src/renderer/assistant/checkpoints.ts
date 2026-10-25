/**
 * Checkpoints inside a run: the project as it was at the start of each step of an approved plan, so it can be put back to there
 * (and not only to before the whole run). A checkpoint keeps only the files that differ from the copy taken at the start of the run,
 * so many steps cost little more than the files that changed. Pure (maps of file bytes in, maps out).
 */

export interface Checkpoint {
  id: string;
  takenAt: number;
  /** The files that differ from the copy at the start of the run: their bytes then, or null for a file that did not exist then. */
  changed: Map<string, Uint8Array | null>;
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** What differs between the copy at the start of the run and the files now. */
export function deltaFrom(base: ReadonlyMap<string, Uint8Array>, current: ReadonlyMap<string, Uint8Array>): Map<string, Uint8Array | null> {
  const out = new Map<string, Uint8Array | null>();
  for (const [path, bytes] of current) {
    const before = base.get(path);
    if (!before || !same(before, bytes)) out.set(path, bytes);
  }
  for (const path of base.keys()) if (!current.has(path)) out.set(path, null);
  return out;
}

/** The project's files as they were at a checkpoint: the first copy with what had changed by then put over it. */
export function filesAt(base: ReadonlyMap<string, Uint8Array>, cp: Checkpoint): Map<string, Uint8Array> {
  const files = new Map(base);
  for (const [path, bytes] of cp.changed) {
    if (bytes === null) files.delete(path);
    else files.set(path, bytes);
  }
  return files;
}
