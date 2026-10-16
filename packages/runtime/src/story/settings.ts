import { z } from 'zod';
import '../project/schema'; // sets up Zod before the schemas below are built
import { DEFAULT_INPUT_MAP } from '../input/keyboard';
import type { InputMapDef } from '../input/input';

/** What a player can change about how the game feels and plays; saved on their machine, not in the project. */
export const SettingsSchema = z.object({
  master: z.number().min(0).max(1).default(0.8),
  music: z.number().min(0).max(1).default(0.7),
  sfx: z.number().min(0).max(1).default(0.9),
  difficulty: z.enum(['easy', 'normal', 'hard']).default('normal'),
  /** Screen shake on hits and in cutscenes. */
  screenShake: z.boolean().default(true),
  /** Replaces the default input bindings, per action. */
  bindings: z.record(z.string(), z.array(z.string())).default({}),
});
export type GameSettings = z.infer<typeof SettingsSchema>;

export const defaultSettings = (): GameSettings => SettingsSchema.parse({});

/** The bindings in force: the defaults with the player's changes on top. */
export function effectiveBindings(s: GameSettings, defaults: InputMapDef = DEFAULT_INPUT_MAP): InputMapDef {
  return { ...defaults, ...s.bindings };
}

const kindOf = (id: string): string => id.split(':')[0] ?? '';

/**
 * Give an action a new key or button. The new binding replaces the old ones of the same kind (keyboard and mouse
 * together, gamepad on its own) and the other kind is kept, so rebinding a key never loses the gamepad button.
 * If another action already used that binding it loses it (so one button never does two things).
 */
export function rebind(bindings: InputMapDef, action: string, id: string): InputMapDef {
  const device = (b: string): string => (kindOf(b) === 'pad' ? 'pad' : 'kb');
  const next: InputMapDef = {};
  for (const [a, list] of Object.entries(bindings)) next[a] = a === action ? list.filter((b) => device(b) !== device(id)) : list.filter((b) => b !== id);
  next[action] = [id, ...(next[action] ?? [])];
  return next;
}

/** Only the actions that differ from the defaults (what gets saved). */
export function bindingChanges(bindings: InputMapDef, defaults: InputMapDef = DEFAULT_INPUT_MAP): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const [a, list] of Object.entries(bindings)) {
    const d = defaults[a as keyof typeof defaults] as string[] | undefined;
    if (!d || d.length !== list.length || d.some((b, i) => b !== list[i])) out[a] = list;
  }
  return out;
}

/** Actions with no way to trigger them: the controls screen warns about these. */
export function unboundActions(bindings: InputMapDef, required: readonly string[]): string[] {
  return required.filter((a) => (bindings[a] ?? []).length === 0);
}

export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = 'tilewright.settings';

/** Read the player's settings, falling back to the defaults if there are none or they are damaged. */
export function loadSettings(storage: KeyValueStorage | undefined, key = KEY): GameSettings {
  try {
    const raw = storage?.getItem(key);
    if (!raw) return defaultSettings();
    const parsed = SettingsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : defaultSettings();
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(storage: KeyValueStorage | undefined, s: GameSettings, key = KEY): void {
  try {
    storage?.setItem(key, JSON.stringify(s));
  } catch {
    /* storage can be blocked or full; settings just will not be remembered */
  }
}
