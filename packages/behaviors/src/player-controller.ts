import {
  C,
  animationSystem,
  facingOfScreenDir,
  jumpBody,
  screenIntentToGrid,
  type Body,
  type Simulation,
  type SimContext,
  type TransformIso,
} from '@tilewright/runtime';

export const PLAYER_CONTROLLER = 'playerController';

/** Settings for the Player Controller behaviour (shown in the inspector). */
export interface PlayerController {
  /** Walking speed in cells per second. */
  speed: number;
  /** Speed multiplier while the run action is held. */
  runMultiplier: number;
  /** Upward speed of a jump in levels per second; 0 turns jumping off. */
  jumpSpeed: number;
}

export function makePlayerController(partial: Partial<PlayerController> = {}): PlayerController {
  return { speed: 4, runMultiplier: 1.6, jumpSpeed: 11, ...partial };
}

/** 8-direction movement from the move_* actions, plus run and jump. Replaced by the behaviour framework in M5. */
export function playerControllerSystem({ world, input }: SimContext): void {
  for (const e of world.query(C.Transform, C.Body, PLAYER_CONTROLLER)) {
    const cfg = e.require<PlayerController>(PLAYER_CONTROLLER);
    const b = e.require<Body>(C.Body);
    const t = e.require<TransformIso>(C.Transform);
    const v = input.vector('move_left', 'move_right', 'move_up', 'move_down');
    const g = screenIntentToGrid(v.x, v.y);
    const speed = cfg.speed * (input.down('run') ? cfg.runMultiplier : 1);
    b.vx = g.x * speed;
    b.vy = g.y * speed;
    if (v.x !== 0 || v.y !== 0) t.facing = facingOfScreenDir(v.x, v.y);
    if (cfg.jumpSpeed > 0 && input.pressed('jump')) jumpBody(b, cfg.jumpSpeed);
  }
}

/** Add the engine's standard systems in the right order: behaviours first, then physics. */
export function addStandardSystems(sim: Simulation, physics: (ctx: SimContext) => void): void {
  sim.addSystem('player-controller', playerControllerSystem);
  sim.addSystem('physics', physics);
  sim.addSystem('animation', animationSystem);
}
