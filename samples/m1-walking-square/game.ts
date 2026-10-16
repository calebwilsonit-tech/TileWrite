import {
  C,
  DEFAULT_INPUT_MAP,
  DomInputSource,
  GameRunner,
  InputMap,
  IsoRenderer,
  Simulation,
  TileMap,
  gridToScreen,
  makeSprite,
  makeTransform,
  screenIntentToGrid,
  facingOfScreenDir,
  type TransformIso,
} from '@tilewright/runtime';

/** M1 sample: a square walking on a tiled floor with a few tall blocks to walk behind. */
export interface SampleHandle {
  runner: GameRunner;
  sim: Simulation;
  renderer: IsoRenderer;
  stop(): void;
}

export async function startWalkingSquare(parent: HTMLElement): Promise<SampleHandle> {
  const sim = new Simulation(1);

  const map = new TileMap(24, 24);
  for (let y = 0; y < 24; y++) {
    for (let x = 0; x < 24; x++) {
      const checker = (x + y) % 2 === 0;
      map.set(x, y, checker ? 1 : 3, 0);
    }
  }
  // a raised stone platform, some walls and a pond
  for (let y = 14; y < 18; y++) for (let x = 14; x < 18; x++) map.set(x, y, 2, 1);
  for (let x = 6; x < 12; x++) map.set(x, 8, 5, 3);
  for (let y = 5; y < 8; y++) map.set(12, y, 5, 2);
  for (let y = 16; y < 20; y++) for (let x = 4; x < 8; x++) map.set(x, y, 4, 0);

  const player = sim.world.spawn({
    name: 'player',
    tags: ['player'],
    components: {
      [C.Transform]: makeTransform(9.5, 10.5, 0),
      [C.Sprite]: makeSprite({ color: 0xe8553d, w: 0.6, d: 0.6, height: 1.4 }),
    },
  });
  // two props to walk around
  sim.world.spawn({
    name: 'crate',
    components: { [C.Transform]: makeTransform(11.5, 11.5, 0), [C.Sprite]: makeSprite({ color: 0xc9964a, w: 0.9, d: 0.9, height: 1 }) },
  });
  sim.world.spawn({
    name: 'pillar',
    components: { [C.Transform]: makeTransform(8.5, 10.5, 0), [C.Sprite]: makeSprite({ color: 0x8e7cc3, w: 0.7, d: 0.7, height: 2.6 }) },
  });

  const SPEED = 4; // cells per second
  sim.addSystem('player-walk', ({ world, input, dt }) => {
    for (const e of world.withTag('player')) {
      const t = e.require<TransformIso>(C.Transform);
      const v = input.vector('move_left', 'move_right', 'move_up', 'move_down');
      if (v.x === 0 && v.y === 0) continue;
      const g = screenIntentToGrid(v.x, v.y);
      const speed = SPEED * (input.down('run') ? 1.6 : 1);
      t.x = Math.min(23.7, Math.max(0.3, t.x + g.x * speed * dt));
      t.y = Math.min(23.7, Math.max(0.3, t.y + g.y * speed * dt));
      t.facing = facingOfScreenDir(v.x, v.y);
    }
  });

  const renderer = new IsoRenderer({ antialias: true });
  await renderer.init(parent);
  renderer.setTileMap(map);
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
    stop() {
      runner.stop();
      source.dispose();
      renderer.destroy();
    },
  };
}
