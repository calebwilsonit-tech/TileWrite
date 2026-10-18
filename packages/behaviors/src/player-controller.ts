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
import { defineBehavior } from './framework';
import { eventSheetSystem } from './events/sheet';
import { graphSystem } from './events/graph';
import { eventNodeSystem } from './builtins/nodes';
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

/**
 * Direct control: 8-direction movement from the move buttons, run and jump. A behaviour like any other, so a game that is not
 * about walking around (a tactics game, a builder) simply never adds it.
 */
export const directControl = defineBehavior<PlayerController>({
  id: PLAYER_CONTROLLER,
  name: 'Direct Control',
  category: 'Control schemes',
  description: 'The player walks, runs and jumps with the move buttons (WASD or the arrows, Shift, Space). The classic action-game control. Without it nothing moves by itself: other control schemes (click to move, a grid cursor, an RTS selection) are other behaviours.',
  phase: 'control',
  // it runs as the first system of every tick (before any behaviour), so it only carries the settings here
  dataOnly: true,
  defaults: { speed: 4, runMultiplier: 1.6, jumpSpeed: 11 },
  fields: [
    { key: 'speed', label: 'Walking speed (cells per second)', type: 'number', min: 0.5, step: 0.5 },
    { key: 'runMultiplier', label: 'Run speed multiplier', type: 'number', min: 1, step: 0.1 },
    { key: 'jumpSpeed', label: 'Jump strength (0 = cannot jump)', type: 'number', min: 0, step: 1 },
  ],
  inputs: [],
  outputs: [],
  requires: {
    body: { vx: 0, vy: 0, vz: 0, radius: 0.3, height: 1.2, state: 'ground', stepUp: 0.35, stepDown: 0.4, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false },
  },
  update: () => undefined,
});

/** The direct control system: moves every object that has the Direct Control behaviour. */
export function playerControllerSystem({ world, input, runtime }: SimContext): void {
  if (runtime.clock.mode === 'turns') return; // by turns, units move when the turn system says so
  const view = runtime.view.rotation;
  for (const e of world.query(C.Transform, C.Body, PLAYER_CONTROLLER)) {
    driveBody(e.require<PlayerController>(PLAYER_CONTROLLER), e.require<Body>(C.Body), e.require<TransformIso>(C.Transform), input, view);
  }
}

/** Turn one tick of actions into movement; the player uses live input, echoes use their recording. */
export function driveBody(cfg: PlayerController, b: Body, t: TransformIso, input: InputState, view: 0 | 1 | 2 | 3 = 0): void {
  const v = input.vector('move_left', 'move_right', 'move_up', 'move_down');
  const g = screenIntentToGrid(v.x, v.y, view);
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
  sim.addSystem('logic-graphs', graphSystem, 'gameplay');
  sim.addSystem('event-nodes', eventNodeSystem, 'gameplay');
  sim.addSystem('physics', physics, 'gameplay');
  sim.addSystem('animation', animationSystem, 'gameplay');
}
