import {
  C,
  DEFAULT_INPUT_MAP,
  DomInputSource,
  FLAG,
  GameRunner,
  InputMap,
  IsoRenderer,
  LAYER,
  SLOPE,
  Simulation,
  TileMap,
  gridToScreen,
  facingOfScreenDir,
  jumpBody,
  makeBody,
  makeCollider,
  makeSprite,
  makeTransform,
  physicsSystem,
  screenIntentToGrid,
  teleportBody,
  type Body,
  type TransformIso,
} from '@tilewright/runtime';

export interface M2State {
  falls: number;
  bigLandings: number;
  lastLanding: number;
}

export interface M2Handle {
  runner: GameRunner;
  sim: Simulation;
  renderer: IsoRenderer;
  state: M2State;
  player: number;
  stop(): void;
}

export const M2_SPAWN = { x: 4.5, y: 12.5 };

/** Build the M2 room: river with a bridge, a raised platform with stairs, a pit field, a tall wall. */
export function buildM2Map(): TileMap {
  const map = new TileMap(26, 26);
  for (let y = 0; y < 26; y++) for (let x = 0; x < 26; x++) map.set(x, y, (x + y) % 2 === 0 ? 1 : 3, 0);

  // river (x 8..10) with a bridge at y = 12 and ramps up and down
  for (let y = 0; y < 26; y++) {
    for (let x = 8; x <= 10; x++) {
      map.set(x, y, 4, 0);
      map.setFlag(x, y, FLAG.WATER);
    }
  }
  for (let x = 8; x <= 10; x++) map.setDeck(x, 12, 1, 6);
  map.set(7, 12, 6, 0);
  map.setSlope(7, 12, SLOPE.E, 'ramp');
  map.set(11, 12, 6, 0);
  map.setSlope(11, 12, SLOPE.W, 'ramp');

  // raised stone platform (level 2) reached by two flights of stairs
  for (let y = 4; y <= 10; y++) for (let x = 15; x <= 21; x++) map.set(x, y, 2, 2);
  // (on the south face, so the stairs and their risers face the camera)
  map.set(18, 12, 2, 0);
  map.setSlope(18, 12, SLOPE.N, 'stairs');
  map.set(18, 11, 2, 1);
  map.setSlope(18, 11, SLOPE.N, 'stairs');

  // a second, smaller ledge on top of the platform (level 3) with a ramp
  for (let y = 5; y <= 7; y++) for (let x = 19; x <= 21; x++) map.set(x, y, 5, 3);
  map.set(18, 6, 2, 2);
  map.setSlope(18, 6, SLOPE.E, 'ramp');

  // pit field
  for (let y = 3; y <= 5; y++) {
    for (let x = 2; x <= 4; x++) {
      map.set(x, y, 1, 0);
      map.setFlag(x, y, FLAG.PIT);
    }
  }
  // a narrow path through it
  map.set(3, 4, 2, 0);

  // tall wall to walk behind (row y = 18, x = 13..20)
  for (let x = 13; x <= 20; x++) map.set(x, 18, 5, 3);
  return map;
}

export async function startMultilevelRoom(parent: HTMLElement): Promise<M2Handle> {
  const sim = new Simulation(2);
  const map = buildM2Map();
  sim.map = map;
  const state: M2State = { falls: 0, bigLandings: 0, lastLanding: 0 };

  const player = sim.world.spawn({
    name: 'player',
    tags: ['player'],
    components: {
      [C.Transform]: makeTransform(M2_SPAWN.x, M2_SPAWN.y, 0),
      [C.Sprite]: makeSprite({ color: 0xe8553d, w: 0.6, d: 0.6, height: 1.2 }),
      [C.Body]: makeBody({ radius: 0.3, height: 1.2, layer: LAYER.PLAYER }),
    },
  });
  sim.world.spawn({
    name: 'crate',
    components: {
      [C.Transform]: makeTransform(12.5, 14.5, 0),
      [C.Sprite]: makeSprite({ color: 0xc9964a, w: 0.9, d: 0.9, height: 1 }),
      [C.Collider]: makeCollider({ w: 0.9, d: 0.9, height: 1, layer: LAYER.PROP }),
    },
  });

  const SPEED = 4;
  const JUMP = 11;
  sim.addSystem('player-control', ({ world, input }) => {
    for (const e of world.withTag('player')) {
      const b = e.require<Body>(C.Body);
      const t = e.require<TransformIso>(C.Transform);
      const v = input.vector('move_left', 'move_right', 'move_up', 'move_down');
      const g = screenIntentToGrid(v.x, v.y);
      const speed = SPEED * (input.down('run') ? 1.6 : 1);
      b.vx = g.x * speed;
      b.vy = g.y * speed;
      if (v.x !== 0 || v.y !== 0) t.facing = facingOfScreenDir(v.x, v.y);
      if (input.pressed('jump')) jumpBody(b, JUMP);
    }
  });
  sim.addSystem('physics', physicsSystem);
  sim.addSystem('game-rules', ({ world, events }) => {
    for (const ev of events.of('fell')) {
      const e = world.get(ev.entity as number);
      if (!e) continue;
      state.falls++;
      teleportBody({ map } as never, e, M2_SPAWN.x, M2_SPAWN.y);
    }
    for (const ev of events.of('landed')) {
      state.lastLanding = ev.distance as number;
      if ((ev.distance as number) >= 2.5) state.bigLandings++;
    }
  });

  const renderer = new IsoRenderer({ antialias: true });
  await renderer.init(parent);
  renderer.setTileMap(map);
  renderer.focus = player.id;
  renderer.camera.deadzoneW = 60;
  renderer.camera.deadzoneH = 40;
  renderer.camera.smoothing = 0.2;
  const p0 = player.require<TransformIso>(C.Transform);
  renderer.camera.snapTo(gridToScreen(p0.x, p0.y, p0.h));

  const source = new DomInputSource();
  const runner = new GameRunner({
    sim,
    renderer,
    inputMap: new InputMap(DEFAULT_INPUT_MAP),
    readInput: () => source.read(),
    follow: player.id,
  });
  runner.start();

  return {
    runner,
    sim,
    renderer,
    state,
    player: player.id,
    stop() {
      runner.stop();
      source.dispose();
      renderer.destroy();
    },
  };
}
