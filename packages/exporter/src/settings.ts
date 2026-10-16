import { z } from 'zod';

z.config({ jitless: true }); // same reason as in the runtime: the editor's Content-Security-Policy forbids `new Function`

/** What the designer chooses for an exported game (saved as `export-settings.json` in the project, never exported). */
export const ExportSettingsSchema = z.object({
  gameName: z.string().trim().min(1, 'Give the game a name.').max(60, 'The name is too long (60 letters at most).'),
  version: z
    .string()
    .trim()
    .regex(/^\d+(\.\d+){0,2}$/, 'The version should look like 1.0 or 1.2.3.')
    .default('1.0.0'),
  windowWidth: z.number().int().min(480, 'The window must be at least 480 wide.').max(7680).default(1280),
  windowHeight: z.number().int().min(270, 'The window must be at least 270 high.').max(4320).default(720),
  fullscreen: z.boolean().default(false),
  /** A line of text shown on a splash screen before the game starts. Empty means no splash screen. */
  splashText: z.string().max(120).default(''),
  /** A PNG in the project (for example `assets/icon.png`) used as the window and taskbar icon. Empty means the default. */
  icon: z.string().default(''),
});
export type ExportSettings = z.infer<typeof ExportSettingsSchema>;

export const SETTINGS_FILE = 'export-settings.json';

export function defaultSettings(projectName: string): ExportSettings {
  return { gameName: projectName.trim() || 'My Game', version: '1.0.0', windowWidth: 1280, windowHeight: 720, fullscreen: false, splashText: '', icon: '' };
}

/** Read saved settings; anything missing or damaged falls back to the defaults, so a bad file never blocks exporting. */
export function parseSettings(text: string | null, projectName: string): { settings: ExportSettings; problem?: string } {
  const fallback = defaultSettings(projectName);
  if (text === null || text.trim() === '') return { settings: fallback };
  try {
    const r = ExportSettingsSchema.safeParse({ ...fallback, ...(JSON.parse(text) as object) });
    return r.success ? { settings: r.data } : { settings: fallback, problem: 'The saved export settings could not be read, so the defaults are shown.' };
  } catch {
    return { settings: fallback, problem: 'The saved export settings file is damaged, so the defaults are shown.' };
  }
}

/** Every problem with the settings, in plain English (empty if they are fine). */
export function settingsProblems(s: unknown): string[] {
  const r = ExportSettingsSchema.safeParse(s);
  return r.success ? [] : r.error.issues.map((i) => i.message);
}

const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** A name that is safe as a file or folder name on Windows, macOS and Linux. */
export function fileSafeName(name: string): string {
  let n = name
    .normalize('NFC')
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/\s+/g, ' ')
    .replace(/^[ .]+|[ .]+$/g, '')
    .slice(0, 50)
    .trim();
  if (RESERVED.test(n)) n += '_';
  return n || 'Game';
}

export type Platform = 'win32' | 'linux' | 'darwin';

export const PLATFORM_LABEL: Record<Platform, string> = { win32: 'Windows', linux: 'Linux', darwin: 'macOS' };

/** Name of the folder (and zip) an export produces. */
export function exportFolderName(s: ExportSettings, platform: Platform): string {
  const tag = platform === 'win32' ? 'windows' : platform === 'darwin' ? 'mac' : 'linux';
  return `${fileSafeName(s.gameName)}-${s.version}-${tag}`;
}

/** Name of the program file inside the export. */
export function exeFileName(s: ExportSettings, platform: Platform): string {
  const base = fileSafeName(s.gameName);
  return platform === 'win32' ? `${base}.exe` : base;
}
