import { z } from 'zod';
import type { ExportSettings, Platform } from './settings';

/** Folders (relative to the project) that are never part of a game: saves, recordings, tooling. */
const EXCLUDED_TOP = new Set(['saves', 'node_modules', 'playthroughs', 'exports', 'release']);
const EXCLUDED_FILES = new Set(['export-settings.json', 'project-notes.md']);

/** Whether a project file ships with the game. `rel` uses forward slashes. Script sources are replaced by compiled ones. */
export function shouldInclude(rel: string): boolean {
  const parts = rel.split('/').filter(Boolean);
  if (parts.length === 0) return false;
  if (parts.some((p) => p.startsWith('.'))) return false; // .tilewright (autosaves), .git, editor temp files
  if (EXCLUDED_TOP.has(parts[0]!)) return false;
  if (parts.length === 1 && EXCLUDED_FILES.has(parts[0]!)) return false;
  if (rel.startsWith('assets/scripts/')) return false;
  if (/\.(bak|tmp)$/i.test(rel)) return false;
  return true;
}

export interface ListFs {
  list(dir: string): Promise<{ name: string; dir: boolean }[]>;
}

/** Every project file that ships with the game, as paths relative to the project folder. */
export async function listGameFiles(fs: ListFs, root: string, join: (...parts: string[]) => string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (rel: string): Promise<void> => {
    const entries = await fs.list(rel === '' ? root : join(root, ...rel.split('/')));
    for (const e of [...entries].sort((a, b) => a.name.localeCompare(b.name))) {
      const child = rel === '' ? e.name : `${rel}/${e.name}`;
      if (e.dir) {
        if (shouldInclude(`${child}/x`)) await walk(child);
      } else if (shouldInclude(child)) out.push(child);
    }
  };
  await walk('');
  return out;
}

/** The compiled scripts, shipped as one file so the game does not need the TypeScript compiler. */
export const ScriptsBundleSchema = z.object({
  format: z.literal(1),
  scripts: z.record(z.string(), z.object({ js: z.string(), map: z.string().optional() })),
});
export type ScriptsBundle = z.infer<typeof ScriptsBundleSchema>;

/** `game.json`: how the game starts. */
export const GameManifestSchema = z.object({
  format: z.literal(1),
  name: z.string(),
  version: z.string(),
  window: z.object({ width: z.number(), height: z.number(), fullscreen: z.boolean() }),
  splashText: z.string(),
  /** Path of the icon inside the game's data folder, or ''. */
  icon: z.string(),
  startScene: z.string(),
  scripts: z.array(z.string()),
  builtWith: z.string(),
});
export type GameManifest = z.infer<typeof GameManifestSchema>;

export function buildManifest(s: ExportSettings, startScene: string, scripts: string[], engineVersion: string): GameManifest {
  return {
    format: 1,
    name: s.gameName,
    version: s.version,
    window: { width: s.windowWidth, height: s.windowHeight, fullscreen: s.fullscreen },
    splashText: s.splashText,
    icon: s.icon,
    startScene,
    scripts,
    builtWith: `Tilewright ${engineVersion}`,
  };
}

/** What "Run in a window" is told to do: the game's files and generated data, the way an export would copy them, but into a throw-away folder. */
export interface PreviewJob {
  projectDir: string;
  files: string[];
  generated: { path: string; text: string }[];
  gameName: string;
  version: string;
  width: number;
  height: number;
}

/** What the export step is told to do, as plain data (the main process carries it out). */
export interface ExportJob {
  projectDir: string;
  outRoot: string;
  platform: Platform;
  folderName: string;
  exeName: string;
  /** Project files to copy into the game's data folder (relative paths). */
  files: string[];
  /** Files made at export time (`game.json`, `scripts.json`), as text. */
  generated: { path: string; text: string }[];
  /** Icon file (relative to the project) to copy, or ''. */
  icon: string;
  gameName: string;
  version: string;
  /** Text of a CREDITS.txt to put beside the game (art and parts by other people), or empty. */
  credits?: string;
}

export interface ExportResult {
  folder: string;
  exe: string;
  zip: string | null;
  zipProblem?: string;
  files: number;
}
