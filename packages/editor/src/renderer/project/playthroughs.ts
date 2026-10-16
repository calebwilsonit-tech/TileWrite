import { PlaythroughSchema, type Playthrough } from '@tilewright/playbot';
import type { AssetFs } from '../studio/assets';
import { joinPath } from './api';
import { storyNameProblem } from './story';

export const PLAYTHROUGH_DIR = 'playthroughs';
const EXT = '.playthrough.json';

export async function listPlaythroughs(fs: AssetFs, dir: string): Promise<string[]> {
  try {
    return (await fs.list(joinPath(dir, PLAYTHROUGH_DIR))).filter((e) => !e.dir && e.name.endsWith(EXT)).map((e) => e.name.slice(0, -EXT.length)).sort((a, b) => a.localeCompare(b));
  } catch {
    return [];
  }
}

export async function loadPlaythrough(fs: AssetFs, dir: string, name: string): Promise<Playthrough> {
  let raw: unknown;
  try {
    raw = JSON.parse(await fs.read(joinPath(dir, PLAYTHROUGH_DIR, `${name}${EXT}`)));
  } catch (e) {
    throw new Error(`The playthrough "${name}" could not be read (${(e as Error).message}).`, { cause: e });
  }
  const r = PlaythroughSchema.safeParse(raw);
  if (!r.success) throw new Error(`The playthrough "${name}" is not valid: ${r.error.issues[0]?.message ?? 'unknown problem'}.`);
  return r.data;
}

export async function savePlaythrough(fs: AssetFs, dir: string, p: Playthrough): Promise<void> {
  const problem = storyNameProblem(p.name, [], 'playthrough');
  if (problem) throw new Error(problem);
  await fs.write(joinPath(dir, PLAYTHROUGH_DIR, `${p.name}${EXT}`), JSON.stringify(p) + '\n');
}

export async function deletePlaythrough(fs: AssetFs, dir: string, name: string): Promise<void> {
  await fs.remove(joinPath(dir, PLAYTHROUGH_DIR, `${name}${EXT}`));
}

/** "Playthrough 1", "Playthrough 2"... the first name not already used. */
export function nextPlaythroughName(existing: readonly string[], base = 'Playthrough'): string {
  for (let i = 1; ; i++) if (!existing.includes(`${base} ${i}`)) return `${base} ${i}`;
}
