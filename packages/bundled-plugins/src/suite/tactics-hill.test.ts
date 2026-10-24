import { describe, expect, it } from 'vitest';
import { C, TileMap, tileMapToRows, type SceneData, type TransformIso } from '@tilewright/runtime';
import { newAction, newCondition, newRow, setActivePacks } from '@tilewright/behaviors';
import { thing } from '@tilewright/plugin-sdk/testing';
import { Game, PointerBot } from '@tilewright/playbot';
import { battle, playBattle } from '@tilewright/plugin-turns/playbot';
import '@tilewright/bundled-plugins/tooling';

setActivePacks(['combat', 'turns', 'controls']);

const solid = { w: 0.7, d: 0.7, height: 1.2, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] };
const unit = (id: string, name: string, x: number, y: number, team: 'blue' | 'red', opts: { range?: number; damage?: number; hp?: number } = {}) =>
  thing(id, name, x, y, {
    turnTaker: { team, apMax: 4, initiative: team === 'blue' ? 9 : 1, attackRange: opts.range ?? 1, attackDamage: opts.damage ?? 3, attackCost: 2 },
    gridMover: {},
    health: { max: opts.hp ?? 8, invulnerableSeconds: 0 },
    ...(team === 'red' ? { unitAi: {} } : {}),
  }, { collider: { ...solid }, tags: ['unit', team] });

/** The tactics starter with a second hill in the north east and a third enemy on it, as the sample is built in the editor. */
function battlefield(): SceneData {
  const map = new TileMap(14, 14);
  map.fill(1, 0);
  for (let y = 5; y <= 8; y++) for (let x = 6; x <= 9; x++) map.set(x, y, 2, 1);
  for (let y = 8; y <= 10; y++) for (let x = 10; x <= 12; x++) map.set(x, y, 2, 1);
  const scene: SceneData = {
    schemaVersion: 1,
    name: 'T',
    map: tileMapToRows(map),
    entities: [
      unit('e1', 'Knight', 3.5, 10.5, 'blue', { hp: 16 }),
      unit('e2', 'Archer', 2.5, 11.5, 'blue', { range: 4, damage: 2, hp: 10 }),
      unit('e3', 'Orc', 10.5, 3.5, 'red'),
      unit('e4', 'Orc', 11.5, 2.5, 'red'),
      unit('e5', 'Slinger', 11.5, 9.5, 'red', { range: 4, damage: 2, hp: 5 }),
      thing('e9', 'Controls', 0.5, 0.5, { gridCursor: { team: 'blue' } }),
    ],
    regions: [],
    wires: [],
    variables: [],
    events: [{ ...newRow('start-battle'), conditions: [newCondition('sceneStart')], actions: [newAction('startBattle')], once: true }],
    graphs: [],
  };
  const slinger = scene.entities[4]!.components.transform as TransformIso;
  slinger.h = 1;
  return scene;
}

describe('a battle with a second hill and a third enemy, under the block physics', () => {
  it('is won by the bot: no enemy gets stuck partway across a cell on its turn', () => {
    const game = new Game({ scene: battlefield(), compat: { fadeBySight: true, blockPhysics: true, pauseAction: false } });
    const bot = new PointerBot(game);
    bot.wait(0.3);
    expect(battle(bot)).toMatchObject({ active: true, team: 'blue' });
    const r = playBattle(bot, { team: 'blue', maxSeconds: 600 });
    const stuck = game.sim.world
      .all()
      .filter((e) => e.tags.has('red'))
      .map((e) => `${e.name} at ${JSON.stringify({ x: e.require<TransformIso>(C.Transform).x, y: e.require<TransformIso>(C.Transform).y })}`);
    expect(r.ok, `${r.message} ${stuck.join('; ')}`).toBe(true);
  });
});
