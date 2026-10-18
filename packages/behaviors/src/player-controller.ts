import {
  C,
  animationSystem,
  facingOfScreenDir,
  jumpBody,
  screenIntentToGrid,
  type InputState,
  type Body,
  type Simulation,
  type SimContext,
  type TransformIso,
} from '@tilewright/runtime';
import { eventSheetSystem } from './events/sheet';
import { cutsceneSystem, dialogueSystem, minigameSystem } from './story/director';
import { quickSlotSystem } from './story/inventory';
import { behaviorSystems } from './signals';
import { packSystems } from './packs';

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
export function playerControllerSystem({ world, input, runtime }: SimContext): void {
  if (runtime.clock.mode === 'turns') return; // by turns, units move when the turn system says so
  for (const e of world.query(C.Transform, C.Body, PLAYER_CONTROLLER)) {
    driveBody(e.require<PlayerController>(PLAYER_CONTROLLER), e.require<Body>(C.Body), e.require<TransformIso>(C.Transform), input);
  }
}

/** Turn one tick of actions into movement; the player uses live input, echoes use their recording. */
export function driveBody(cfg: PlayerController, b: Body, t: TransformIso, input: InputState): void {
  const v = input.vector('move_left', 'move_right', 'move_up', 'move_down');
  const g = screenIntentToGrid(v.x, v.y);
  const speed = cfg.speed * (input.down('run') ? cfg.runMultiplier : 1);
  b.vx = g.x * speed;
  b.vy = g.y * speed;
  if (v.x !== 0 || v.y !== 0) t.facing = facingOfScreenDir(v.x, v.y);
  if (cfg.jumpSpeed > 0 && input.pressed('jump')) jumpBody(b, cfg.jumpSpeed);
}

/** By turns, nothing coasts: bodies that were moving when the clock went to turn mode stop (only commanded moves happen). */
export function turnClockGuard({ world, runtime }: SimContext): void {
  if (runtime.clock.mode !== 'turns') return;
  for (const e of world.query(C.Body)) {
    const b = e.require<Body>(C.Body);
    b.vx = 0;
    b.vy = 0;
  }
}

/**
 * Add the engine's standard systems in the right order: the player controller, the behaviour phases
 * (control, sources, wires and logic, actuators), the event sheet, then physics and animation.
 */
export function addStandardSystems(sim: Simulation, physics: (ctx: SimContext) => void): void {
  // conversations and cutscenes listen to the real buttons and run even while the world is frozen
  sim.addSystem('dialogue', dialogueSystem, 'always');
  sim.addSystem('minigame', minigameSystem, 'always');
  sim.addSystem('cutscene', cutsceneSystem, 'always');
  sim.addSystem('clock-guard', turnClockGuard, 'gameplay');
  sim.addSystem('player-controller', playerControllerSystem, 'player');
  sim.addSystem('quick-slots', quickSlotSystem, 'player');
  for (const s of behaviorSystems()) sim.addSystem(s.name, s.fn, 'gameplay');
  for (const s of packSystems()) sim.addSystem(s.name, s.fn, s.mode);
  sim.addSystem('event-sheet', eventSheetSystem, 'gameplay');
  sim.addSystem('physics', physics, 'gameplay');
  sim.addSystem('animation', animationSystem, 'gameplay');
}
