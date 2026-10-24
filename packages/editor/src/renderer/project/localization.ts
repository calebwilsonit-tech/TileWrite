import { LanguageSchema, defaultInstructions, newLanguage, type MinigameData, type CutsceneData, type DialogueData, type EventRow, type ItemData, type LanguageData, type SceneData, type UiLayout } from '@tilewright/runtime';
import { joinPath } from './api';
import { UserError } from './io';
import type { AssetFs } from '../studio/assets';
import { uiStrings } from '@tilewright/plugin-prebuilt-screens';

export const LOCALE_DIR = 'assets/localization';
const EXT = '.strings.json';

export interface SourceString {
  /** The text as written in the game: also the key of every translation. */
  text: string;
  /** Where it was first found, for the translator ("Dialogue Elder", "Item Bread", "Game menus"). */
  where: string;
}

function* eventRows(rows: readonly EventRow[]): Generator<EventRow> {
  for (const r of rows) {
    yield r;
    yield* eventRows(r.children);
  }
}

/**
 * Every piece of text in the project the player can read and a translation can replace: conversations, cutscene
 * lines, items, messages in event rows and pickups, and the game's own menus. Puzzle text (sentence stones and text
 * blocks) is left out on purpose, because changing it changes the puzzle.
 */
export function collectStrings(
  story: { items: readonly ItemData[]; dialogues: ReadonlyMap<string, DialogueData>; cutscenes: ReadonlyMap<string, CutsceneData> },
  scenes: readonly { path: string; scene: SceneData }[],
  menus: readonly string[] = uiStrings(),
  minigames: readonly MinigameData[] = [],
  interfaceStrings: readonly string[] = [],
): SourceString[] {
  const seen = new Map<string, string>();
  const add = (text: unknown, where: string): void => {
    if (typeof text !== 'string' || text.trim() === '' || seen.has(text)) return;
    seen.set(text, where);
  };
  for (const [name, d] of [...story.dialogues].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const n of d.nodes) {
      if (n.type === 'line') {
        add(n.speaker, `Dialogue ${name}`);
        add(n.text, `Dialogue ${name}`);
      } else if (n.type === 'choice') {
        add(n.speaker, `Dialogue ${name}`);
        add(n.prompt, `Dialogue ${name}`);
        for (const o of n.options) add(o.text, `Dialogue ${name}`);
      }
    }
  }
  for (const [name, c] of [...story.cutscenes].sort((a, b) => a[0].localeCompare(b[0]))) {
    for (const s of c.steps) {
      if (s.type === 'say') {
        add(s.speaker, `Cutscene ${name}`);
        add(s.text, `Cutscene ${name}`);
      } else if (s.type === 'message') add(s.text, `Cutscene ${name}`);
    }
  }
  for (const i of story.items) {
    add(i.name, `Item ${i.name}`);
    add(i.description, `Item ${i.name}`);
    add(i.use?.message, `Item ${i.name}`);
  }
  for (const m of minigames) {
    add(m.title || m.name, `Minigame ${m.name}`);
    add(m.instructions || defaultInstructions(m.kind), `Minigame ${m.name}`);
  }
  for (const { path, scene } of scenes) {
    const label = `Scene ${path.replace(/^.*\//, '').replace('.scene.json', '')}`;
    for (const row of eventRows(scene.events)) for (const a of row.actions) if (a.type === 'message') add(a.params.text, label);
    for (const e of scene.entities) add((e.components.pickup as { message?: string } | undefined)?.message, `${label}: ${e.name}`);
  }
  for (const s of menus) add(s, 'Game menus and messages');
  for (const s of interfaceStrings) add(s, 'Title screen and heads-up display');
  return [...seen].map(([text, where]) => ({ text, where }));
}

/** How much of the project a language covers. */
export function coverage(lang: Pick<LanguageData, 'strings'>, sources: readonly SourceString[]): { done: number; total: number; missing: SourceString[]; unused: string[] } {
  const known = new Set(sources.map((s) => s.text));
  const missing = sources.filter((s) => !(lang.strings[s.text] ?? '').trim());
  return { done: sources.length - missing.length, total: sources.length, missing, unused: Object.keys(lang.strings).filter((k) => !known.has(k) && (lang.strings[k] ?? '').trim() !== '') };
}

export const languageFile = (dir: string, code: string): string => joinPath(dir, LOCALE_DIR, `${code}${EXT}`);

export async function loadLanguages(fs: AssetFs, dir: string): Promise<{ languages: LanguageData[]; problems: string[] }> {
  const languages: LanguageData[] = [];
  const problems: string[] = [];
  const entries = await fs.list(joinPath(dir, LOCALE_DIR)).catch(() => null);
  if (!entries) return { languages, problems }; // no localization folder yet
  for (const e of entries.filter((x) => !x.dir && x.name.endsWith(EXT)).sort((a, b) => a.name.localeCompare(b.name))) {
    try {
      const parsed = LanguageSchema.safeParse(JSON.parse(await fs.read(joinPath(dir, LOCALE_DIR, e.name))));
      if (parsed.success) languages.push(parsed.data);
      else problems.push(`The language file "${e.name}" is not valid: ${parsed.error.issues[0]?.message ?? 'unknown problem'}.`);
    } catch (err) {
      problems.push(`The language file "${e.name}" could not be read: ${(err as Error).message}`);
    }
  }
  return { languages, problems };
}

export async function saveLanguage(fs: AssetFs, dir: string, lang: LanguageData): Promise<void> {
  const clean = { ...lang, strings: Object.fromEntries(Object.entries(lang.strings).filter(([, v]) => v.trim() !== '')) };
  await fs.write(languageFile(dir, lang.code), JSON.stringify(clean, null, 2) + '\n');
}

export async function deleteLanguage(fs: AssetFs, dir: string, code: string): Promise<void> {
  await fs.remove(languageFile(dir, code));
}

export function languageProblem(code: string, name: string, existing: readonly string[]): string | null {
  if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(code)) return 'Use a short lower-case language code such as fr, de or pt-br.';
  if (existing.includes(code)) return `A language with the code "${code}" already exists.`;
  if (name.trim() === '') return 'Write the language\'s name as its speakers write it (for example Français).';
  return null;
}

export function makeLanguage(code: string, name: string): LanguageData {
  const problem = languageProblem(code, name, []);
  if (problem) throw new UserError(problem);
  return newLanguage(code, name.trim());
}

/** The words the title screen and the game's own counters, bars and texts show (they can be translated too). */
export function interfaceTexts(layout: UiLayout | undefined, project: { name: string; title?: { enabled: boolean; subtitle: string } | undefined } | undefined): string[] {
  const out: string[] = [];
  if (project?.title?.enabled) out.push(project.name, project.title.subtitle);
  for (const w of layout?.widgets ?? []) {
    if (w.kind === 'counter' || w.kind === 'bar') out.push(w.label);
    else if (w.kind === 'text') out.push(w.text);
  }
  return out.filter((t) => t.trim() !== '');
}
