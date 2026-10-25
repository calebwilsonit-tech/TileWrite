import { describe, expect, it } from 'vitest';
import { buildReferences, describeReferences, referenceNote, unusedAssets, type TextFile } from './references';
import { formatProjectIndex } from './readers';

const files = [
  'project.json',
  'scenes/main.scene.json',
  'scenes/cave.scene.json',
  'assets/sprites/tree.sprite.json',
  'assets/sprites/gem.sprite.json',
  'assets/sprites/orphan.sprite.json',
  'assets/audio/chime.wav',
  'assets/audio/rain.ogg',
  'assets/tables/Buildings.table.json',
  'assets/prefabs/Farm.prefab.json',
  'assets/dialogues/gate.dialogue.json',
  'assets/items.json',
  'assets/screens.json',
  'scripts/ai.ts',
].map((path) => ({ path, size: 100 }));

const texts: TextFile[] = [
  { path: 'project.json', text: JSON.stringify({ name: 'P', scenes: ['scenes/main.scene.json', 'scenes/cave.scene.json'], startScene: 'scenes/main.scene.json', tileset: [{ id: 1, art: 'tree' }] }) },
  { path: 'scenes/main.scene.json', text: JSON.stringify({ entities: [{ components: { sprite: { name: 'tree' } }, prefab: 'Farm' }, { components: { sound: { file: 'assets/audio/chime.wav' }, dialogue: 'gate' } }] }) },
  { path: 'scenes/cave.scene.json', text: JSON.stringify({ entities: [{ components: { sprite: { name: 'gem' } } }], events: [{ text: 'You hold {Buildings.hut.cost} gold' }] }) },
  { path: 'assets/dialogues/gate.dialogue.json', text: JSON.stringify({ nodes: [{ type: 'give', item: 'brass-key' }] }) },
  { path: 'assets/items.json', text: JSON.stringify({ items: [{ id: 'brass-key', name: 'Key' }, { id: 'coin', name: 'Coin' }] }) },
  { path: 'assets/screens.json', text: JSON.stringify({ screens: [{ name: 'Pause', root: { text: 'Pick', source: 'table:Buildings' } }] }) },
  { path: 'scripts/ai.ts', text: "export default function (api) { api.play('chime.wav'); api.spawn('Farm'); return 'nothing'; }" },
  { path: 'assets/tables/Buildings.table.json', text: JSON.stringify({ columns: ['cost'], rows: [] }) },
];

describe('what uses what', () => {
  const refs = buildReferences(files, texts);

  it('finds a sprite by its name, a sound by its path or file name, a prefab, a dialogue, a table and a scene by its path', () => {
    const by = (p: string): string[] => (refs.usedBy.get(p) ?? []).map((r) => r.from).sort();
    expect(by('assets/sprites/tree.sprite.json')).toEqual(['project.json', 'scenes/main.scene.json']);
    expect(by('assets/sprites/gem.sprite.json')).toEqual(['scenes/cave.scene.json']);
    expect(by('assets/audio/chime.wav')).toEqual(['scenes/main.scene.json', 'scripts/ai.ts']);
    expect(by('assets/prefabs/Farm.prefab.json')).toEqual(['scenes/main.scene.json', 'scripts/ai.ts']);
    expect(by('assets/dialogues/gate.dialogue.json')).toEqual(['scenes/main.scene.json']);
    expect(by('assets/tables/Buildings.table.json')).toEqual(['assets/screens.json', 'scenes/cave.scene.json']);
    expect(by('scenes/main.scene.json')).toEqual(['project.json']);
  });

  it('follows ids of a list file (items) back to the file that lists them, and says where it found each', () => {
    expect((refs.usedBy.get('assets/items.json') ?? []).map((r) => [r.from, r.via])).toEqual([['assets/dialogues/gate.dialogue.json', ['item']]]);
    const sprite = refs.usedBy.get('assets/sprites/tree.sprite.json')!.find((r) => r.from === 'scenes/main.scene.json')!;
    expect(sprite.via).toEqual(['name']);
  });

  it('never counts a file as using itself, and ignores short words', () => {
    expect(refs.uses.get('assets/items.json')).toBeUndefined();
    expect([...refs.usedBy.keys()]).not.toContain('scripts/ai.ts'); // "ai" is too short to be a name
  });

  it('lists what nothing uses', () => {
    expect(unusedAssets(files, refs)).toEqual(['assets/audio/rain.ogg', 'assets/sprites/orphan.sprite.json']);
  });

  it('says in words what a file uses and what uses it', () => {
    const text = describeReferences('scenes/main.scene.json', refs);
    expect(text).toContain('scenes/main.scene.json uses 4 files');
    expect(text).toContain('assets/sprites/tree.sprite.json (in name)');
    expect(text).toContain('is used by 1 file');
    expect(text).toContain('project.json');
    expect(referenceNote('assets/sprites/orphan.sprite.json', refs)).toBe('nothing uses it');
    expect(referenceNote('assets/sprites/gem.sprite.json', refs)).toBe('used by scenes/cave.scene.json');
    expect(referenceNote('scenes/cave.scene.json', refs)).toContain('uses 1 sprite, 1 table');
  });

  it('is part of the index of the project', () => {
    const index = formatProjectIndex('P', files, { note: (p) => referenceNote(p, refs), unused: unusedAssets(files, refs) });
    expect(index).toContain('assets/sprites/tree.sprite.json (100 bytes) - used by project.json, scenes/main.scene.json');
    expect(index).toContain('assets/sprites/orphan.sprite.json (100 bytes) - nothing uses it');
    expect(index).toContain('Nothing uses these 2');
    // without references, the index is what it always was
    expect(formatProjectIndex('P', files)).not.toContain('used by');
  });
});
