import type { AssetFs } from '../studio/assets';
import { StructureSchema, structureNameProblem, type Structure } from '../structures/structure';
import { joinPath } from './api';
import { UserError } from './io';

export const STRUCTURE_DIR = 'assets/structures';
const EXT = '.structure.json';
const file = (dir: string, name: string): string => joinPath(dir, STRUCTURE_DIR, `${name}${EXT}`);

export async function loadStructures(fs: AssetFs, dir: string): Promise<{ structures: Structure[]; problems: string[] }> {
  const out: Structure[] = [];
  const problems: string[] = [];
  let names: string[];
  try {
    names = (await fs.list(joinPath(dir, STRUCTURE_DIR))).filter((e) => !e.dir && e.name.endsWith(EXT)).map((e) => e.name.slice(0, -EXT.length)).sort((a, b) => a.localeCompare(b));
  } catch {
    return { structures: [], problems: [] };
  }
  for (const n of names) {
    try {
      const r = StructureSchema.safeParse(JSON.parse(await fs.read(file(dir, n))));
      if (r.success) out.push(r.data);
      else problems.push(`The structure "${n}" is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`);
    } catch (e) {
      problems.push(`The structure "${n}" could not be read (${(e as Error).message}).`);
    }
  }
  return { structures: out, problems };
}

export async function saveStructure(fs: AssetFs, dir: string, s: Structure, existing: readonly string[] = []): Promise<void> {
  const problem = structureNameProblem(s.name, existing);
  if (problem) throw new UserError(problem);
  await fs.write(file(dir, s.name), JSON.stringify(s, null, 2) + '\n');
}

export async function deleteStructure(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(file(dir, name));
}
