import {
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
  const { project, scene } = templateById(templateId).build(name.trim() || folder);
  await fs.write(joinPath(dir, MAIN_SCENE_PATH), stringifyScene(scene));
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
  return { dir, project: parsed.value };
}

export async function saveProject(fs: ProjectFs, dir: string, project: ProjectData): Promise<void> {
  await fs.write(joinPath(dir, PROJECT_FILE), projectText(project));
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
