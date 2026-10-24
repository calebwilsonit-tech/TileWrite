import type { EditorDoc } from '../model/doc';

/** What a step can look at to know whether it has been done. */
export interface TutorialContext {
  doc: EditorDoc | null;
  mode: 'edit' | 'play';
  /** The gate was seen open while playing. */
  sawGateOpen: boolean;
}

export interface TutorialStep {
  id: string;
  title: string;
  /** Plain English, a few short lines. */
  text: string;
  /** Things on screen to point at (their data-testid). */
  highlight?: string[];
  /** Steps with no `done` wait for the Next button. */
  done?(c: TutorialContext): boolean;
}

function countCells(doc: EditorDoc | null, pick: (x: number, y: number, doc: EditorDoc) => boolean): number {
  if (!doc) return 0;
  let n = 0;
  for (let y = 0; y < doc.map.height; y++) for (let x = 0; x < doc.map.width; x++) if (pick(x, y, doc)) n++;
  return n;
}

const has = (doc: EditorDoc | null, component: string): boolean => (doc?.entities.some((e) => e.components[component] !== undefined) ?? false);

/**
 * The first-run tutorial: build a small puzzle room (a crate, a pressure plate and a gate) in about ten minutes.
 * Each step ticks itself off when the project shows it was done.
 */
export const TUTORIAL_STEPS: TutorialStep[] = [
  {
    id: 'welcome',
    title: 'Welcome to Tilewright',
    text: 'In about ten minutes you will build a tiny puzzle room: a crate, a pressure plate and a gate that opens when the crate sits on the plate. There is no code anywhere. Each step below ticks itself off when you have done it. You can close this card at any time.',
  },
  {
    id: 'floor',
    title: 'Make a stone floor',
    text: 'The map is a grid of tiles. In the Tiles panel (bottom left) click the Stone tile, then in the Tools panel pick Rectangle and drag a rectangle on the map. It fills with stone.',
    highlight: ['tile-stone', 'tool-rect'],
    done: (c) => countCells(c.doc, (x, y, d) => d.map.getTile(x, y) === 2) >= 20,
  },
  {
    id: 'plate',
    title: 'Place a pressure plate',
    text: 'Pick the Place tool. In the choice that appears under the tools, pick "Pressure plate", then click a cell of your floor. A plate sends a signal while something stands on it.',
    highlight: ['tool-place', 'opt-prefab'],
    done: (c) => has(c.doc, 'pressurePlate'),
  },
  {
    id: 'crate',
    title: 'Place a crate',
    text: 'Choose "Crate" and click a cell a few steps from the plate. A crate is something the player can push, and it is heavy enough to hold a plate down.',
    highlight: ['tool-place', 'opt-prefab'],
    done: (c) => c.doc?.entities.some((e) => e.components.pushable !== undefined) ?? false,
  },
  {
    id: 'gate',
    title: 'Place a gate',
    text: 'With the Place tool still active choose "Gate" and click near the middle of the map, away from your plate and crate. A gate is a barrier that opens while its signal is on.',
    highlight: ['tool-place', 'opt-prefab'],
    done: (c) => has(c.doc, 'gate'),
  },
  {
    id: 'raise',
    title: 'Raise a wall',
    text: 'Worlds here have height. Now wall off the room so the gate matters: pick the Raise tool and drag a line down the map through the column the gate is in, but not over the gate itself. Drag from the top of the map to just above the gate, then from just below the gate to the bottom. Drag over each line twice so the wall is two levels high: the player can jump up one level, but not two.',
    highlight: ['tool-raise'],
    done: (c) => countCells(c.doc, (x, y, d) => d.map.getHeight(x, y) >= 2) >= 20,
  },
  {
    id: 'wire',
    title: 'Connect the plate to the gate',
    text: 'Pick the Wire tool, press on the plate and drag to the gate, then let go. A small window asks which signal goes where: the defaults are right, so press Connect. A line now joins them.',
    highlight: ['tool-wire'],
    done: (c) => {
      const doc = c.doc;
      if (!doc) return false;
      return doc.wires.some((w) => doc.getEntity(w.from.entity)?.components.pressurePlate !== undefined && doc.getEntity(w.to.entity)?.components.gate !== undefined);
    },
  },
  {
    id: 'play',
    title: 'Try it',
    text: 'Press Play (or F5). Walk with WASD or the arrow keys and push the crate onto the plate by walking into it. The gate slides open. When you have seen it, press Stop (or Esc).',
    highlight: ['btn-play'],
    done: (c) => c.sawGateOpen && c.mode === 'edit',
  },
  {
    id: 'save',
    title: 'Save your work',
    text: 'Press Ctrl+S (or the Save button). Your project is a normal folder of readable files, so it works with version control too. Tilewright also keeps an automatic backup in case it closes unexpectedly.',
    highlight: ['btn-save'],
    done: (c) => c.doc !== null && !c.doc.dirty,
  },
  {
    id: 'finish',
    title: 'You built a puzzle',
    text: 'That is the whole loop: build, wire, play, fix. Next ideas: add a second plate and a Logic gate so both are needed; put a Guard on a patrol route; write a conversation in the Story panel; ask Claude (the Claude tab) to review your room; or press Export to turn the game into a program you can share. The Problems panel explains anything that is wrong in plain English.',
  },
];
