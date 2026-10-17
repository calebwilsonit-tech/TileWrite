import { AUDIO_EXTENSIONS, CURRENT_SCHEMA_VERSION, MixerSchema, newMixer, type AudioEngine, type MixerData } from '@tilewright/runtime';
import { joinPath } from '../project/api';
import { UserError } from '../project/io';
import type { AssetFs } from './assets';

/** Sound and music files live here, and a file's name (without the ending) is the name events and regions use. */
export const AUDIO_DIR = 'assets/audio';
/** Biggest sound file Tilewright will take (music can be long, but a game should not ship hundreds of megabytes). */
export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const extOf = (file: string): string => file.split('.').pop()?.toLowerCase() ?? '';
const baseOf = (file: string): string => file.replace(/\.[^.]+$/, '');

export interface SoundFile {
  /** The name used in events (the file name without its ending). */
  name: string;
  /** The file name, with its ending. */
  file: string;
}

export function soundNameProblem(name: string, existing: readonly string[] = []): string | null {
  const n = name.trim();
  if (n.length === 0) return 'Give the sound a name.';
  if (n.length > 40) return 'Sound names can be at most 40 characters.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]*$/.test(n)) return 'Use letters, numbers, spaces, - and _ in a sound name, starting with a letter or number.';
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return `A sound called "${n}" already exists.`;
  return null;
}

export async function listSounds(fs: AssetFs, dir: string): Promise<SoundFile[]> {
  try {
    const entries = await fs.list(joinPath(dir, AUDIO_DIR));
    return entries
      .filter((e) => !e.dir && AUDIO_EXTENSIONS.includes(extOf(e.name)))
      .map((e) => ({ name: baseOf(e.name), file: e.name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // no audio folder yet
  }
}

/** Read every sound file into the engine. Problems (a file that will not play) come back as plain sentences. */
export async function loadSounds(fs: AssetFs, dir: string, engine: AudioEngine): Promise<string[]> {
  const problems: string[] = [];
  for (const s of await listSounds(fs, dir)) {
    try {
      await engine.load(s.name, await fs.readBinary(joinPath(dir, AUDIO_DIR, s.file)));
    } catch (e) {
      problems.push(`The sound "${s.name}" could not be read: ${(e as Error).message}`);
    }
  }
  return [...problems, ...engine.problems.splice(0)];
}

export const MIXER_FILE = `${AUDIO_DIR}/mixer.json`;

/** The project's mix (levels, ducking, per-sound settings, loop points); the defaults when the project has none. */
export async function loadMixer(fs: AssetFs, dir: string): Promise<{ mixer: MixerData; problems: string[] }> {
  const file = joinPath(dir, MIXER_FILE);
  try {
    if (!(await fs.exists(file))) return { mixer: newMixer(), problems: [] };
    const r = MixerSchema.safeParse(JSON.parse(await fs.read(file)));
    if (!r.success) return { mixer: newMixer(), problems: [`The mixer file is not valid, so the default mix is used: ${r.error.issues[0]?.message ?? 'unknown problem'}.`] };
    return { mixer: r.data, problems: [] };
  } catch (e) {
    return { mixer: newMixer(), problems: [`The mixer file could not be read, so the default mix is used (${(e as Error).message}).`] };
  }
}

export async function saveMixer(fs: AssetFs, dir: string, mixer: MixerData): Promise<void> {
  await fs.write(joinPath(dir, MIXER_FILE), JSON.stringify({ ...mixer, schemaVersion: CURRENT_SCHEMA_VERSION }, null, 2) + '\n');
}

/** Add a sound file to the project. */
export async function importSound(fs: AssetFs, dir: string, file: { name: string; bytes: Uint8Array }): Promise<SoundFile> {
  const ext = extOf(file.name);
  if (!AUDIO_EXTENSIONS.includes(ext)) throw new UserError(`Tilewright can use ${AUDIO_EXTENSIONS.map((x) => x.toUpperCase()).join(', ')} sound files, not ".${ext}" files.`);
  if (file.bytes.length === 0) throw new UserError('That sound file is empty.');
  if (file.bytes.length > MAX_AUDIO_BYTES) throw new UserError(`That sound file is ${(file.bytes.length / 1048576).toFixed(1)} MB; the most Tilewright takes is ${MAX_AUDIO_BYTES / 1048576} MB. A shorter or more compressed (OGG) file will do.`);
  const name = baseOf(file.name).replace(/[^A-Za-z0-9 _-]/g, '').trim().slice(0, 40) || 'sound';
  const existing = await listSounds(fs, dir);
  const problem = soundNameProblem(name, existing.map((s) => s.name));
  if (problem) throw new UserError(problem);
  const stored = `${name}.${ext}`;
  await fs.writeBinary(joinPath(dir, AUDIO_DIR, stored), file.bytes);
  return { name, file: stored };
}

export async function deleteSound(fs: AssetFs, dir: string, file: string): Promise<void> {
  await fs.remove(joinPath(dir, AUDIO_DIR, file));
}
