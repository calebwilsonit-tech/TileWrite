import {
  baseProject,
  boxLook,
  crateEntity,
  playerEntity,
  sceneFrom,
  solidCollider,
  thingOf,
  type TemplateDef,
  walled,
  withPacks,
} from '@tilewright/plugin-sdk';

const actionAdventure: TemplateDef = {
  id: 'action-adventure',
  name: 'Action adventure (walk, fight, collect)',
  description: 'A walled field with a player who walks and jumps, a goblin who chases, a coin to pick up and a crate. Combat, items, story, enemies and lighting are switched on.',
  build(name) {
    const packs = ['combat', 'inventory', 'story', 'ai', 'lighting'];
    return withPacks(packs, () => {
      const map = walled(28, 22, 1, 5);
      const goblin = thingOf('e2', 'Goblin', 20.5, 12.5, ['enemy'], { health: { max: 4 }, chase: {}, damageOnTouch: {} }, { sprite: boxLook(0x58b368, 0.7, 1), body: playerEntity('x', 0, 0).components.body, collider: { ...solidCollider } });
      const coin = thingOf('e3', 'Coin', 8.5, 6.5, ['pickup'], { pickup: {} }, { sprite: boxLook(0xf2c94c, 0.4, 0.4) });
      return { project: baseProject(name, packs), scene: sceneFrom(map, [playerEntity('e1', 6.5, 12.5), goblin, coin, crateEntity('e4', 12.5, 14.5)]) };
    });
  },
};

/** The starters this plugin adds to the New project list. */
export const templates: TemplateDef[] = [actionAdventure];
