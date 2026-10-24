import {
  TileMap,
  baseProject,
  boxLook,
  newAction,
  newCondition,
  newRow,
  sceneFrom,
  solidCollider,
  thingOf,
  type EntityData,
  type EventRow,
  type TemplateDef,
  unseen,
  walled,
  withPacks,
} from '@tilewright/plugin-sdk';

const startRow = (): EventRow => ({ ...newRow('start-battle'), conditions: [newCondition('sceneStart')], actions: [newAction('startBattle')], once: true });

/** A soldier of a team: turns, walking cell by cell, health. Enemies play their own turns. */
function soldier(id: string, name: string, x: number, y: number, team: 'blue' | 'red', opts: { range?: number; damage?: number } = {}): EntityData {
  return thingOf(id, name, x, y, ['unit', team], { turnTaker: { team, apMax: 4, initiative: team === 'blue' ? 9 : 1, attackRange: opts.range ?? 1, attackDamage: opts.damage ?? 3, attackCost: 2 }, gridMover: {}, health: { max: 8, invulnerableSeconds: 0 }, ...(team === 'red' ? { unitAi: {} } : {}) }, { sprite: boxLook(team === 'blue' ? 0x4f8cff : 0xe0566b), collider: { ...solidCollider } });
}

const tactics: TemplateDef = {
  id: 'tactics',
  name: 'Tactics (turns on a grid)',
  description: 'A small battlefield with a hill. Two blue soldiers and two red; click a soldier, click where to walk or who to hit. The battle starts when the game does.',
  build(name) {
    const packs = ['combat', 'turns', 'controls'];
    return withPacks(packs, () => {
      const map = new TileMap(14, 14);
      map.fill(1, 0);
      for (let y = 5; y <= 8; y++) for (let x = 6; x <= 9; x++) map.set(x, y, 2, 1);
      const cursor = thingOf('e9', 'Controls', 0.5, 0.5, [], { gridCursor: { team: 'blue' } }, { sprite: unseen });
      const scene = sceneFrom(map, [soldier('e1', 'Knight', 3.5, 10.5, 'blue'), soldier('e2', 'Archer', 2.5, 11.5, 'blue', { range: 4, damage: 2 }), soldier('e3', 'Orc', 10.5, 3.5, 'red'), soldier('e4', 'Orc', 11.5, 2.5, 'red'), cursor]);
      scene.events = [startRow()];
      return { project: baseProject(name, packs), scene };
    });
  },
};

const roguelike: TemplateDef = {
  id: 'roguelike',
  name: 'Roguelike (a dungeon, one step at a time)',
  description: 'A walled dungeon, a hero and two monsters that move when you do. Turns, health and items are switched on; use the Generate panel for a new dungeon each run.',
  build(name) {
    const packs = ['combat', 'inventory', 'turns', 'controls'];
    return withPacks(packs, () => {
      const map = walled(30, 20, 2, 5);
      const cursor = thingOf('e9', 'Controls', 0.5, 0.5, [], { gridCursor: { team: 'blue' } }, { sprite: unseen });
      const scene = sceneFrom(map, [soldier('e1', 'Hero', 3.5, 3.5, 'blue'), soldier('e3', 'Rat', 20.5, 10.5, 'red'), soldier('e4', 'Rat', 24.5, 5.5, 'red'), cursor]);
      scene.events = [startRow()];
      return { project: baseProject(name, packs), scene };
    });
  },
};

/** The starters this plugin adds to the New project list. */
export const templates: TemplateDef[] = [tactics, roguelike];
