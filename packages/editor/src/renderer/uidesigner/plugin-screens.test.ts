import { describe, expect, it } from 'vitest';
import { emptyUiDoc, UiDocSchema, type UiDoc } from '@tilewright/runtime';
import { host, withPluginScreens } from '@tilewright/behaviors';
import '../../bundled-editor';
import { customize, diffScreens, pluginScreenRows, removeCopy, revert } from './plugin-screens';
import { updateWidget } from './ui-edit';

const row = (doc: UiDoc, id: string) => pluginScreenRows(doc).find((r) => r.id === id)!;

describe('screens that come with plugins', () => {
  it('start out as offered, and a project’s own screen for the role replaces them', () => {
    const doc = emptyUiDoc();
    expect(row(doc, 'prebuilt-pause').state).toEqual({ kind: 'as-offered' });
    expect(row(doc, 'prebuilt-pause').roleLabel).toBe('Pause');
    const own = UiDocSchema.parse({ screens: [{ ...host.ext.screens.get('prebuilt-pause')!.screen, id: 'mine', name: 'Pause' }] });
    expect(row(own, 'prebuilt-pause').state).toEqual({ kind: 'replaced', by: 'Pause' });
  });

  it('Customize makes a copy that plays the role, remembers where it came from, and the plugin’s is no longer added', () => {
    const made = customize(emptyUiDoc(), 'prebuilt-screens', 'prebuilt-pause')!;
    expect(made.screen).toMatchObject({ name: 'Pause', role: 'pause', from: { plugin: 'prebuilt-screens', screen: 'prebuilt-pause' } });
    expect(row(made.doc, 'prebuilt-pause').state.kind).toBe('copy');
    expect(withPluginScreens(made.doc).screens.filter((s) => s.role === 'pause')).toHaveLength(1);
    // customizing again gives another copy under another name
    const again = customize(made.doc, 'prebuilt-screens', 'prebuilt-pause')!;
    expect(again.screen.name).toBe('Pause 2');
  });

  it('a changed copy is noticed, compared in plain words, and put back by Revert', () => {
    const { doc, screen } = customize(emptyUiDoc(), 'prebuilt-screens', 'prebuilt-pause')!;
    const edited = updateWidget(doc, 'resume.label', (n) => void (n.text = 'Carry on'));
    expect(row(edited, 'prebuilt-pause').state.kind).toBe('changed');
    const theirs = host.ext.screens.get('prebuilt-pause')!.screen;
    const lines = diffScreens(edited.screens[0]!, theirs);
    expect(lines).toEqual(["\"Pause box > Resume > Label\": text \"Carry on\" here, \"Resume\" in the plugin's."]);
    expect(diffScreens(doc.screens[0]!, theirs)).toEqual([]);
    const back = revert(edited, screen.id);
    expect(row(back, 'prebuilt-pause').state.kind).toBe('copy');
    expect(back.screens[0]!.id).toBe(screen.id);
    expect(removeCopy(back, screen.id).screens).toEqual([]);
  });

  it('says when the plugin has a newer screen than the copy was made from, whether or not the copy was changed', () => {
    const { doc } = customize(emptyUiDoc(), 'prebuilt-screens', 'prebuilt-pause')!;
    // pretend the copy was made from an older version
    const old: UiDoc = { ...doc, screens: doc.screens.map((s) => ({ ...s, from: { ...s.from!, hash: 'oldoldol' } })) };
    expect(row(old, 'prebuilt-pause').state.kind).toBe('changed-outdated'); // its own hash no longer matches the one it remembers
    // an unchanged copy of an older version: its content is the old content, so its hash is the one it remembers
    const sameAsRemembered = { ...old, screens: old.screens.map((s) => ({ ...s, from: { ...s.from!, hash: hashOf(s) } })) };
    expect(row(sameAsRemembered, 'prebuilt-pause').state.kind).toBe('copy');
  });

  it('compares widgets that were added, removed and moved', () => {
    const theirs = host.ext.screens.get('prebuilt-pause')!.screen;
    const mine = structuredClone(theirs);
    const box = mine.root.children[0]!;
    box.children = [...box.children.slice(1), box.children[0]!]; // the heading moved to the end
    box.children.push({ ...box.children[0]!, id: 'extra', name: 'Extra' });
    const lines = diffScreens(mine, theirs);
    expect(lines.some((l) => l.includes('"Pause box > Extra" is only in your copy'))).toBe(true);
    expect(lines.some((l) => l.includes('in a different order'))).toBe(true);
  });

  it('the heads-up display copy follows the project’s layout when it is made', () => {
    const made = customize(emptyUiDoc(), 'prebuilt-screens', 'prebuilt-hud')!;
    expect(made.screen.role).toBe('hud');
    expect(made.screen.root.children[0]!.children.length).toBeGreaterThan(0);
  });
});

import { screenHash } from '@tilewright/behaviors';
const hashOf = screenHash;
