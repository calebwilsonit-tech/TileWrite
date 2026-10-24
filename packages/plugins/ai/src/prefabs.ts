import { archerTree, enemyBody, thing, wandererTree, type PrefabDef } from '@tilewright/plugin-sdk';

/** What this plugin adds to the editor's Place tool. */
export const prefabs: PrefabDef[] = [
  {
      id: 'guard',
      label: 'Guard',
      group: 'Enemies',
      hint: 'Walks a route (Patrol path tool), sees you in a cone, hears footsteps, chases you around walls, then searches and goes home. Hurts on touch.',
      make: (x, y, h) =>
        thing('Guard', ['enemy'], { color: 0x9b2d30, w: 0.6, d: 0.6, height: 1.2 }, x, y, h, ['health', 'vision', 'chase', 'patrol', 'damageOnTouch'], enemyBody()),
    },
  {
      id: 'archer',
      label: 'Archer',
      group: 'Enemies',
      hint: 'Shoots at you from a distance (Ranged Attack) and keeps its distance with a Behaviour Tree: it backs away when you are close and follows when you are far. Edit its tree in the Inspector.',
      make: (x, y, h) => {
        const e = thing('Archer', ['enemy'], { color: 0xb5651d, w: 0.6, d: 0.6, height: 1.2 }, x, y, h, ['health', 'vision', 'rangedAttack', 'behaviorTree'], enemyBody());
        Object.assign(e.components.vision as object, { range: 11, angle: 200 });
        e.components.behaviorTree = archerTree();
        return e;
      },
    },
  {
      id: 'wanderer',
      label: 'Wanderer',
      group: 'Enemies',
      hint: 'Ambles about near where it stands and runs away when hurt, decided by a Behaviour Tree you can change in the Inspector. Harmless until you add Damage on Touch.',
      make: (x, y, h) => {
        const e = thing('Wanderer', ['enemy'], { color: 0x6b8e5a, w: 0.55, d: 0.55, height: 1 }, x, y, h, ['health', 'behaviorTree'], enemyBody());
        e.components.behaviorTree = wandererTree();
        return e;
      },
    },
  {
      id: 'boss',
      label: 'Boss',
      group: 'Enemies',
      hint: 'A tough guard with Boss Phases: faster and stronger as its health runs down. Mark its room with a Region set to "Bosses here only act while the player is inside".',
      make: (x, y, h) => {
        const e = thing('Boss', ['enemy', 'boss'], { color: 0x5b2a86, w: 1.2, d: 1.2, height: 2 }, x, y, h, ['health', 'vision', 'chase', 'damageOnTouch', 'bossPhases'], enemyBody(0.55));
        Object.assign(e.components.health as object, { max: 12, onDeath: 'stay', invulnerableSeconds: 0.5, fallDamage: 0 });
        (e.components.chase as { speed: number }).speed = 2.6;
        (e.components.vision as { range: number; angle: number }).range = 9;
        (e.components.vision as { range: number; angle: number }).angle = 200;
        (e.components.damageOnTouch as { range: number }).range = 0.9;
        return e;
      },
    },
];
