import { describe, expect, it } from 'vitest';
import { DialogueSchema, FLAG, ItemSchema, newMinigame, tileMapToRows, type MinigameData, type SceneData } from '@tilewright/runtime';
import { attachBehavior, output } from '@tilewright/behaviors';
import { flatScene, player, thing } from '@tilewright/plugin-sdk/testing';
import { Bot, formatTime } from '@tilewright/playbot';
import { Game } from '@tilewright/playbot';
import { extractPushPuzzle, solvePush } from '@tilewright/playbot';
import { PlaythroughSchema, newPlaythrough, replayPlaythrough } from '@tilewright/playbot';
import { fight } from '@tilewright/plugin-combat/playbot';
import { holdPlatesWithEchoes } from '@tilewright/plugin-storytender/playbot';
import '@tilewright/bundled-plugins/tooling';

type FS = ReturnType<typeof flatScene>;
function sceneOf(fs: FS, ...entities: SceneData['entities']): SceneData {
  fs.scene.map = tileMapToRows(fs.map);
  fs.scene.entities.push(...entities);
  return fs.scene;
}
const solid = { w: 0.9, d: 0.9, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };
const goalAt = (x: number, y: number) => ({ ...thing('goal', 'Exit', x, y, {}), tags: ['goal'] });

describe('walking', () => {
  it('walks across a room with the movement buttons only, and says how long it took', () => {
    const game = new Game({ scene: sceneOf(flatScene(20, 12), player('p', 2.5, 2.5), goalAt(16.5, 8.5)) });
    const bot = new Bot(game);
    const r = bot.walkToEntity('tag:goal', { label: 'the exit' });
    expect(r.ok).toBe(true);
    expect(r.kind).toBe('reached');
    expect(r.message).toMatch(/^Reached the exit in \d+\.\ds\.$/);
    expect(Math.hypot(game.position.x - 16.5, game.position.y - 8.5)).toBeLessThan(0.3);
    expect(bot.recording().length).toBeGreaterThan(60); // everything it did was a button press
  });

  it('goes round a wall through the doorway, and around objects in the way', () => {
    const fs = flatScene(20, 12);
    for (let y = 0; y < 12; y++) if (y !== 10) fs.map.setFlag(9, y, FLAG.BLOCK);
    const game = new Game({ scene: sceneOf(fs, player('p', 2.5, 2.5), thing('crate', 'Crate', 5.5, 2.5, {}, { collider: solid }), goalAt(15.5, 2.5)) });
    const r = new Bot(game).walkToEntity('tag:goal');
    expect(r.kind).toBe('reached');
  });

  it('reports a goal it cannot walk to, in plain English', () => {
    const fs = flatScene(20, 12);
    for (let y = 0; y < 12; y++) fs.map.setFlag(9, y, FLAG.BLOCK);
    const game = new Game({ scene: sceneOf(fs, player('p', 2.5, 2.5), goalAt(15.5, 2.5)) });
    const r = new Bot(game).walkToEntity('tag:goal', { label: '"Exit"' });
    expect(r).toMatchObject({ ok: false, kind: 'blocked' });
    expect(r.message).toBe('There is no way to walk to "Exit" from here.');
  });

  it('notices when it is stuck behind something it cannot see coming, and says where', () => {
    // a sleeping monster with a collider fills the only way through; the bot cannot plan around people
    const fs = flatScene(20, 6);
    for (let x = 0; x < 20; x++) {
      fs.map.setFlag(x, 1, FLAG.BLOCK);
      fs.map.setFlag(x, 3, FLAG.BLOCK);
    }
    const monster = thing('m', 'Monster', 8.5, 2.5, {}, { collider: solid, body: { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 4, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null } });
    const game = new Game({ scene: sceneOf(fs, player('p', 2.5, 2.5), monster, goalAt(15.5, 2.5)) });
    const r = new Bot(game).walkToEntity('tag:goal', { maxSeconds: 40 });
    expect(r.ok).toBe(false);
    expect(r.kind).toBe('stuck');
    expect(r.message).toMatch(/^Stuck at cell \(7, 2\) for \d+ s while heading for "Exit"\.$/);
  });

  it('gives up with a time-out report when the time is too short', () => {
    const game = new Game({ scene: sceneOf(flatScene(30, 12), player('p', 1.5, 2.5), goalAt(28.5, 9.5)) });
    const r = new Bot(game).walkToEntity('tag:goal', { maxSeconds: 2, label: 'the far end' });
    expect(r.kind).toBe('timeout');
    expect(r.message).toBe('Did not reach the far end within 2.0s.');
  });

  it('formats times like a person would say them', () => {
    expect(formatTime(12.34)).toBe('12.3s');
    expect(formatTime(130)).toBe('2m10s');
    expect(formatTime(60)).toBe('1m00s');
  });
});

describe('interacting', () => {
  it('walks to a character, talks it through, and picks the second answer', () => {
    const fs = flatScene(14, 10);
    const npc = thing('npc', 'Keeper', 9.5, 5.5, { npcTalk: { dialogue: 'Keeper' } });
    const game = new Game({
      scene: sceneOf(fs, player('p', 2.5, 5.5), npc),
      items: [ItemSchema.parse({ id: 'key', name: 'Key' })],
      dialogues: new Map([
        ['Keeper', DialogueSchema.parse({ name: 'Keeper', start: 'a', nodes: [{ id: 'a', type: 'line', text: 'Key?', next: 'b' }, { id: 'b', type: 'choice', options: [{ text: 'No', next: 'z' }, { text: 'Yes', next: 'g' }] }, { id: 'g', type: 'give', item: 'key', amount: 1, next: 'z' }, { id: 'z', type: 'end' }] })],
      ]),
    });
    const bot = new Bot(game);
    const r = bot.interact('name:Keeper');
    expect(r.ok).toBe(true);
    expect(game.sim.runtime.dialogue).not.toBeNull();
    bot.talkThrough((options) => options.indexOf('Yes'));
    expect(game.sim.runtime.dialogue).toBeNull();
    expect(game.sim.runtime.vars['item:key']).toBe(1);
  });
});

describe('minigames', () => {
  const kinds = ['timing', 'sequence', 'pairs'] as const;
  for (const kind of kinds) {
    it(`walks to an arcade and wins the ${kind} minigame with the buttons, then the gate it guards opens`, () => {
      const fs = flatScene(14, 10);
      const arcade = thing('arcade', 'Arcade', 9.5, 5.5, { minigameStation: { minigame: 'Game' } });
      const game = new Game({
        scene: sceneOf(fs, player('p', 2.5, 5.5), arcade),
        items: [ItemSchema.parse({ id: 'medal', name: 'Medal' })],
        minigames: [{ ...newMinigame(kind, 'Game'), rewardItem: 'medal', winVariable: 'won_game' } as MinigameData],
        seed: 5,
      });
      const bot = new Bot(game);
      expect(bot.interact('name:Arcade').ok).toBe(true);
      expect(game.sim.runtime.minigame).not.toBeNull();
      const r = bot.playMinigame();
      expect(r.ok, r.message).toBe(true);
      expect(r.message).toMatch(/^Won the minigame "Game"/);
      expect(game.sim.runtime.minigame).toBeNull();
      expect(game.sim.runtime.vars['won_game']).toBe(true);
      expect(game.sim.runtime.vars['item:medal']).toBe(1);
    });
  }

  it('says so when no minigame is open', () => {
    const game = new Game({ scene: sceneOf(flatScene(6, 6), player('p', 2.5, 2.5)) });
    expect(new Bot(game).playMinigame().message).toBe('There is no minigame open.');
  });
});

describe('puzzles', () => {
  const crate = (id: string, x: number, y: number) => thing(id, 'Crate ' + id, x, y, { pushable: {} }, { collider: solid });

  function corridorScene(): SceneData {
    const fs = flatScene(14, 10);
    for (let x = 0; x < 14; x++) {
      fs.map.setFlag(x, 4, FLAG.BLOCK);
      fs.map.setFlag(x, 6, FLAG.BLOCK);
    }
    fs.map.setFlag(10, 5, FLAG.BLOCK);
    return sceneOf(fs, player('p', 3.5, 5.5), crate('c', 5.5, 5.5), thing('plate', 'Plate', 9.5, 5.5, { pressurePlate: { activatedBy: 'crates' } }), thing('gate', 'Gate', 12.5, 2.5, { gate: {} }));
  }

  it('carries out the pushes a solver found, with the buttons, and the plate goes down', () => {
    const scene = corridorScene();
    scene.wires.push({ id: 'w', from: { entity: 'plate', output: 'active' }, to: { entity: 'gate', input: 'open' } });
    const plan = solvePush(extractPushPuzzle(scene)!);
    expect(plan.solvable).toBe(true);
    const game = new Game({ scene });
    const bot = new Bot(game);
    const r = bot.executePushes(plan.moves);
    expect(r.ok).toBe(true);
    bot.wait(1.5);
    expect(output(game.sim.world.all().find((e) => e.name === 'Plate')!, 'active')).toBe(true);
    expect(output(game.sim.world.all().find((e) => e.name === 'Gate')!, 'isOpen')).toBe(true);
  });

  it('holds two plates with an echo and the player, and the gate opens', () => {
    const fs = flatScene(20, 14);
    const hero = player('p', 3.5, 3.5);
    attachBehavior(hero.components, 'echoRecorder');
    Object.assign(hero.components.echoRecorder as object, { capacity: 1 });
    const scene = sceneOf(
      fs,
      hero,
      thing('p1', 'Plate 1', 12.5, 3.5, { pressurePlate: { activatedBy: 'anyone' } }),
      thing('p2', 'Plate 2', 3.5, 10.5, { pressurePlate: { activatedBy: 'anyone' } }),
      thing('and', 'AND', 16.5, 8.5, { logic: { kind: 'and' } }),
      thing('gate', 'Gate', 18.5, 8.5, { gate: {} }),
    );
    scene.wires.push(
      { id: 'w1', from: { entity: 'p1', output: 'active' }, to: { entity: 'and', input: 'a' } },
      { id: 'w2', from: { entity: 'p2', output: 'active' }, to: { entity: 'and', input: 'b' } },
      { id: 'w3', from: { entity: 'and', output: 'out' }, to: { entity: 'gate', input: 'open' } },
    );
    const game = new Game({ scene });
    const bot = new Bot(game);
    const r = holdPlatesWithEchoes(bot, ['id:p1', 'id:p2']);
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Held 2 plates \(1 with echoes\) in /);
    bot.wait(1.5);
    expect(game.sim.world.withTag('echo')).toHaveLength(1);
    expect(output(game.sim.world.all().find((e) => e.name === 'Gate')!, 'isOpen')).toBe(true);
  });
});

describe('playthroughs', () => {
  it('a recorded run replays to the same ending, and a broken level is reported', () => {
    const scene = sceneOf(flatScene(20, 12), player('p', 2.5, 2.5), goalAt(12.5, 6.5));
    const first = new Game({ scene });
    const bot = new Bot(first);
    expect(bot.walkToEntity('tag:goal').ok).toBe(true);
    const pt = newPlaythrough('Walk to the exit', 'scenes/main.scene.json', bot.recording(), 1, { near: 'tag:goal', within: 0.6 });
    expect(PlaythroughSchema.safeParse(JSON.parse(JSON.stringify(pt))).success).toBe(true);
    const replay = replayPlaythrough(new Game({ scene }), pt);
    expect(replay.ok).toBe(true);
    expect(replay.problems).toEqual([]);

    // the level changed: a wall now stands in the way, so the same buttons end somewhere else
    const fs = flatScene(20, 12);
    for (let x = 3; x < 12; x++) fs.map.setFlag(x, 2, FLAG.BLOCK);
    const broken = sceneOf(fs, player('p', 2.5, 2.5), goalAt(12.5, 6.5));
    const bad = replayPlaythrough(new Game({ scene: broken }), pt);
    expect(bad.ok).toBe(false);
    expect(bad.problems[0]).toMatch(/The player ended [\d.]+ cells from "Exit"/);
  });

  it('checks variables at the end', () => {
    const scene = sceneOf(flatScene(10, 10), player('p', 2.5, 2.5));
    const game = new Game({ scene });
    const pt = newPlaythrough('Nothing', '', new Bot(game).recording(), 1, { vars: { won: true } });
    const r = replayPlaythrough(new Game({ scene }), pt);
    expect(r.problems[0]).toBe('Expected won to be true at the end, but it is not set.');
  });
});

describe('solving a level', () => {
  function gated(latch: boolean): SceneData {
    const fs = flatScene(22, 10);
    for (let y = 0; y < 10; y++) fs.map.setFlag(12, y, FLAG.BLOCK);
    fs.map.setFlag(12, 5, FLAG.BLOCK, false);
    const scene = sceneOf(
      fs,
      player('p', 2.5, 5.5),
      thing('plate', 'Plate', 5.5, 2.5, { pressurePlate: { latch } }),
      thing('gate', 'Gate', 12.5, 5.5, { gate: {} }, { collider: { w: 1, d: 1, height: 1.6, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } }),
      goalAt(18.5, 5.5),
    );
    scene.wires.push({ id: 'w', from: { entity: 'plate', output: 'active' }, to: { entity: 'gate', input: 'open' } });
    return scene;
  }

  it('uses a switch and then walks through the door it opened', () => {
    const game = new Game({ scene: gated(true) });
    const r = new Bot(game).solveToGoal('tag:goal');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Reached "Exit" in [\d.]+s after using "Plate"\.$/);
  });

  it('reports honestly when the plate has to be held and the player cannot be in two places', () => {
    const game = new Game({ scene: gated(false) });
    const r = new Bot(game).solveToGoal('tag:goal');
    expect(r.ok).toBe(false);
    expect(r.message).toContain('Switches tried: "Plate".');
  });
});
describe('a game of several scenes', () => {
  function twoScenes(): { a: SceneData; b: SceneData } {
    const a = sceneOf(flatScene(16, 10), player('p', 2.5, 5.5), thing('door', 'Door', 12.5, 5.5, { portal: { scene: 'scenes/b.scene.json', spawn: 'Arrival' } }));
    const b = sceneOf(flatScene(16, 10), player('p', 1.5, 1.5), thing('arrival', 'Arrival', 3.5, 7.5, {}), goalAt(12.5, 7.5));
    return { a, b };
  }

  it('walks through a portal into the next scene, which is entered at the named place, keeping what was carried', () => {
    const { a, b } = twoScenes();
    const game = new Game({ scene: a, scenePath: 'scenes/a.scene.json', scenes: new Map([['scenes/a.scene.json', a], ['scenes/b.scene.json', b]]) });
    game.sim.runtime.vars['item:key'] = 1;
    const bot = new Bot(game);
    expect(bot.walkToEntity('name:Door').ok).toBe(true);
    bot.wait(0.3);
    expect(game.scenePath).toBe('scenes/b.scene.json');
    expect(game.sim.world.all().some((e) => e.name === 'Door')).toBe(false);
    expect(Math.hypot(game.position.x - 3.5, game.position.y - 7.5)).toBeLessThan(0.5);
    expect(game.sim.runtime.vars['item:key']).toBe(1);
    expect(bot.walkToEntity('tag:goal').ok).toBe(true);
    expect(game.problems).toEqual([]);
  });

  it('says so when a portal leads to a scene that does not exist', () => {
    const a = sceneOf(flatScene(16, 10), player('p', 2.5, 5.5), thing('door', 'Door', 6.5, 5.5, { portal: { scene: 'scenes/nowhere.scene.json', spawn: '' } }));
    const game = new Game({ scene: a, scenes: new Map([['scenes/a.scene.json', a]]) });
    const bot = new Bot(game);
    bot.walkToEntity('name:Door');
    bot.wait(0.3);
    expect(game.problems).toContain('The scene "scenes/nowhere.scene.json" does not exist.');
  });
});

describe('fighting', () => {
  function arena(enemyHp: number): Game {
    const hero = player('p', 3.5, 5.5);
    attachBehavior(hero.components, 'health');
    Object.assign(hero.components.health as object, { max: 20 });
    attachBehavior(hero.components, 'meleeAttack');
    Object.assign(hero.components.meleeAttack as object, { damage: 2, arc: 360 });
    const enemy = thing('e', 'Slime', 14.5, 5.5, { health: { max: enemyHp, onDeath: 'remove' } }, { collider: solid });
    enemy.tags = ['enemy'];
    return new Game({ scene: sceneOf(flatScene(20, 10), hero, enemy) });
  }

  it('walks up to something and defeats it with the quill', () => {
    const game = arena(4);
    const r = fight(new Bot(game), 'name:Slime');
    expect(r.ok).toBe(true);
    expect(r.message).toMatch(/^Defeated "Slime" in [\d.]+s\.$/);
    expect(game.find('name:Slime')).toBeUndefined();
  });

  it('says plainly when there is nothing to fight, or it takes too long', () => {
    expect(fight(new Bot(arena(4)), 'name:Dragon')).toMatchObject({ ok: false, kind: 'blocked', message: 'There is nothing matching "name:Dragon" to fight.' });
    const r = fight(new Bot(arena(400)), 'name:Slime', { maxSeconds: 3 });
    expect(r).toMatchObject({ ok: false, kind: 'timeout' });
  });
});

describe('bridges', () => {
  it('walks over a pit on a text block once it is underlined, and not before', () => {
    const fs = flatScene(20, 10);
    for (let y = 0; y < 10; y++) for (const x of [9, 10]) fs.map.setFlag(x, y, FLAG.PIT);
    const scene = sceneOf(fs, player('p', 2.5, 4.5), thing('t', 'Bridge', 10, 4.5, { textBlock: { format: 'plain' } }), goalAt(16.5, 4.5));
    const game = new Game({ scene });
    const bot = new Bot(game);
    expect(bot.walkToEntity('tag:goal').ok).toBe(false); // plain text: no way across
    scene.entities.find((e) => e.id === 't')!.components.textBlock = { ...(scene.entities.find((e) => e.id === 't')!.components.textBlock as object), format: 'underline' };
    const game2 = new Game({ scene });
    game2.step();
    game2.step();
    const r = new Bot(game2).walkToEntity('tag:goal');
    expect(r.ok).toBe(true);
    expect(game2.position.x).toBeGreaterThan(16);
  });
});
