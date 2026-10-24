import type { Scenario, Step } from '../harness/trace';

const wait = (ticks: number): Step => ({ hold: {}, ticks });
const hold = (action: string, ticks: number): Step => ({ hold: { [action]: 1 }, ticks });
const both = (a: string, b: string, ticks: number): Step => ({ hold: { [a]: 1, [b]: 1 }, ticks });
const press = (action: string): Step => ({ hold: { [action]: 1 }, ticks: 2 });
const WATCH = ['gravityFlipped', 'gravityCountdown', 'demoWon'];

/** The owner's gravity puzzle "Upside Down": walk to a switch, press it, walk on the wall or the ceiling, let the timer run out. */
export const demo: Scenario[] = [
  {
    name: 'wall: press the wall switch, climb, walk along it, jump off, let it wear off',
    scene: 'scenes/main.scene.json',
    watch: WATCH,
    // the move buttons go along the screen's diagonals: right + down is straight along +x
    steps: [wait(30), both('move_right', 'move_down', 30), press('interact'), wait(40), hold('move_up', 45), hold('move_right', 60), press('jump'), wait(40), hold('move_left', 40), wait(960), hold('move_down', 30), wait(120)],
  },
  {
    name: 'ceiling: press the ceiling switch, walk under the platforms',
    scene: 'scenes/main.scene.json',
    watch: WATCH,
    // up + right is straight along -y
    // through the gap in the middle wall (x 3 to 7), then back west to the switch beside the platforms
    steps: [wait(30), both('move_right', 'move_down', 30), both('move_up', 'move_right', 62), both('move_left', 'move_up', 12), press('interact'), wait(40), hold('move_up', 45), hold('move_right', 60), hold('move_left', 30), press('jump'), wait(40), wait(960), hold('move_down', 30), wait(120)],
  },
];
