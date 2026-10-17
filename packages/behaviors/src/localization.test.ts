import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CutsceneSchema, DialogueSchema, ItemSchema, newLanguage } from '@tilewright/runtime';
import { ctxOf, flatScene, player, rig, thing } from './testing';
import { attachBehavior, beginDialogue, confirmDialogue, newAction, newCondition, newRow, playCutscene, uiStrings } from './index';

const keeper = DialogueSchema.parse({
  name: 'Keeper',
  start: 'hi',
  nodes: [
    { id: 'hi', type: 'line', speaker: 'Keeper', text: 'Welcome, {who}.', next: 'ask' },
    { id: 'ask', type: 'choice', speaker: 'Keeper', prompt: 'Will you help?', options: [{ text: 'Yes', next: 'bye' }, { text: 'No', next: 'bye' }] },
    { id: 'bye', type: 'end' },
  ],
});

function world(language = '') {
  const { scene } = flatScene();
  scene.variables.push({ name: 'who', value: 'Ada' });
  const p = player('p', 5.5, 5.5);
  attachBehavior(p.components, 'health');
  scene.entities.push(p, thing('npc', 'Keeper', 6.5, 5.5, {}));
  const r = rig(scene);
  r.sim.assets.dialogues.set('Keeper', keeper);
  r.sim.assets.items.set('bread', ItemSchema.parse({ id: 'bread', name: 'Bread', use: { heal: 1, message: 'Tasty.' } }));
  const fr = newLanguage('fr', 'Français');
  fr.strings = { Keeper: 'Gardien', 'Welcome, {who}.': 'Bienvenue, {who}.', 'Will you help?': 'Voulez-vous aider ?', Yes: 'Oui', Tasty: 'Délicieux', 'Tasty.': 'Délicieux.' };
  r.sim.assets.strings.set(fr);
  r.sim.assets.strings.language = language;
  return r;
}

describe('translated text in the game', () => {
  it('a conversation shows the player\'s language, fills in placeholders after translating, and falls back for the untranslated', () => {
    const r = world('fr');
    beginDialogue(ctxOf(r), 'Keeper');
    const line = r.sim.runtime.dialogue!.view;
    expect(line).toMatchObject({ kind: 'line', speaker: 'Gardien', text: 'Bienvenue, Ada.' });
  });

  it('shows the text as written when no language is chosen', () => {
    const r = world('');
    beginDialogue(ctxOf(r), 'Keeper');
    expect(r.sim.runtime.dialogue!.view).toMatchObject({ speaker: 'Keeper', text: 'Welcome, Ada.' });
  });

  it('translates choices (the choice number is unchanged) and prompts', () => {
    const r = world('fr');
    beginDialogue(ctxOf(r), 'Keeper');
    confirmDialogue(ctxOf(r)); // on to the choice
    const st = r.sim.runtime.dialogue!;
    expect(st.view.kind).toBe('choice');
    if (st.view.kind === 'choice') {
      expect(st.view.prompt).toBe('Voulez-vous aider ?');
      expect(st.view.options.map((o) => [o.index, o.text])).toEqual([[0, 'Oui'], [1, 'No']]);
    }
  });

  it('event rows translate their message before filling in values', () => {
    const r = world('fr');
    const row = newRow('r');
    row.conditions = [newCondition('start')];
    row.actions = [{ ...newAction('message'), params: { text: 'Tasty.' } }];
    r.sim.runtime.sheet = [row];
    const seen: string[] = [];
    r.sim.events.on('message', (e) => seen.push(String(e.text)));
    r.run(2);
    expect(seen).toContain('Délicieux.');
  });

  it('a cutscene line is translated', () => {
    const r = world('fr');
    r.sim.assets.cutscenes.set('Hello', CutsceneSchema.parse({ name: 'Hello', steps: [{ id: 's1', type: 'say', speaker: 'Keeper', text: 'Welcome, {who}.' }] }));
    playCutscene(ctxOf(r), 'Hello');
    r.run(2);
    expect(r.sim.runtime.dialogue?.view).toMatchObject({ speaker: 'Gardien', text: 'Bienvenue, {who}.' });
  });
});

describe('the game screens', () => {
  it('list every fixed text so a language can cover the menus', () => {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const src = fs.readFileSync(path.join(here, 'ui', 'game-ui.ts'), 'utf8');
    const known = new Set(uiStrings());
    const found = new Set<string>();
    for (const m of src.matchAll(/(?:label: |title = |hint = )'((?:[^'\\]|\\.)*)'/g)) found.add(m[1]!.replace(/\\'/g, "'"));
    for (const m of src.matchAll(/this\.(?:tr|fmt)\('((?:[^'\\]|\\.)*)'/g)) found.add(m[1]!.replace(/\\'/g, "'"));
    const missing = [...found].filter((s) => !known.has(s));
    expect(missing).toEqual([]);
    expect(found.size).toBeGreaterThan(25);
  });
});
