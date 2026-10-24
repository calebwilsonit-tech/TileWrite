import { z } from 'zod';
import { stackColumn, stackSetBlock, stackRemoveBlock, cellToStack, type BlockFace, type CellStack, type EntityData, type StackBlock } from '@tilewright/runtime';
import type { CellData, CellPatch } from '../model/cells';
import type { EditorDoc } from '../model/doc';

/**
 * Block-level editing of whole regions: copy, cut, paste, fill, hollow out, replace, and saving a region (with the objects and
 * attachments inside it) as a reusable structure. The pure functions take and return cell data; the editor applies them as
 * one undo step.
 */

/** A box of cells and levels. Inclusive on both ends. */
export interface Region {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  z0: number;
  z1: number;
}

/** The name the copy on the clipboard goes by when it is chosen as the thing to place. */
export const CLIPBOARD = '(copy)';

export const normalise = (r: Region): Region => ({ x0: Math.min(r.x0, r.x1), x1: Math.max(r.x0, r.x1), y0: Math.min(r.y0, r.y1), y1: Math.max(r.y0, r.y1), z0: Math.min(r.z0, r.z1), z1: Math.max(r.z0, r.z1) });

export const regionSize = (r: Region): { w: number; d: number; h: number } => ({ w: r.x1 - r.x0 + 1, d: r.y1 - r.y0 + 1, h: r.z1 - r.z0 + 1 });

const FaceSchema = z.object({ top: z.number().optional(), n: z.number().optional(), e: z.number().optional(), s: z.number().optional(), w: z.number().optional() });

export const StructureSchema = z.object({
  schemaVersion: z.number().int().min(1).default(1),
  name: z.string().min(1),
  /** Size in cells across, deep and levels high. */
  w: z.number().int().min(1),
  d: z.number().int().min(1),
  h: z.number().int().min(1),
  blocks: z.array(z.object({ x: z.number().int(), y: z.number().int(), z: z.number().int(), tile: z.number().int().min(1), faces: FaceSchema.optional(), shape: z.enum(['cube', 'stairs', 'ramp']).optional(), rot: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(), solid: z.boolean().optional() })),
  /** Objects inside the region (attachments, lamps, doors), with positions relative to its corner. */
  entities: z.array(z.object({ name: z.string(), tags: z.array(z.string()).default([]), components: z.record(z.string(), z.unknown()) })).default([]),
  description: z.string().default(''),
});
export type Structure = z.infer<typeof StructureSchema>;
export type StructureBlock = Structure['blocks'][number];

const hasFaces = (f?: StackBlock['faces']): f is NonNullable<StackBlock['faces']> => !!f && Object.keys(f).length > 0;

/** The stack of a cell: its blocks (a column, stairs, a ramp and a deck are all blocks). */
function stackOf(c: CellData): CellStack | null {
  return c.stack ?? cellToStack(c);
}

/** Turn an edited stack back into a cell patch. */
function patchOf(stack: CellStack): CellPatch {
  const col = stackColumn(stack);
  return { stack, tile: col.tile, height: col.height, slope: 0, deck: 0, deckTile: 0 };
}

/** Change the blocks of one cell with `fn`; refuses cells that cannot be split into blocks. */
export function editCell(c: CellData, fn: (stack: CellStack) => CellStack): CellPatch | null {
  const base = stackOf(c);
  if (!base) return null;
  return patchOf(fn(base));
}

// ---------- capturing ----------

/** The blocks of a map inside a region, relative to the region's corner. `cellAt` reads a cell. */
export function captureBlocks(region: Region, cellAt: (x: number, y: number) => CellData | null): StructureBlock[] {
  const r = normalise(region);
  const out: StructureBlock[] = [];
  for (let y = r.y0; y <= r.y1; y++) {
    for (let x = r.x0; x <= r.x1; x++) {
      const c = cellAt(x, y);
      if (!c || c.tile === 0) continue;
      const stack = stackOf(c);
      if (!stack) continue;
      for (const b of stack.blocks) {
        if (b.z < r.z0 || b.z > r.z1) continue;
        out.push({ x: x - r.x0, y: y - r.y0, z: b.z - r.z0, tile: b.tile, ...(hasFaces(b.faces) ? { faces: { ...b.faces } } : {}), ...(b.shape && b.shape !== 'cube' ? { shape: b.shape, rot: b.rot ?? 0 } : {}), ...(b.solid === false ? { solid: false } : {}) });
      }
    }
  }
  return out;
}

// ---------- rotating ----------

/** A quarter turn clockwise (seen from above) of a face name. */
const TURN_FACE: Record<BlockFace, BlockFace> = { top: 'top', n: 'e', e: 's', s: 'w', w: 'n' };
const TURN_NORMAL: Record<string, string> = { '+x': '+y', '+y': '-x', '-x': '-y', '-y': '+x', top: 'top' };

/** Where a point of a (w x d) structure lands after `turns` quarter turns clockwise, and the new width and depth. */
export function rotatePoint(x: number, y: number, w: number, d: number, turns: number): { x: number; y: number; w: number; d: number } {
  let px = x;
  let py = y;
  let ww = w;
  let dd = d;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) {
    const nx = dd - 1 - py;
    const ny = px;
    px = nx;
    py = ny;
    [ww, dd] = [dd, ww];
  }
  return { x: px, y: py, w: ww, d: dd };
}

export function rotateFaces(faces: StackBlock['faces'], turns: number): StackBlock['faces'] {
  if (!faces) return undefined;
  let cur = faces;
  for (let i = 0; i < ((turns % 4) + 4) % 4; i++) {
    const next: Record<string, number> = {};
    for (const [k, v] of Object.entries(cur)) if (v !== undefined) next[TURN_FACE[k as BlockFace]] = v;
    cur = next as StackBlock['faces'] & object;
  }
  return cur;
}

export function rotateStructure(s: Structure, turns: number): Structure {
  const t = ((turns % 4) + 4) % 4;
  if (t === 0) return s;
  const size = rotatePoint(0, 0, s.w, s.d, t);
  return {
    ...s,
    w: size.w,
    d: size.d,
    blocks: s.blocks.map((b) => {
      const p = rotatePoint(b.x, b.y, s.w, s.d, t);
      return { ...b, x: p.x, y: p.y, ...(b.faces ? { faces: rotateFaces(b.faces, t) } : {}), ...(b.rot !== undefined ? { rot: ((b.rot + t) & 3) as 0 | 1 | 2 | 3 } : {}) };
    }),
    entities: s.entities.map((e) => {
      const tr = e.components.transform as { x: number; y: number } | undefined;
      const comps = structuredClone(e.components) as Record<string, unknown>;
      if (tr) {
        // positions are in cells with the centre of a cell at +0.5: turn the cell, keep the offset inside it
        let x = tr.x;
        let y = tr.y;
        let w = s.w;
        let d = s.d;
        for (let i = 0; i < t; i++) {
          const nx = d - y;
          const ny = x;
          x = nx;
          y = ny;
          [w, d] = [d, w];
        }
        comps.transform = { ...(comps.transform as object), x, y };
      }
      const at = comps.attach as { face?: string; cell?: { x: number; y: number }; along?: number } | undefined;
      if (at && at.face) {
        let face = at.face;
        let cell = at.cell ? { ...at.cell } : undefined;
        let along = at.along;
        let w = s.w;
        let d = s.d;
        for (let i = 0; i < t; i++) {
          const next = TURN_NORMAL[face] ?? face;
          // a quarter turn flips which end "along" counts from on east and west faces
          if (face === '+x' || face === '-x') along = 1 - (along ?? 0.5);
          if (cell) {
            const nx = d - 1 - cell.y;
            const ny = cell.x;
            cell = { x: nx, y: ny };
          }
          [w, d] = [d, w];
          face = next;
        }
        comps.attach = { ...at, face, ...(cell ? { cell } : {}), ...(along !== undefined ? { along } : {}) };
      }
      return { ...e, components: comps };
    }),
  };
}

// ---------- editing regions ----------

/** One cell to change; cells that cannot be split into blocks (stairs, ramps, decks) are left as they are. */
export type Edit = { x: number; y: number; patch: (c: CellData) => CellPatch };

/** Edits for every cell of a region, each cell changed once with all its blocks. */
function regionEdits(region: Region, fn: (stack: CellStack, x: number, y: number, r: Region) => CellStack): Edit[] {
  const r = normalise(region);
  const edits: Edit[] = [];
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) edits.push({ x, y, patch: (c) => editCell(c, (s) => fn(s, x, y, r)) ?? {} });
  return edits;
}

/** Fill every level of the region with blocks of a tile. */
export function fillEdits(region: Region, tile: number): Edit[] {
  return regionEdits(region, (stack, _x, _y, r) => {
    let s = stack;
    for (let z = r.z0; z <= r.z1; z++) s = stackSetBlock(s, z, tile);
    return s;
  });
}

/** Take out every block inside the region (the cells keep the floor and whatever is above or below). */
export function clearEdits(region: Region, groundTile: number): Edit[] {
  return regionEdits(region, (stack, _x, _y, r) => {
    let s = stack;
    for (let z = r.z0; z <= r.z1; z++) s = stackRemoveBlock(s, z, groundTile);
    return s;
  });
}

/** Empty the inside of the region and leave a shell one block thick (a room inside a solid cube). */
export function hollowEdits(region: Region, groundTile: number): Edit[] {
  return regionEdits(region, (stack, x, y, r) => {
    let s = stack;
    for (let z = r.z0 + 1; z <= r.z1 - 1; z++) {
      if (x > r.x0 && x < r.x1 && y > r.y0 && y < r.y1) s = stackRemoveBlock(s, z, groundTile);
    }
    return s;
  });
}

/** Change every block of one tile into another inside the region. */
export function replaceEdits(region: Region, from: number, to: number): Edit[] {
  return regionEdits(region, (stack, _x, _y, r) => {
    let s = stack;
    for (const b of stack.blocks) if (b.z >= r.z0 && b.z <= r.z1 && b.tile === from) s = stackSetBlock(s, b.z, to, b.faces);
    return s;
  });
}

/** Put a structure into the map with its corner at (x, y) and its bottom at level z. */
export function pasteEdits(s: Structure, at: { x: number; y: number; z: number }, inBounds: (x: number, y: number) => boolean): Edit[] {
  const byCell = new Map<string, StructureBlock[]>();
  for (const b of s.blocks) {
    const key = `${b.x},${b.y}`;
    byCell.set(key, [...(byCell.get(key) ?? []), b]);
  }
  const edits: Edit[] = [];
  for (const [key, blocks] of byCell) {
    const [bx, by] = key.split(',').map(Number) as [number, number];
    const x = at.x + bx;
    const y = at.y + by;
    if (!inBounds(x, y)) continue;
    edits.push({
      x,
      y,
      patch: (c) =>
        editCell(c, (stack) => {
          let st = stack;
          for (const b of blocks) st = stackSetBlock(st, at.z + b.z, b.tile, hasFaces(b.faces) ? (b.faces as StackBlock['faces']) : undefined, { ...(b.shape && b.shape !== 'cube' ? { shape: b.shape, rot: b.rot ?? 0 } : {}), ...(b.solid === false ? { solid: false } : {}) });
          return st;
        }) ?? {},
    });
  }
  return edits;
}

/** The objects whose position is inside a region (attachments, lamps, doors, props), as relative copies. */
export function captureEntities(region: Region, entities: readonly EntityData[]): Structure['entities'] {
  const r = normalise(region);
  const out: Structure['entities'] = [];
  for (const e of entities) {
    const t = e.components.transform as { x: number; y: number; h: number } | undefined;
    if (!t || e.tags.includes('player') || e.tags.includes('logic-node')) continue;
    if (t.x < r.x0 || t.x > r.x1 + 1 || t.y < r.y0 || t.y > r.y1 + 1 || t.h < r.z0 - 0.01 || t.h > r.z1 + 1.5) continue;
    const comps = structuredClone(e.components) as Record<string, unknown>;
    comps.transform = { ...t, x: t.x - r.x0, y: t.y - r.y0, h: t.h - r.z0 };
    const at = comps.attach as { cell?: { x: number; y: number }; z?: number } | undefined;
    if (at?.cell) comps.attach = { ...at, cell: { x: at.cell.x - r.x0, y: at.cell.y - r.y0 }, z: (at.z ?? 0) - r.z0 };
    out.push({ name: e.name, tags: [...e.tags], components: comps });
  }
  return out;
}

/** The structure a region of the map and its objects make. */
export function makeStructure(name: string, region: Region, doc: Pick<EditorDoc, 'entities'> & { map: { inBounds(x: number, y: number): boolean } }, cellAt: (x: number, y: number) => CellData | null, description = ''): Structure {
  const r = normalise(region);
  const size = regionSize(r);
  return { schemaVersion: 1, name, w: size.w, d: size.d, h: size.h, blocks: captureBlocks(r, cellAt), entities: captureEntities(r, doc.entities), description };
}

/** The objects of a structure placed with its corner at (x, y) and bottom at level z. */
export function placedEntities(s: Structure, at: { x: number; y: number; z: number }): Omit<EntityData, 'id'>[] {
  return s.entities.map((e) => {
    const comps = structuredClone(e.components) as Record<string, unknown>;
    const t = comps.transform as { x: number; y: number; h: number };
    comps.transform = { ...t, x: t.x + at.x, y: t.y + at.y, h: t.h + at.z };
    const a = comps.attach as { cell?: { x: number; y: number }; z?: number } | undefined;
    if (a?.cell) comps.attach = { ...a, cell: { x: a.cell.x + at.x, y: a.cell.y + at.y }, z: (a.z ?? 0) + at.z };
    return { name: e.name, tags: [...e.tags], components: comps };
  });
}

export function structureNameProblem(name: string, existing: readonly string[]): string | null {
  const n = name.trim();
  if (!n) return 'Give the structure a name.';
  if (!/^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(n)) return 'Use letters, numbers, spaces, - and _ in a structure name.';
  if (existing.some((e) => e.toLowerCase() === n.toLowerCase())) return `A structure called "${n}" already exists.`;
  return null;
}
