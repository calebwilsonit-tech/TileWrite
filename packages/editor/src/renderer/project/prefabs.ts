import { PrefabSchema, type PrefabData } from '@tilewright/runtime';
import type { AssetFs } from '../studio/assets';
import { joinPath } from './api';
import { UserError } from './io';

export const PREFAB_DIR = 'assets/prefabs';
const EXT = '.prefab.json';

const file = (dir: string, name: string): string => joinPath(dir, PREFAB_DIR, `${name}${EXT}`);

export function prefabNameProblem(name: string, existing: readonly string[] = []): string | null {
  const n = name.trim();
  if (n.length === 0) return 'Give the prefab a name.';
  if (n.length > 40) return 'Prefab names can be at most 40 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(n)) return 'Use letters, numbers, spaces, - and _ in a prefab name, starting with a letter or number.';
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return `A prefab called "${n}" already exists.`;
  return null;
}

export async function listPrefabs(fs: AssetFs, dir: string): Promise<string[]> {
  try {
    return (await fs.list(joinPath(dir, PREFAB_DIR)))
      .filter((e) => !e.dir && e.name.endsWith(EXT))
      .map((e) => e.name.slice(0, -EXT.length))
      .sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function loadPrefab(fs: AssetFs, dir: string, name: string): Promise<PrefabData> {
  let json: unknown;
  try {
    json = JSON.parse(await fs.read(file(dir, name)));
  } catch (e) {
    throw new UserError(`The prefab "${name}" could not be read (${(e as Error).message}).`);
  }
  const r = PrefabSchema.safeParse(json);
  if (!r.success) throw new UserError(`The prefab "${name}" is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`);
  return r.data;
}

export async function loadAllPrefabs(fs: AssetFs, dir: string): Promise<{ prefabs: Map<string, PrefabData>; problems: string[] }> {
  const prefabs = new Map<string, PrefabData>();
  const problems: string[] = [];
  for (const name of await listPrefabs(fs, dir)) {
    try {
      prefabs.set(name, await loadPrefab(fs, dir, name));
    } catch (e) {
      problems.push((e as Error).message);
    }
  }
  return { prefabs, problems };
}

export async function savePrefab(fs: AssetFs, dir: string, prefab: PrefabData): Promise<void> {
  const problem = prefabNameProblem(prefab.name);
  if (problem) throw new UserError(problem);
  await fs.write(file(dir, prefab.name), JSON.stringify(prefab, null, 2) + '\n');
}

export async function deletePrefab(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(file(dir, name));
}
