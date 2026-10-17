import { CutsceneSchema, DialogueSchema, ItemSchema, LanguageSchema, checkCutscene, checkDialogue, newLanguage, type CutsceneData, type DialogueData, type ItemData, type RegionData } from '@tilewright/runtime';
import { lineDiff, type ToolOutput } from '@tilewright/assistant';
import { store } from '../app/store';
import { assetFs } from '../project/assetFs';
import { collectStrings, coverage, deleteLanguage, loadLanguages, saveLanguage } from '../project/localization';
import { studio } from '../studio/store';
import { ToolProblem, fail, json, requireEditing, undoTop, type Proposal } from './tool-core';

const text = (t: string): ToolOutput => ({ content: t });

/** Take back a story change Claude just made, if it is still the last thing done (it is one step of the history like any other). */
const undoStory = (label: string) => async (): Promise<boolean> => {
  const doc = store.doc;
  if (!doc || doc.history.undoLabel !== label) return false;
  doc.undo();
  await store.flushStory();
  return true;
};

const knownItems = (): Set<string> => new Set(store.story.items.map((i) => i.id));

function dialogueProblems(d: DialogueData): string[] {
  return checkDialogue(d, { items: knownItems(), variables: new Set<string>() }).map((p) => p.text);
}

function cutsceneProblems(c: CutsceneData): string[] {
  return checkCutscene(c, { dialogues: new Set(store.story.dialogues.keys()), items: knownItems(), sounds: new Set(studio.sounds.map((s) => s.name)) }).map((p) => p.text);
}

/** One line per step, for a reader (or a diff). */
function describeDialogue(d: DialogueData): string {
  return [`start: ${d.start}`, ...d.nodes.map((n) => `${n.id}: ${JSON.stringify(n)}`)].join('\n');
}

function describeCutscene(c: CutsceneData): string {
  return [`skippable: ${c.skippable}`, ...c.steps.map((s) => `${s.id}: ${JSON.stringify(s)}`)].join('\n');
}

async function allSources() {
  const scenes = await store.loadAllScenes();
  return collectStrings(store.story, [...scenes].map(([path, scene]) => ({ path, scene })), undefined, store.minigames);
}

/** Reading tools about the story data. Returns null when the name is not one of them. */
export async function runStoryRead(name: string, input: Record<string, unknown>): Promise<ToolOutput | null> {
  try {
    switch (name) {
      case 'story_overview': {
        const p = store.state.project;
        if (!p) return fail('No project is open.');
        const sources = await allSources();
        const { languages } = await loadLanguages(assetFs, p.dir);
        return text(
          json({
            items: store.story.items,
            dialogues: [...store.story.dialogues.values()].map((d) => ({ name: d.name, start: d.start, steps: d.nodes.length, problems: dialogueProblems(d) })),
            cutscenes: [...store.story.cutscenes.values()].map((c) => ({ name: c.name, steps: c.steps.length, problems: cutsceneProblems(c) })),
            languages: languages.map((l) => {
              const c = coverage(l, sources);
              return { code: l.code, name: l.name, translated: c.done, of: c.total };
            }),
          }),
        );
      }
      case 'get_dialogue': {
        const d = store.story.dialogues.get(String(input.name));
        if (!d) return fail(`There is no conversation called "${String(input.name)}". The conversations are: ${[...store.story.dialogues.keys()].join(', ') || '(none yet)'}.`);
        return text(json({ dialogue: d, problems: dialogueProblems(d) }));
      }
      case 'get_cutscene': {
        const c = store.story.cutscenes.get(String(input.name));
        if (!c) return fail(`There is no cutscene called "${String(input.name)}". The cutscenes are: ${[...store.story.cutscenes.keys()].join(', ') || '(none yet)'}.`);
        return text(json({ cutscene: c, problems: cutsceneProblems(c) }));
      }
      case 'get_translations': {
        const p = store.state.project;
        if (!p) return fail('No project is open.');
        const sources = await allSources();
        const code = input.language === undefined ? undefined : String(input.language);
        const lang = code ? (await loadLanguages(assetFs, p.dir)).languages.find((l) => l.code === code) : undefined;
        if (code && !lang) return text(json({ note: `There is no language "${code}" yet. write_translation with a name creates it.`, lines: sources }));
        return text(json({ lines: sources.map((s) => ({ text: s.text, where: s.where, ...(lang ? { translation: lang.strings[s.text] ?? '' } : {}) })), ...(lang ? { translated: coverage(lang, sources).done, of: sources.length } : {}) }, 0));
      }
      default:
        return null;
    }
  } catch (e) {
    if (e instanceof ToolProblem) return { isError: true, content: e.message };
    throw e;
  }
}

function writeDialogue(input: Record<string, unknown>): Proposal {
  const name = String(input.name).trim();
  const parsed = DialogueSchema.safeParse({ name, start: input.start, nodes: input.nodes });
  if (!parsed.success) return fail(`The conversation is not valid: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const d = parsed.data;
  const ids = d.nodes.map((n) => n.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) fail(`Two steps share the id "${dup}". Every step needs its own id.`);
  if (!ids.includes(d.start)) fail(`"start" is "${d.start}", which is not the id of any step.`);
  const previous = store.story.dialogues.get(name);
  const problems = dialogueProblems(d);
  return {
    tool: 'write_dialogue',
    title: previous ? `Change the conversation "${name}"` : `New conversation "${name}"`,
    lines: [`${previous ? 'Replace' : 'Create'} the conversation "${name}" (${d.nodes.length} steps).`, ...problems.map((p) => `Warning: ${p}`)],
    diff: { name: `${name}.dialogue.json`, lines: lineDiff(previous ? describeDialogue(previous) : '', describeDialogue(d)) },
    async apply() {
      store.asStoryStep('Claude: write a conversation', () => store.putDialogue(d));
      await store.flushStory();
      return `Saved the conversation "${name}".${problems.length ? ` The checker still reports: ${problems.join(' | ')}` : ' The checker found no problems.'}`;
    },
    undo: undoStory('Claude: write a conversation'),
  };
}

function writeCutscene(input: Record<string, unknown>): Proposal {
  const name = String(input.name).trim();
  const steps = (input.steps as Record<string, unknown>[]).map((s, i) => ({ ...s, id: typeof s.id === 'string' && s.id ? s.id : `s${i + 1}` }));
  const parsed = CutsceneSchema.safeParse({ name, skippable: input.skippable ?? true, steps });
  if (!parsed.success) return fail(`The cutscene is not valid: ${parsed.error.issues.slice(0, 4).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
  const c = parsed.data;
  const ids = c.steps.map((s) => s.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) fail(`Two steps share the id "${dup}".`);
  const previous = store.story.cutscenes.get(name);
  const problems = cutsceneProblems(c);
  return {
    tool: 'write_cutscene',
    title: previous ? `Change the cutscene "${name}"` : `New cutscene "${name}"`,
    lines: [`${previous ? 'Replace' : 'Create'} the cutscene "${name}" (${c.steps.length} steps).`, ...problems.map((p) => `Warning: ${p}`)],
    diff: { name: `${name}.cutscene.json`, lines: lineDiff(previous ? describeCutscene(previous) : '', describeCutscene(c)) },
    async apply() {
      store.asStoryStep('Claude: write a cutscene', () => store.putCutscene(c));
      await store.flushStory();
      return `Saved the cutscene "${name}".${problems.length ? ` The checker still reports: ${problems.join(' | ')}` : ' The checker found no problems.'}`;
    },
    undo: undoStory('Claude: write a cutscene'),
  };
}

function writeItems(input: Record<string, unknown>): Proposal {
  const raw = input.items as unknown[];
  const items: ItemData[] = [];
  for (const r of raw) {
    const p = ItemSchema.safeParse(r);
    if (!p.success) fail(`An item is not valid: ${p.error.issues.slice(0, 3).map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')}`);
    else items.push(p.data);
  }
  const ids = items.map((i) => i.id);
  const dup = ids.find((id, i) => ids.indexOf(id) !== i);
  if (dup) fail(`Two items share the id "${dup}".`);
  const previous = store.story.items;
  const used = new Set<string>();
  for (const d of store.story.dialogues.values()) for (const n of d.nodes) if (n.type === 'give') used.add(n.item);
  const orphaned = [...used].filter((id) => !ids.includes(id));
  const describe = (list: readonly ItemData[]): string => list.map((i) => `${i.id}: ${JSON.stringify(i)}`).join('\n');
  return {
    tool: 'write_items',
    title: 'Change the item list',
    lines: [`The item list goes from ${previous.length} to ${items.length} item${items.length === 1 ? '' : 's'}.`, ...orphaned.map((id) => `Warning: a conversation gives the item "${id}", which is no longer in the list.`)],
    diff: { name: 'items.json', lines: lineDiff(describe(previous), describe(items)) },
    async apply() {
      store.asStoryStep('Claude: change the items', () => store.setItems(items));
      await store.flushStory();
      return `The project now has ${items.length} item(s).`;
    },
    undo: undoStory('Claude: change the items'),
  };
}

function setRegions(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const list = input.regions as { id?: string; name: string; x: number; y: number; w: number; h: number; cameraBounds?: boolean; music?: string; darkness?: number; bossActive?: boolean }[];
  for (const r of list) {
    if (r.x + r.w > doc.map.width || r.y + r.h > doc.map.height) fail(`The region "${r.name}" (${r.w} x ${r.h} at ${r.x}, ${r.y}) goes outside the map (${doc.map.width} x ${doc.map.height}).`);
    if (r.id !== undefined && !doc.regions.some((x) => x.id === r.id)) fail(`There is no region with the id "${r.id}". Leave the id out to make a new region (scene_summary lists the ids).`);
  }
  const keep = new Set(list.map((r) => r.id).filter((x): x is string => x !== undefined));
  const removed = doc.regions.filter((r) => !keep.has(r.id));
  const sounds = new Set(studio.sounds.map((s) => s.name));
  const lines = [
    ...removed.map((r) => `Remove the region "${r.name}"`),
    ...list.map((r) => `${r.id ? 'Change' : 'Add'} the region "${r.name}": ${r.w} x ${r.h} cells at (${r.x}, ${r.y})${r.music ? `, music "${r.music}"${sounds.has(r.music) ? '' : ' (no such sound yet)'}` : ''}${r.darkness ? `, darkness ${r.darkness}` : ''}${r.bossActive ? ', bosses act only while the player is inside' : ''}${r.cameraBounds ? ', camera stays inside' : ''}`),
  ];
  const undoLabel = 'Claude: change the regions';
  return {
    tool: 'set_regions',
    title: 'Change the regions',
    lines,
    async apply() {
      doc.history.batch(undoLabel, () => {
        for (const r of removed) doc.removeRegion(r.id);
        for (const r of list) {
          const fields = { name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, ...(r.cameraBounds !== undefined ? { cameraBounds: r.cameraBounds } : {}), ...(r.music !== undefined ? { music: r.music } : {}), ...(r.darkness !== undefined ? { darkness: r.darkness } : {}), ...(r.bossActive !== undefined ? { bossActive: r.bossActive } : {}) };
          if (r.id) doc.updateRegion(r.id, undoLabel, (x: RegionData) => Object.assign(x, fields));
          else doc.addRegion({ cameraBounds: false, music: '', darkness: 0, bossActive: false, ...fields });
        }
      });
      return `The scene now has ${doc.regions.length} region(s).`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

async function writeTranslation(input: Record<string, unknown>): Promise<Proposal> {
  const p = store.state.project;
  if (!p) return fail('No project is open.');
  const code = String(input.language);
  const { languages } = await loadLanguages(assetFs, p.dir);
  const existing = languages.find((l) => l.code === code);
  if (!existing && !input.name) fail(`There is no language "${code}" yet. Give its own name (like "Français") in "name" to create it.`);
  const sources = await allSources();
  const known = new Set(sources.map((s) => s.text));
  const strings = input.strings as Record<string, string>;
  const unknown = Object.keys(strings).filter((k) => !known.has(k));
  const before = existing ?? newLanguage(code, String(input.name));
  const after = LanguageSchema.parse({ ...before, name: input.name ? String(input.name) : before.name, strings: { ...before.strings, ...Object.fromEntries(Object.entries(strings).filter(([k, v]) => known.has(k) && v.trim() !== '')) } });
  const added = Object.keys(after.strings).filter((k) => (before.strings[k] ?? '') !== after.strings[k]).length;
  const c = coverage(after, sources);
  const describe = (s: Record<string, string>): string => Object.entries(s).map(([k, v]) => `${k}  =>  ${v}`).join('\n');
  return {
    tool: 'write_translation',
    title: existing ? `Translate into ${after.name}` : `New language: ${after.name}`,
    lines: [`${existing ? 'Update' : 'Create'} ${after.name} (${code}): ${added} line${added === 1 ? '' : 's'} added or changed, ${c.done} of ${c.total} translated afterwards.`, ...(unknown.length > 0 ? [`Warning: ${unknown.length} line${unknown.length === 1 ? ' is' : 's are'} not text from this game and will be ignored (for example "${unknown[0]}"). Copy the original exactly as get_translations shows it.`] : [])],
    diff: { name: `${code}.strings.json`, lines: lineDiff(describe(before.strings), describe(after.strings)) },
    async apply() {
      await saveLanguage(assetFs, p.dir, after);
      return `Saved ${after.name}: ${c.done} of ${c.total} lines are translated.${c.missing.length > 0 ? ` Still missing, for example: "${c.missing[0]!.text}".` : ''}`;
    },
    async undo() {
      if (existing) await saveLanguage(assetFs, p.dir, existing);
      else await deleteLanguage(assetFs, p.dir, code);
      return true;
    },
  };
}

/** Action tools about the story, regions and translations. Returns null when the name is not one of them. */
export async function prepareStoryAction(name: string, input: Record<string, unknown>): Promise<Proposal | null> {
  switch (name) {
    case 'write_dialogue':
      return writeDialogue(input);
    case 'write_cutscene':
      return writeCutscene(input);
    case 'write_items':
      return writeItems(input);
    case 'set_regions':
      return setRegions(input);
    case 'write_translation':
      return writeTranslation(input);
    default:
      return null;
  }
}
