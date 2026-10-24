import { api, joinPath } from '../project/api';
import { store } from '../app/store';
import { studio } from '../studio/store';
import { listProjectFiles } from './file-tools';

/**
 * A copy of every file of the project, taken before Claude changes things without asking about each one (the "Plan first" and
 * "Do it, I can undo" levels), so the whole run can be taken back in one step. Kept in memory for the length of the session; the
 * project is saved first so the copy is what is on disk. Saves, exports and tool folders are not part of it.
 */

export interface Snapshot {
  id: string;
  dir: string;
  takenAt: number;
  files: Map<string, Uint8Array>;
  bytes: number;
}

/** The most a project may weigh for a run to be rolled back (beyond this Claude has to ask about each change). */
export const MAX_SNAPSHOT_BYTES = 120 * 1024 * 1024;

export type SnapshotResult = { ok: true; snapshot: Snapshot } | { ok: false; reason: string };

let counter = 0;

export async function takeSnapshot(): Promise<SnapshotResult> {
  const p = store.state.project;
  if (!p) return { ok: false, reason: 'No project is open.' };
  // what is on screen but not yet on disk goes to disk first
  await store.autosaveNow();
  await store.flushStory();
  if (studio.isDirty()) await studio.save();
  const list = await listProjectFiles();
  const total = list.reduce((n, f) => n + (f.size ?? 0), 0);
  if (total > MAX_SNAPSHOT_BYTES) return { ok: false, reason: `The project is ${(total / 1024 / 1024).toFixed(0)} MB, which is too much to keep a copy of, so changes cannot be rolled back.` };
  const files = new Map<string, Uint8Array>();
  for (const f of list) files.set(f.path, await api().fs.readBinary(joinPath(p.dir, ...f.path.split('/'))));
  return { ok: true, snapshot: { id: `s${++counter}`, dir: p.dir, takenAt: Date.now(), files, bytes: total } };
}

const same = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((v, i) => v === b[i]);

/** Put the project back as it was when the copy was taken: files changed are restored, files made since are removed, then the project is opened again. */
export async function rollBack(snapshot: Snapshot): Promise<{ restored: number; removed: number }> {
  const p = store.state.project;
  if (!p || p.dir !== snapshot.dir) throw new Error('That copy belongs to a different project.');
  // leaving the project stops the autosave, so nothing in memory writes over what is put back
  await store.closeProject();
  let restored = 0;
  let removed = 0;
  const now = await listProjectFiles(snapshot.dir);
  for (const f of now) {
    if (snapshot.files.has(f.path)) continue;
    await api().fs.remove(joinPath(snapshot.dir, ...f.path.split('/')));
    removed++;
  }
  for (const [path, bytes] of snapshot.files) {
    const file = joinPath(snapshot.dir, ...path.split('/'));
    const current = now.some((f) => f.path === path) ? await api().fs.readBinary(file).catch(() => null) : null;
    if (current && same(current, bytes)) continue;
    await api().fs.writeBinary(file, bytes);
    restored++;
  }
  await store.openRecent(snapshot.dir);
  return { restored, removed };
}
