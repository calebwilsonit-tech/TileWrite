import {
  currentFlags,
  migrateProject,
  migrateScene,
  parseProject,
  parseScene,
  stringifyScene,
  type ProjectData,
  type SceneData,
} from '@tilewright/runtime';
import { joinPath } from './api';
import { MAIN_SCENE_PATH, templateById } from './templates';

/** The few file operations project IO needs; the real one goes through Electron, tests use memory. */
export interface ProjectFs {
  read(file: string): Promise<string>;
  write(file: string, text: string): Promise<void>;
  exists(file: string): Promise<boolean>;
  remove(file: string): Promise<void>;
}

/** An error whose message is safe to show to a designer as-is. */
export class UserError extends Error {}

export interface OpenProject {
  dir: string;
  project: ProjectData;
  /** The format the file on disk was in, when it was older than this Tilewright's (it was upgraded in memory; the file is not changed until the first save). */
  migratedFrom?: number;
}

export const PROJECT_FILE = 'project.json';

export function safeFolderName(name: string): string {
  const printable = [...name].filter((ch) => ch.charCodeAt(0) >= 32).join('');
  const cleaned = printable.trim().replace(/[<>:"/\\|?*]/g, '').replace(/\s+/g, ' ').replace(/[. ]+$/, '');
  return cleaned.length > 0 ? cleaned : 'My Game';
}

export function projectText(p: ProjectData): string {
  return JSON.stringify(p, null, 2) + '\n';
}

/** Create `<parentDir>/<name>/` with a project file and a first scene from a template. */
export async function createProject(fs: ProjectFs, parentDir: string, name: string, templateId: string): Promise<OpenProject> {
  const folder = safeFolderName(name);
  const dir = joinPath(parentDir, folder);
  if (await fs.exists(joinPath(dir, PROJECT_FILE))) {
    throw new UserError(`There is already a Tilewright project in "${folder}". Pick a different name or open that project instead.`);
  }
  const made = templateById(templateId).build(name.trim() || folder);
  // a new project plays with every behaviour that changed after older ones were made (see compat.ts); older projects keep theirs
  const project = { ...made.project, compat: currentFlags() };
  const { scene, files } = made;
  await fs.write(joinPath(dir, MAIN_SCENE_PATH), stringifyScene(scene));
  for (const [rel, text] of Object.entries(files ?? {})) await fs.write(joinPath(dir, ...rel.split('/')), text);
  await fs.write(joinPath(dir, PROJECT_FILE), projectText(project));
  await fs.write(joinPath(dir, '.gitignore'), '.tilewright/\n');
  return { dir, project };
}

async function readJson(fs: ProjectFs, file: string, what: string): Promise<unknown> {
  let text: string;
  try {
    text = await fs.read(file);
  } catch {
    throw new UserError(`Tilewright could not read ${what} (${file}). Is the file missing or in use by another program?`);
  }
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new UserError(`${what} (${file}) is damaged: it is not valid JSON (${(e as Error).message}). If you use version control, restore the last good copy.`);
  }
}

export async function openProject(fs: ProjectFs, dir: string): Promise<OpenProject> {
  const raw = await readJson(fs, joinPath(dir, PROJECT_FILE), 'the project file');
  const migrated = migrateProject(raw);
  if (!migrated.ok) throw new UserError(migrated.error);
  const parsed = parseProject(migrated.value);
  if (!parsed.ok) throw new UserError(parsed.error);
  return { dir, project: parsed.value, ...(migrated.from < parsed.value.schemaVersion ? { migratedFrom: migrated.from } : {}) };
}

/**
 * Save the project file. The first time a project that was made in an older format is saved, the file as it was is copied to
 * `.tilewright/backup-format-<n>/project.json` (older versions of Tilewright refuse a newer format, so without the copy a project
 * upgraded by accident could not go back). Returns where the copy went, when one was made now.
 */
export async function saveProject(fs: ProjectFs, dir: string, project: ProjectData): Promise<{ backedUp?: string }> {
  const file = joinPath(dir, PROJECT_FILE);
  let backedUp: string | undefined;
  try {
    if (await fs.exists(file)) {
      const old = await fs.read(file);
      const version = (JSON.parse(old) as { schemaVersion?: unknown }).schemaVersion;
      if (typeof version === 'number' && version < project.schemaVersion) {
        const copy = joinPath(dir, '.tilewright', `backup-format-${version}`, PROJECT_FILE);
        if (!(await fs.exists(copy))) {
          await fs.write(copy, old);
          backedUp = copy;
        }
      }
    }
  } catch (e) {
    // a copy that cannot be made must not be silently skipped: the person is told, and the save does not go ahead over the only old file
    throw new UserError(`Tilewright could not keep a copy of the project file as it was before upgrading it, so it did not save: ${e instanceof Error ? e.message : String(e)}`);
  }
  await fs.write(file, projectText(project));
  return backedUp ? { backedUp } : {};
}

export async function loadScene(fs: ProjectFs, dir: string, scenePath: string): Promise<SceneData> {
  const raw = await readJson(fs, joinPath(dir, scenePath), `the scene "${scenePath}"`);
  const migrated = migrateScene(raw);
  if (!migrated.ok) throw new UserError(migrated.error);
  const parsed = parseScene(migrated.value);
  if (!parsed.ok) throw new UserError(`${parsed.error} (file: ${scenePath})`);
  return parsed.value;
}

export async function saveScene(fs: ProjectFs, dir: string, scenePath: string, scene: SceneData): Promise<void> {
  await fs.write(joinPath(dir, scenePath), stringifyScene(scene));
  await clearAutosave(fs, dir, scenePath);
}

const autosavePath = (dir: string, scenePath: string): string =>
  joinPath(dir, '.tilewright', 'autosave', scenePath.replace(/[\\/]/g, '__') + '.autosave.json');

/** Write unsaved work to a side file (never over the real scene) so a crash loses almost nothing. */
export async function autosaveScene(fs: ProjectFs, dir: string, scenePath: string, scene: SceneData): Promise<void> {
  await fs.write(autosavePath(dir, scenePath), stringifyScene(scene));
}

export async function clearAutosave(fs: ProjectFs, dir: string, scenePath: string): Promise<void> {
  await fs.remove(autosavePath(dir, scenePath));
}

/** Unsaved work left behind by a crash or a forced close, if any and if it is readable. */
export async function readAutosave(fs: ProjectFs, dir: string, scenePath: string): Promise<SceneData | null> {
  const file = autosavePath(dir, scenePath);
  if (!(await fs.exists(file))) return null;
  try {
    const raw = JSON.parse(await fs.read(file));
    const migrated = migrateScene(raw);
    if (!migrated.ok) return null;
    const parsed = parseScene(migrated.value);
    return parsed.ok ? parsed.value : null;
  } catch {
    return null; // a damaged autosave is simply ignored
  }
}

/** A scene file path for a new scene name, e.g. "Cave Level" -> "scenes/cave-level.scene.json". */
export function scenePathFor(name: string, existing: string[]): string {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'scene';
  let candidate = `scenes/${slug}.scene.json`;
  for (let i = 2; existing.includes(candidate); i++) candidate = `scenes/${slug}-${i}.scene.json`;
  return candidate;
}
