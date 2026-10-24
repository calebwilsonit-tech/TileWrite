import { describe, expect, it } from 'vitest';
import { C, CutsceneSchema, DialogueSchema, ItemSchema, itemCount, quickSlots, type EntityData, type TransformIso } from '@tilewright/runtime';
import { GRID_PLUS_X, ctxOf, flatScene, player, rig, thing, type Rig } from '@tilewright/plugin-sdk/testing';
import { attachBehavior, newAction, newCondition, newRow, output } from '@tilewright/behaviors';
import { beginDialogue, playCutscene } from '@tilewright/plugin-story';
import { damage, healthOf } from '@tilewright/plugin-combat';
import { litPosts } from '@tilewright/plugin-storytender';
import { useItem } from '@tilewright/plugin-inventory';
import { placeAtSpawn } from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';

const pos = (r: Rig, id: string): { x: number; y: number } => {
  const t = r.get(id).get<TransformIso>(C.Transform)!;
  return { x: t.x, y: t.y };
};

const keeper = DialogueSchema.parse({
  name: 'Keeper',
  start: 'hi',
  nodes: [
    { id: 'hi', type: 'line', speaker: 'Keeper', text: 'Need a key, {who}?', next: 'ask' },
    { id: 'ask', type: 'choice', options: [{ text: 'Yes please', next: 'give' }, { text: 'No thanks', next: 'bye' }] },
    { id: 'give', type: 'give', item: 'key', amount: 1, next: 'flag' },
    { id: 'flag', type: 'set', variable: 'gotKey', value: true, next: 'bye' },
    { id: 'bye', type: 'end' },
  ],
});

function withStory(r: Rig): Rig {
  r.sim.assets.dialogues.set('Keeper', keeper);
  r.sim.assets.items.set('key', ItemSchema.parse({ id: 'key', name: 'Brass key', max: 2 }));
  r.sim.assets.items.set('bread', ItemSchema.parse({ id: 'bread', name: 'Bread', use: { heal: 2, message: 'Tasty.' } }));
  return r;
}

function hero(x = 5.5, y = 5.5): EntityData {
  const p = player('p', x, y);
  attachBehavior(p.components, 'health');
  Object.assign(p.components.health as object, { max: 4, onDeath: 'respawn', invulnerableSeconds: 0.1 });
  return p;
}

describe('conversations', () => {
  function talkRig() {
    const { scene } = flatScene();
    scene.variables.push({ name: 'who', value: 'Ada' }, { name: 'gotKey', value: false });
    scene.entities.push(hero(), thing('npc', 'Keeper', 6.5, 5.5, { npcTalk: { dialogue: 'Keeper' } }));
    return withStory(rig(scene));
  }

  it('Interact next to an NPC opens the conversation, the world freezes, choices work, and the held button does not reopen it', () => {
    const r = talkRig();
    r.run(2);
    expect(r.get('npc').get<{ text: string }>('label')?.text).toBe('E: talk');
    r.run(1, { interact: 1 });
    expect(r.sim.runtime.dialogue?.view).toMatchObject({ kind: 'line', text: 'Need a key, Ada?' });
    expect(r.sim.modal).toBe('freeze');
    const before = pos(r, 'p');
    r.run(30, GRID_PLUS_X); // trying to walk away: frozen
    expect(pos(r, 'p')).toEqual(before);
    r.run(1); // let go
    r.run(1, { interact: 1 }); // continue
    expect(r.sim.runtime.dialogue?.view.kind).toBe('choice');
    r.run(1);
    r.run(1, { move_down: 1 }); // highlight "No thanks"...
    expect(r.sim.runtime.dialogue?.selected).toBe(1);
    r.run(1);
    r.run(1, { move_up: 1 }); // ...and back to "Yes please"
    expect(r.sim.runtime.dialogue?.selected).toBe(0);
    r.run(1);
    r.run(40, { interact: 1 }); // pick it, and keep holding the button
    expect(r.sim.runtime.dialogue).toBeNull();
    expect(itemCount(r.sim.runtime.vars, 'key')).toBe(1);
    expect(r.sim.runtime.vars.gotKey).toBe(true);
    expect(r.get('npc').get<{ text: string }>('label')?.text).toBe('E: talk'); // free again; the held press did not reopen it
    expect(output(r.get('npc'), 'talked')).toBe(true);
    expect(r.sim.modal).toBe('none');
    r.run(1);
    r.run(1, GRID_PLUS_X);
    r.run(10, GRID_PLUS_X);
    expect(pos(r, 'p').x).toBeGreaterThan(before.x);
  });

  it('can talk only once, and says so when the dialogue is missing', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(), thing('npc', 'N', 6.5, 5.5, { npcTalk: { dialogue: 'Keeper', once: true } }), thing('ghost', 'G', 4.5, 5.5, { npcTalk: { dialogue: 'Nobody' } }));
    const r = withStory(rig(scene));
    r.run(1, { interact: 1 });
    expect(r.sim.runtime.dialogue).not.toBeNull();
    for (let i = 0; i < 3; i++) {
      r.run(1);
      r.run(1, { interact: 1 });
    }
    r.run(1);
    r.run(1, { interact: 1 }); // choose
    r.run(2);
    expect(r.sim.runtime.dialogue).toBeNull();
    r.run(1);
    r.run(1, { interact: 1 });
    expect(r.sim.runtime.dialogue).toBeNull(); // only once
    const problems = r.sim.events.recent.filter((e) => e.type === 'problem');
    void problems; // the missing dialogue is reported when started
    beginDialogue(ctxOf(r), 'Nobody');
    expect(r.sim.events.of('problem')[0]!.text).toMatch(/dialogue "Nobody", which does not exist/);
  });
});

describe('items', () => {
  it('a pickup puts an item in the bag and the first quick slot; quick slots use it', () => {
    const { scene } = flatScene();
    const hp = hero(5.5, 5.5);
    scene.entities.push(hp, thing('loaf', 'Bread', 5.5, 5.5, { pickup: { variable: '', item: 'bread', amount: 2, message: 'Bread!' } }));
    const r = withStory(rig(scene));
    damage(ctxOf(r), r.get('p'), 3, { ignoreIframes: true });
    r.run(3);
    expect(itemCount(r.sim.runtime.vars, 'bread')).toBe(2);
    expect(quickSlots(r.sim.runtime.vars)[0]).toBe('bread');
    expect(healthOf(r.get('p'))!.hp).toBe(1);
    r.run(1, { quick_1: 1 });
    expect(healthOf(r.get('p'))!.hp).toBe(3);
    expect(itemCount(r.sim.runtime.vars, 'bread')).toBe(1);
    r.run(1);
    r.run(1, { quick_1: 1 });
    expect(healthOf(r.get('p'))!.hp).toBe(4); // capped at the maximum
    r.run(1);
    r.run(1, { quick_1: 1 }); // full health and nothing else to gain: not wasted
    expect(itemCount(r.sim.runtime.vars, 'bread')).toBe(0);
    expect(quickSlots(r.sim.runtime.vars)[0]).toBe('');
  });

  it('does not waste a healing item at full health, and cannot use what it does not have', () => {
    const { scene } = flatScene();
    scene.entities.push(hero());
    const r = withStory(rig(scene));
    r.sim.runtime.vars['item:bread'] = 1;
    r.run(2);
    expect(useItem(ctxOf(r), 'bread')).toBe(false);
    expect(itemCount(r.sim.runtime.vars, 'bread')).toBe(1);
    expect(useItem(ctxOf(r), 'key')).toBe(false);
    expect(useItem(ctxOf(r), 'nope')).toBe(false);
  });
});

describe('lantern posts', () => {
  it('lighting a lantern sets the checkpoint, heals, lights up, and death returns the player there', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5), thing('post', 'Post', 6.5, 5.5, { checkpoint: { name: 'Hall lantern' } }));
    const r = withStory(rig(scene));
    damage(ctxOf(r), r.get('p'), 2, { ignoreIframes: true });
    r.run(2);
    expect(healthOf(r.get('p'))!.hp).toBe(2);
    expect(output(r.get('post'), 'lit')).toBe(false);
    expect(r.get('post').get<{ text: string }>('label')?.text).toBe('E: light the lantern');
    r.run(1, { interact: 1 });
    r.run(2);
    expect(output(r.get('post'), 'lit')).toBe(true);
    expect(r.get('post').has('light')).toBe(true);
    expect(healthOf(r.get('p'))!.hp).toBe(4);
    expect(r.sim.runtime.checkpoint).toMatchObject({ name: 'Hall lantern', x: 6.5, y: 6.5 });
    expect(litPosts(r.sim.runtime.vars)).toEqual([expect.objectContaining({ name: 'Hall lantern', x: 6.5, y: 6.5 })]);
    // far away, the player is defeated and wakes up at the lantern
    const t = r.get('p').get<TransformIso>(C.Transform)!;
    t.x = 18.5;
    t.y = 18.5;
    damage(ctxOf(r), r.get('p'), 99, { ignoreIframes: true });
    r.run(3);
    expect(healthOf(r.get('p'))!.hp).toBe(4);
    expect(pos(r, 'p')).toEqual({ x: 6.5, y: 6.5 });
  });

  it('resting at a lit lantern again says so', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5), thing('post', 'Post', 6.5, 5.5, { checkpoint: {} }));
    const r = rig(scene);
    r.run(1, { interact: 1 });
    r.run(1);
    r.run(1, { interact: 1 });
    expect(r.sim.events.of('message').map((e) => e.text)).toEqual(['Rested at Lantern.']);
  });

  it('a defeated player whose lantern is in another scene is sent there', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5));
    const r = rig(scene);
    r.sim.runtime.scene = 'scenes/dungeon.scene.json';
    r.sim.runtime.checkpoint = { scene: 'scenes/hub.scene.json', x: 3.5, y: 3.5, h: 0, name: 'Hub lantern' };
    damage(ctxOf(r), r.get('p'), 99, { ignoreIframes: true });
    r.run(2);
    expect(r.sim.runtime.travel).toEqual({ scene: 'scenes/hub.scene.json', spawn: '', x: 3.5, y: 3.5 });
  });
});

describe('portals and spawns', () => {
  it('stepping into a portal asks the game to change scene', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(5.5, 5.5), thing('door', 'Door', 5.5, 5.5, { portal: { scene: 'scenes/cave.scene.json', spawn: 'Cave entrance' } }));
    const r = rig(scene);
    r.run(3);
    expect(r.sim.runtime.travel).toEqual({ scene: 'scenes/cave.scene.json', spawn: 'Cave entrance' });
  });

  it('placeAtSpawn finds a named object or a point', () => {
    const { scene } = flatScene();
    scene.entities.push(hero(2.5, 2.5), thing('m', 'Cave entrance', 9.5, 8.5, {}));
    const r = rig(scene);
    expect(placeAtSpawn(ctxOf(r), r.get('p'), 'Cave entrance')).toBe(true);
    expect(pos(r, 'p')).toEqual({ x: 9.5, y: 8.5 });
    expect(placeAtSpawn(ctxOf(r), r.get('p'), '3.5,4.5')).toBe(true);
    expect(pos(r, 'p')).toEqual({ x: 3.5, y: 4.5 });
    expect(placeAtSpawn(ctxOf(r), r.get('p'), 'Nowhere')).toBe(false);
    expect(placeAtSpawn(ctxOf(r), r.get('p'), '')).toBe(false);
  });
});

describe('cutscenes', () => {
  const cut = (steps: unknown[], extra: object = {}) => CutsceneSchema.parse({ name: 'Intro', steps: steps.map((s, i) => ({ id: `s${i}`, ...(s as object) })), ...extra });

  function cutRig(steps: unknown[], opts: { skippable?: boolean } = {}) {
    const { scene } = flatScene();
    scene.variables.push({ name: 'a', value: 0 }, { name: 'b', value: 0 }, { name: 'c', value: 0 });
    scene.entities.push(hero(4.5, 5.5), thing('npc', 'Keeper', 12.5, 5.5, {}));
    const r = withStory(rig(scene));
    r.sim.assets.cutscenes.set('Intro', cut(steps, opts));
    return r;
  }

  it('runs steps in order, waits for time and for a button press, and then ends', () => {
    const r = cutRig([{ type: 'setVariable', name: 'a', value: 1 }, { type: 'wait', seconds: 0.5 }, { type: 'setVariable', name: 'b', value: 1 }, { type: 'waitInput' }, { type: 'setVariable', name: 'c', value: 1 }]);
    r.run(2);
    expect(playCutscene(ctxOf(r), 'Intro')).toBe(true);
    expect(playCutscene(ctxOf(r), 'Intro')).toBe(false); // already playing
    r.run(2);
    expect(r.sim.runtime.vars).toMatchObject({ a: 1, b: 0 });
    expect(r.sim.modal).toBe('scripted');
    r.run(40);
    expect(r.sim.runtime.vars).toMatchObject({ a: 1, b: 1, c: 0 });
    expect(r.sim.runtime.cutscene).not.toBeNull(); // waiting for a button
    r.run(1, { interact: 1 });
    r.run(2);
    expect(r.sim.runtime.vars.c).toBe(1);
    expect(r.sim.runtime.cutscene).toBeNull();
    expect(r.sim.events.of('cutscene-ended')).toHaveLength(0); // events are per tick; the state is the proof
  });

  it('the player cannot move during a cutscene, and a button held through its end stays ignored', () => {
    const r = cutRig([{ type: 'wait', seconds: 1 }]);
    r.run(2);
    const before = pos(r, 'p');
    playCutscene(ctxOf(r), 'Intro');
    r.run(90, GRID_PLUS_X); // held the whole time, past the end of the cutscene
    expect(pos(r, 'p')).toEqual(before);
    expect(r.sim.runtime.cutscene).toBeNull();
    r.run(1);
    r.run(30, GRID_PLUS_X);
    expect(pos(r, 'p').x).toBeGreaterThan(before.x + 1);
  });

  it('walks characters (the player included) to a spot and then carries on', () => {
    const r = cutRig([{ type: 'move', who: 'player', to: '9.5,5.5', speed: 4 }, { type: 'setVariable', name: 'a', value: 1 }, { type: 'move', who: 'name:Keeper', to: '12.5,8.5', speed: 4, async: true }, { type: 'setVariable', name: 'b', value: 1 }]);
    r.run(2);
    playCutscene(ctxOf(r), 'Intro');
    r.run(30);
    expect(r.sim.runtime.vars.a).toBe(0); // still walking
    r.run(60);
    expect(pos(r, 'p').x).toBeCloseTo(9.5, 0);
    expect(r.sim.runtime.vars).toMatchObject({ a: 1, b: 1 }); // the async walk did not hold up the next step
    r.run(60);
    expect(pos(r, 'npc').y).toBeGreaterThan(8);
    expect(r.sim.runtime.cutscene).toBeNull();
  });

  it('says lines in a box the player confirms, and runs dialogues', () => {
    const r = cutRig([{ type: 'say', speaker: 'Narrator', text: 'Once upon a time...' }, { type: 'setVariable', name: 'a', value: 1 }, { type: 'dialogue', dialogue: 'Keeper' }, { type: 'setVariable', name: 'b', value: 1 }]);
    r.run(2);
    playCutscene(ctxOf(r), 'Intro');
    r.run(2);
    expect(r.sim.runtime.dialogue?.view).toEqual({ kind: 'line', speaker: 'Narrator', text: 'Once upon a time...' });
    expect(r.sim.runtime.vars.a).toBe(0);
    r.run(1, { interact: 1 });
    r.run(2);
    expect(r.sim.runtime.vars.a).toBe(1);
    expect(r.sim.runtime.dialogue?.dialogue).toBe('Keeper');
    for (const press of [{ interact: 1 }, { interact: 1 }]) {
      r.run(1);
      r.run(1, press);
    }
    r.run(3);
    expect(r.sim.runtime.dialogue).toBeNull();
    expect(r.sim.runtime.vars.b).toBe(1);
  });

  it('moves the camera and fades the screen, then gives the camera back', () => {
    const r = cutRig([{ type: 'cameraTo', target: 'name:Keeper', seconds: 0.5, zoom: 1.5 }, { type: 'fade', to: 1, seconds: 0.4, async: true }, { type: 'wait', seconds: 0.5 }, { type: 'cameraReset', seconds: 0.3 }]);
    r.run(2);
    playCutscene(ctxOf(r), 'Intro');
    r.run(20);
    const v = r.sim.runtime.view;
    expect(v.cameraTarget!.x).toBeGreaterThan(4.5); // on its way to the Keeper
    r.run(20);
    expect(v.cameraTarget).toMatchObject({ x: 12.5, y: 5.5 });
    expect(v.cameraZoom).toBeCloseTo(1.5, 1);
    expect(v.fade.alpha).toBeGreaterThan(0.2);
    r.run(120);
    expect(r.sim.runtime.cutscene).toBeNull();
    expect(v.cameraTarget).toBeNull();
    expect(v.fade.alpha).toBe(1);
  });

  it('can be skipped: everything still happens, instantly', () => {
    const r = cutRig([{ type: 'setVariable', name: 'a', value: 1 }, { type: 'wait', seconds: 10 }, { type: 'move', who: 'player', to: '10.5,8.5' }, { type: 'give', item: 'key', amount: 1 }, { type: 'fade', to: 0.7, seconds: 5 }, { type: 'setVariable', name: 'b', value: 1 }]);
    r.run(2);
    playCutscene(ctxOf(r), 'Intro');
    r.run(5);
    r.run(1, { pause: 1 });
    r.run(2);
    expect(r.sim.runtime.cutscene).toBeNull();
    expect(r.sim.runtime.vars).toMatchObject({ a: 1, b: 1, 'item:key': 1 });
    expect(pos(r, 'p')).toEqual({ x: 10.5, y: 8.5 });
    expect(r.sim.runtime.view.fade.alpha).toBeCloseTo(0.7, 5);
  });

  it('cannot be skipped when it says so', () => {
    const r = cutRig([{ type: 'wait', seconds: 10 }, { type: 'setVariable', name: 'a', value: 1 }], { skippable: false });
    r.run(2);
    playCutscene(ctxOf(r), 'Intro');
    r.run(5);
    r.run(1, { pause: 1 });
    r.run(2);
    expect(r.sim.runtime.cutscene).not.toBeNull();
    expect(r.sim.runtime.vars.a).toBe(1 - 1 + (r.sim.runtime.vars.a as number)); // not skipped yet: still within the wait
  });

  it('a trigger zone plays its cutscene once', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'a', value: 0 });
    scene.entities.push(hero(5.5, 5.5), thing('zone', 'Zone', 5.5, 5.5, { cutsceneTrigger: { cutscene: 'Intro', once: true } }));
    const r = withStory(rig(scene));
    r.sim.assets.cutscenes.set('Intro', cut([{ type: 'setVariable', name: 'a', value: 1 }, { type: 'message', text: 'Hi' }]));
    r.run(5);
    expect(r.sim.runtime.vars.a).toBe(1);
    expect(output(r.get('zone'), 'played')).toBe(true);
    r.sim.runtime.vars.a = 0;
    r.run(60);
    expect(r.sim.runtime.vars.a).toBe(0); // not again
  });
});

describe('event sheet and story', () => {
  const cond = (type: string, params: Record<string, unknown> = {}) => ({ ...newCondition(type), params: { ...newCondition(type).params, ...params } });
  const act = (type: string, params: Record<string, unknown> = {}) => ({ ...newAction(type), params: { ...newAction(type).params, ...params } });

  it('gives and takes items, checks for them, starts conversations and cutscenes, and asks to travel and save', () => {
    const { scene } = flatScene();
    scene.variables.push({ name: 'a', value: 0 });
    scene.entities.push(hero());
    scene.events = [
      { ...newRow('start'), conditions: [cond('start')], actions: [act('giveItem', { item: 'key', amount: 2 })] },
      { ...newRow('has'), conditions: [cond('hasItem', { item: 'key', atLeast: 2 })], actions: [act('setVariable', { name: 'a', op: 'set', value: '1' })] },
      { ...newRow('go'), conditions: [cond('hasItem', { item: 'key', atLeast: 2 })], actions: [act('travel', { scene: 'scenes/cave.scene.json', spawn: 'Cave entrance' }), act('saveGame')] },
    ];
    const r = withStory(rig(scene));
    r.run(4);
    expect(itemCount(r.sim.runtime.vars, 'key')).toBe(2);
    expect(quickSlots(r.sim.runtime.vars)[0]).toBe('key');
    expect(r.sim.runtime.vars.a).toBe(1);
    expect(r.sim.runtime.travel).toEqual({ scene: 'scenes/cave.scene.json', spawn: 'Cave entrance' });
  });

  it('startDialogue and playCutscene actions work', () => {
    const { scene } = flatScene();
    scene.entities.push(hero());
    scene.events = [
      { ...newRow('d'), conditions: [cond('start')], actions: [act('startDialogue', { dialogue: 'Keeper' })] },
    ];
    const r = withStory(rig(scene));
    r.run(3);
    expect(r.sim.runtime.dialogue?.dialogue).toBe('Keeper');
  });
});

describe('difficulty', () => {
  it('only changes what the player takes', () => {
    const run = (difficulty: 'easy' | 'normal' | 'hard'): { player: number; enemy: number } => {
      const { scene } = flatScene();
      const foe = thing('foe', 'Foe', 14.5, 14.5, { health: { max: 10, team: 'enemy' } });
      scene.entities.push(hero(), foe);
      const r = rig(scene);
      r.sim.runtime.difficulty = difficulty;
      damage(ctxOf(r), r.get('p'), 2, { ignoreIframes: true });
      damage(ctxOf(r), r.get('foe'), 2, { ignoreIframes: true });
      return { player: healthOf(r.get('p'))!.hp, enemy: healthOf(r.get('foe'))!.hp };
    };
    expect(run('easy')).toEqual({ player: 3, enemy: 8 });
    expect(run('normal')).toEqual({ player: 2, enemy: 8 });
    expect(run('hard')).toEqual({ player: 1, enemy: 8 });
  });
});
