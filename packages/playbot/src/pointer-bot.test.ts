import { describe, expect, it } from 'vitest';
import { C, UiDocSchema, tileMapToRows, type SceneData, type TransformIso } from '@tilewright/runtime';
import { newAction, newCondition, newRow, setActivePacks } from '@tilewright/behaviors';
import { flatScene, thing } from '@tilewright/behaviors/src/testing';
import { Game } from './game';
import { PointerBot } from './pointer-bot';

setActivePacks(undefined);

const sceneOf = (fs: ReturnType<typeof flatScene>, ...entities: SceneData['entities']): SceneData => {
  fs.scene.map = tileMapToRows(fs.map);
  fs.scene.entities.push(...entities);
  return fs.scene;
};
const solid = { w: 0.7, d: 0.7, height: 1.2, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };
const unit = (id: string, x: number, y: number, team: string, extra: Record<string, unknown> = {}) =>
  thing(id, id, x, y, { turnTaker: { team, apMax: 4, initiative: team === 'blue' ? 9 : 1, attackRange: 1, attackDamage: 4, attackCost: 2, ...extra }, gridMover: { speed: 12 }, health: { max: 8, onDeath: 'stay' }, ...(team === 'red' ? { unitAi: {} } : {}) }, { collider: solid });
const at = (g: Game, id: string): { x: number; y: number } => {
  const t = g.sim.world.all().find((e) => e.name === id)!.require<TransformIso>(C.Transform);
  return { x: t.x, y: t.y };
};

describe('playing a battle with clicks', () => {
  it('walks up to the enemy, hits it until it falls, and wins', () => {
    const fs = flatScene(14, 14);
    const scene = sceneOf(fs, unit('Knight', 3.5, 3.5, 'blue'), unit('Orc', 9.5, 3.5, 'red'), thing('ctl', 'Controls', 0.5, 0.5, { gridCursor: { team: 'blue' } }));
    scene.events = [{ ...newRow('r1'), conditions: [newCondition('start')], actions: [newAction('startBattle')], once: true }];
    const game = new Game({ scene });
    const bot = new PointerBot(game);
    bot.wait(0.2);
    expect(bot.battle()).toMatchObject({ active: true, unit: 'Knight', team: 'blue' });
    const r = bot.playBattle({ team: 'blue', maxSeconds: 120 });
    expect(r.ok, r.message).toBe(true);
    expect(r.message).toMatch(/blue side won/);
    expect(r.turns).toBeGreaterThan(1);
    expect(bot.recording().length).toBeGreaterThan(60); // clicks and waiting, nothing else
  });

  it('a lost battle is reported, not a crash', () => {
    const fs = flatScene(10, 10);
    const scene = sceneOf(fs, unit('Knight', 2.5, 2.5, 'blue', { attackDamage: 1 }), unit('Ogre', 3.5, 2.5, 'red', { attackDamage: 9 }), thing('ctl', 'Controls', 0.5, 0.5, { gridCursor: { team: 'blue' } }));
    scene.events = [{ ...newRow('r1'), conditions: [newCondition('start')], actions: [newAction('startBattle')], once: true }];
    const bot = new PointerBot(new Game({ scene }));
    const r = bot.playBattle({ team: 'blue', maxSeconds: 120 });
    expect(r.ok).toBe(false);
    expect(r.message).toMatch(/red side won/);
  });
});

describe('playing a strategy game with a mouse', () => {
  it('drags a box over my units, right-clicks the ground, and they walk there', () => {
    const fs = flatScene(24, 24);
    const body = { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false, standingOn: null };
    const worker = (id: string, x: number, y: number) => thing(id, id, x, y, { commandable: { speed: 5 } }, { body });
    const game = new Game({ scene: sceneOf(fs, worker('A', 4.5, 4.5), worker('B', 5.5, 5.5), worker('C', 18.5, 18.5), thing('ctl', 'Controls', 0.5, 0.5, { rtsControl: {} })) });
    const bot = new PointerBot(game);
    bot.dragBox({ x: 3, y: 3 }, { x: 7, y: 7 });
    expect(game.sim.runtime.vars['rts.selected']).toBe(2);
    bot.rightClick({ x: 14, y: 6 });
    bot.wait(4);
    for (const id of ['A', 'B']) expect(Math.hypot(at(game, id).x - 14.5, at(game, id).y - 6.5)).toBeLessThan(2.5);
    expect(Math.hypot(at(game, 'C').x - 18.5, at(game, 'C').y - 18.5)).toBeLessThan(0.1); // not selected, did not move
  });
});

describe('pressing what is on the screen', () => {
  it('reads the words, presses a button, drags a slider', () => {
    const ui = UiDocSchema.parse({
      screens: [
        {
          id: 's1',
          name: 'Menu',
          opensOnStart: true,
          root: {
            id: 'root',
            name: 'Root',
            type: 'panel',
            layout: 'column',
            children: [
              { id: 'b1', name: 'Play', type: 'button', text: 'Play', on: { click: [{ ...newAction('setVariable'), params: { name: 'started', op: 'set', value: '1' } }] } },
              { id: 'sl', name: 'Music', type: 'slider', value: 'music', min: 0, max: '10', step: 1 },
              { id: 'l1', name: 'Hint', type: 'text', text: 'Volume is {music}' },
            ],
          },
        },
      ],
    });
    const game = new Game({ scene: sceneOf(flatScene(8, 8)), ui });
    const bot = new PointerBot(game);
    bot.wait(0.2);
    expect(bot.screenText()).toContain('Play');
    expect(bot.pressWidget('Play')).toBe(true);
    expect(game.sim.runtime.vars.started).toBe(1);
    expect(bot.slide('Music', 7)).toBe(true);
    bot.wait(0.1);
    expect(bot.screenText()).toContain('Volume is 7');
    expect(bot.pressWidget('Nothing here')).toBe(false);
  });
});
