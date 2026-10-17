import { describe, expect, it } from 'vitest';
import { DialogueSchema, ItemSchema, newCutscene, newDialogue, stringifyScene, type EntityData, type SceneData } from '@tilewright/runtime';
import { attachBehavior, newAction, newRow } from '@tilewright/behaviors';
import { checkProject, type StoryData } from './check';
import type { ProjectFs } from './io';
import { templateById } from './templates';

function memoryFs(): ProjectFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(f) {
      const v = files.get(f);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async write(f, t) {
      files.set(f, t);
    },
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
  };
}

const story = (over: Partial<StoryData> = {}): StoryData => ({ items: [], dialogues: new Map(), cutscenes: new Map(), ...over });

function setup(mutate?: (main: SceneData, other: SceneData) => void, extraScene = true) {
  const t = templateById('empty-iso').build('T');
  const fs = memoryFs();
  const other: SceneData = { ...structuredClone(t.scene), name: 'Cave', entities: [{ id: 'e1', name: 'Player', tags: ['player'], components: structuredClone(t.scene.entities[0]!.components) }, { id: 'e9', name: 'Cave entrance', tags: [], components: { transform: { x: 5.5, y: 5.5, h: 0, facing: 2 } } }] };
  const main = structuredClone(t.scene);
  mutate?.(main, other);
  const project = { ...t.project, scenes: extraScene ? ['scenes/main.scene.json', 'scenes/cave.scene.json'] : ['scenes/main.scene.json'], startScene: 'scenes/main.scene.json' };
  fs.files.set('/p/scenes/main.scene.json', stringifyScene(main));
  if (extraScene) fs.files.set('/p/scenes/cave.scene.json', stringifyScene(other));
  return { fs, project };
}

/** An object with behaviours attached the way the editor does it (their required parts come with them). */
const thing = (id: string, name: string, behaviours: Record<string, Record<string, unknown>>): EntityData => {
  const components: Record<string, unknown> = { transform: { x: 8.5, y: 8.5, h: 0, facing: 2 } };
  for (const [b, settings] of Object.entries(behaviours)) {
    if (b === 'collider') {
      components.collider = settings;
      continue;
    }
    attachBehavior(components, b);
    Object.assign(components[b] as object, settings);
  }
  return { id, name, tags: [], components };
};

describe('checkProject', () => {
  it('a plain project has nothing to report', async () => {
    const { fs, project } = setup();
    expect(await checkProject(fs, '/p', project, new Map(), story())).toEqual([]);
  });

  it('warns about tiles a scene uses that the tile list lost, and about autotile rules that cannot work', async () => {
    const { fs, project } = setup((main) => {
      main.map.tiles[0]![0] = 42; // a tile id nobody defined
    });
    const lostAll = await checkProject(fs, '/p', project, new Map(), story());
    const lost = lostAll.map((p) => p.message).join('\n');
    expect(lost).toMatch(/uses tile number 42, which is not in the tile list any more/);
    expect(lostAll.find((p) => p.message.includes('tile number 42'))!.id).toBe('scenes/main.scene.json:tiles-missing'); // one problem per scene
    const broken = { ...project, autotile: [{ id: 'r', name: 'Shore', base: 4, pattern: '0*******', result: 99 }] };
    const found = (await checkProject(fs, '/p', broken, new Map(), story())).map((p) => p.message).join('\n');
    expect(found).toMatch(/Autotiling: Rule 1 \(Shore\) shows a tile that no longer exists/);
  });

  it('finds doors that lead nowhere, in plain English', async () => {
    const { fs, project } = setup((main) => {
      main.entities.push(
        thing('a', 'Door A', { portal: { scene: 'scenes/missing.scene.json', spawn: '' } }),
        thing('b', 'Door B', { portal: { scene: 'scenes/cave.scene.json', spawn: 'Nowhere' } }),
        thing('c', 'Door C', { portal: { scene: '', spawn: '' } }),
        thing('d', 'Door D', { portal: { scene: 'scenes/cave.scene.json', spawn: 'Cave entrance' } }),
        thing('e', 'Door E', { portal: { scene: '', spawn: '4.5,4.5' } }),
      );
    });
    const found = await checkProject(fs, '/p', project, new Map(), story());
    const text = found.map((p) => p.message).join('\n');
    expect(text).toMatch(/portal "Door A" leads to the scene "scenes\/missing.scene.json", which is not part of this project/);
    expect(text).toMatch(/"Door B" sends the player to "Nowhere" in scenes\/cave.scene.json, but there is no object with that name/);
    expect(text).toMatch(/portal "Door C" has no destination/);
    expect(text).not.toMatch(/Door D|Door E/);
    expect(found.find((p) => p.message.includes('Door A'))).toMatchObject({ severity: 'error', scene: 'scenes/main.scene.json', entity: 'a' });
  });

  it('finds characters, cutscenes, pickups and event rows that name things that do not exist', async () => {
    const row = newRow('r1');
    row.actions = [{ ...newAction('startDialogue'), params: { dialogue: 'Ghost' } }, { ...newAction('giveItem'), params: { item: 'sword', amount: 1 } }, { ...newAction('travel'), params: { scene: 'scenes/void.scene.json', spawn: '' } }, { ...newAction('playCutscene'), params: { cutscene: 'Nope' } }];
    const { fs, project } = setup((main) => {
      main.entities.push(thing('n1', 'Chatty', { npcTalk: { dialogue: 'Keeper' } }), thing('n2', 'Mute', { npcTalk: { dialogue: '' } }), thing('t1', 'Trigger', { cutsceneTrigger: { cutscene: 'Intro' } }), thing('p1', 'Coin', { pickup: { item: 'gem' } }));
      main.events = [row];
    });
    const text = (await checkProject(fs, '/p', project, new Map(), story())).map((p) => p.message).join('\n');
    expect(text).toMatch(/"Chatty" talks using the dialogue "Keeper", which does not exist/);
    expect(text).toMatch(/"Mute" has no conversation chosen/);
    expect(text).toMatch(/"Trigger" plays the cutscene "Intro", which does not exist/);
    expect(text).toMatch(/"Coin" gives the item "gem", which is not in the Items list/);
    expect(text).toMatch(/starts the dialogue "Ghost"/);
    expect(text).toMatch(/uses the item "sword"/);
    expect(text).toMatch(/goes to the scene "scenes\/void.scene.json"/);
    expect(text).toMatch(/plays the cutscene "Nope"/);
  });

  it('is quiet when everything exists', async () => {
    const { fs, project } = setup((main) => {
      main.entities.push(thing('n1', 'Chatty', { npcTalk: { dialogue: 'Keeper' } }), thing('t1', 'Trigger', { cutsceneTrigger: { cutscene: 'Intro' } }), thing('p1', 'Coin', { pickup: { item: 'gem' } }));
    });
    const d = DialogueSchema.parse({ name: 'Keeper', start: 'a', nodes: [{ id: 'a', type: 'line', text: 'Hello' }] });
    const c = { ...newCutscene('Intro'), steps: [{ id: 's1', type: 'message' as const, async: false, text: 'Hi' }] };
    const found = await checkProject(fs, '/p', project, new Map(), story({ items: [ItemSchema.parse({ id: 'gem', name: 'Gem' })], dialogues: new Map([['Keeper', d]]), cutscenes: new Map([['Intro', c]]) }));
    expect(found).toEqual([]);
  });

  it('reports unreadable scenes, a missing start scene, and problems inside dialogues and cutscenes', async () => {
    const { fs, project } = setup(undefined, true);
    fs.files.set('/p/scenes/cave.scene.json', '{ not json');
    const broken = { ...project, startScene: 'scenes/gone.scene.json' };
    const bad = newDialogue('Hi');
    bad.nodes[0] = { id: 'n1', type: 'line', speaker: '', text: '', next: 'zzz' };
    const found = await checkProject(fs, '/p', broken, new Map(), story({ dialogues: new Map([['Hi', bad]]), cutscenes: new Map([['Empty', newCutscene('Empty')]]) }));
    const text = found.map((p) => p.message).join('\n');
    expect(text).toMatch(/cave\.scene\.json/);
    expect(text).toMatch(/starts in "scenes\/gone.scene.json", which is not one of its scenes/);
    expect(text).toMatch(/Dialogue "Hi": .*goes to "zzz"/);
    expect(text).toMatch(/Cutscene "Empty": The cutscene "Empty" has no steps yet/);
  });

  it('includes puzzle analysis, with the scene it belongs to', async () => {
    const { fs, project } = setup((main) => {
      const gate = thing('g', 'Gate', { gate: {} });
      gate.components.transform = { x: 20.5, y: 16.5, h: 0, facing: 2 };
      const goal = thing('x', 'Treasure', {});
      goal.tags = ['goal'];
      goal.components.transform = { x: 26.5, y: 16.5, h: 0, facing: 2 };
      main.entities.push(gate, goal); // open grass everywhere: the gate guards nothing
    });
    const found = await checkProject(fs, '/p', project, new Map(), story());
    const bypass = found.find((p) => p.id.endsWith('goal-bypass-x'));
    expect(bypass).toMatchObject({ severity: 'warning', scene: 'scenes/main.scene.json', entity: 'x' });
    expect(found.some((p) => p.id.endsWith('gate-useless-g'))).toBe(true);
  });
});
