import type { GravityDir, StackBlock } from '@tilewright/runtime';
import { store } from '../app/store';
import type { CellData } from '../model/cells';
import { cellWithBlock, cellWithoutBlock } from '../tools/tools';
import { fail, requireEditing, undoTop, type Proposal } from './tool-core';

/**
 * Claude building with blocks and turning gravity. These are the same edits the Blocks tool makes by hand (and the same undo
 * steps), so a scene built this way is no different from one built with the mouse.
 */

const MAX_CELLS = 3000;

interface Box {
  x: number;
  y: number;
  z?: number;
  w?: number;
  d?: number;
  h?: number;
  tile?: number;
  shape?: 'cube' | 'stairs' | 'ramp';
  rot?: number;
  solid?: boolean;
}

const extraOf = (b: Box): Pick<StackBlock, 'shape' | 'rot' | 'solid'> => ({
  ...(b.shape && b.shape !== 'cube' ? { shape: b.shape } : {}),
  ...(b.rot ? { rot: b.rot as 0 | 1 | 2 | 3 } : {}),
  ...(b.solid === false ? { solid: false } : {}),
});

function placeBlocks(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const remove = input.remove === true;
  const boxes = input.boxes as Box[];
  let cells = 0;
  const byCell = new Map<string, { zs: number[]; box: Box }[]>();
  for (const [i, b] of boxes.entries()) {
    const w = b.w ?? 1;
    const d = b.d ?? 1;
    const h = b.h ?? 1;
    const z0 = b.z ?? 0;
    if (!remove && b.tile === undefined) fail(`Box ${i + 1} has no tile. Give a tile id from get_tiles.`);
    if (b.x + w > doc.map.width || b.y + d > doc.map.height) fail(`Box ${i + 1} reaches outside the map (${doc.map.width} x ${doc.map.height}). Keep x + w and y + d inside it.`);
    if (z0 + h > 255) fail(`Box ${i + 1} is too tall: blocks go up to level 254.`);
    cells += w * d * h;
    if (cells > MAX_CELLS) fail(`That is more than ${MAX_CELLS} blocks at once. Split it into several calls.`);
    const zs = Array.from({ length: h }, (_, k) => z0 + k);
    for (let y = b.y; y < b.y + d; y++) for (let x = b.x; x < b.x + w; x++) byCell.set(`${x},${y}`, [...(byCell.get(`${x},${y}`) ?? []), { zs, box: b }]);
  }
  const undoLabel = remove ? 'Claude: remove blocks' : 'Claude: place blocks';
  const lines = boxes.map((b, i) => {
    const n = (b.w ?? 1) * (b.d ?? 1) * (b.h ?? 1);
    return `${remove ? 'Remove' : 'Place'} ${n} block${n === 1 ? '' : 's'}${remove ? '' : ` of tile ${b.tile}${b.shape && b.shape !== 'cube' ? ` (${b.shape})` : ''}`} at (${b.x}, ${b.y}), level ${b.z ?? 0}${n > 1 ? `: ${b.w ?? 1} wide, ${b.d ?? 1} deep, ${b.h ?? 1} high` : ''}${boxes.length > 1 ? ` [box ${i + 1}]` : ''}`;
  });
  return {
    tool: 'place_blocks',
    title: `${remove ? 'Remove' : 'Place'} ${cells} block${cells === 1 ? '' : 's'}`,
    lines,
    async apply() {
      const edits = [...byCell.entries()].map(([key, list]) => {
        const [x, y] = key.split(',').map(Number) as [number, number];
        return {
          x,
          y,
          patch: (c: CellData) => {
            let cur = c;
            let out = {};
            for (const item of list) {
              for (const z of item.zs) {
                const next = remove ? cellWithoutBlock(cur, z) : cellWithBlock(cur, z, item.box.tile!, extraOf(item.box));
                if (!next) continue;
                cur = { ...cur, ...next };
                out = { ...out, ...next };
              }
            }
            return out;
          },
        };
      });
      const changed = doc.paint(undoLabel, edits);
      return `${remove ? 'Removed' : 'Placed'} blocks in ${edits.length} map cell${edits.length === 1 ? '' : 's'}; ${changed} cell${changed === 1 ? '' : 's'} actually changed.`;
    },
    undo: undoTop(doc, undoLabel),
  };
}

function setGravity(input: Record<string, unknown>): Proposal {
  const doc = requireEditing();
  const direction = input.direction as GravityDir | undefined;
  const editable = input.blocksEditable as boolean | undefined;
  const limit = input.editLimit as number | undefined;
  if (direction === undefined && editable === undefined && limit === undefined) fail('Say what to change: direction, blocksEditable or editLimit.');
  const lines: string[] = [];
  if (direction !== undefined) lines.push(`Gravity pulls ${direction === '-z' ? 'down (the usual)' : direction}.${direction !== '-z' ? ' This needs "Bodies collide with every block" in Project settings, Compatibility.' : ''}`);
  if (editable !== undefined) lines.push(editable ? 'The game may place and break blocks while it runs.' : 'The game may not change blocks while it runs.');
  if (limit !== undefined) lines.push(`One run of the game may make at most ${limit} block edits.`);
  const before = { gravity: doc.gravity, rules: { ...doc.blockRules } };
  return {
    tool: 'set_gravity',
    title: 'Change gravity and block editing',
    lines,
    async apply() {
      if (direction !== undefined) doc.setGravity(direction);
      if (editable !== undefined || limit !== undefined) doc.setBlockRules({ runtime: editable ?? doc.blockRules.runtime, limit: limit ?? doc.blockRules.limit });
      const flag = store.state.project?.project.compat?.blockPhysics;
      const warning = doc.gravity !== '-z' && !flag ? ' (Gravity in another direction only works with "Bodies collide with every block" switched on in Project settings, Compatibility: it is off in this project.)' : '';
      return `Gravity is ${doc.gravity}; blocks while playing: ${doc.blockRules.runtime ? `on, limit ${doc.blockRules.limit}` : 'off'}.${warning}`;
    },
    async undo() {
      if (store.doc !== doc) return false;
      doc.setGravity(before.gravity);
      doc.setBlockRules(before.rules);
      return true;
    },
  };
}

/** The tools that build with blocks and turn gravity. Null when the name is not one of them. */
export function prepareBlockAction(name: string, input: Record<string, unknown>): Proposal | null {
  if (name === 'place_blocks') return placeBlocks(input);
  if (name === 'set_gravity') return setGravity(input);
  return null;
}
