import {
  C,
  DEFAULT_TILESET,
  EMPTY_TILE,
  bodyBox,
  gravityFrame,
  type Aabb,
  type Body,
  type BlockShape,
  type SimContext,
  type StackBlock,
  type TransformIso,
} from '@tilewright/runtime';

/**
 * Putting blocks into the world and taking them out while the game runs (a builder, a digging game, a puzzle where the player
 * makes a bridge). This is opt-in: the scene must say the game may do it (Scene -> Blocks while playing), and says how many
 * edits one run may make. What was changed is saved with the game.
 */

export interface BlockEdit {
  x: number;
  y: number;
  z: number;
  /** Tile name or number. */
  tile: string | number;
  shape?: BlockShape;
  rot?: 0 | 1 | 2 | 3;
  solid?: boolean;
}

export interface BlockResult {
  ok: boolean;
  /** In plain English, when it did not work. */
  why: string;
}

const fail = (why: string): BlockResult => ({ ok: false, why });

/** A tile named by its name ("stone") or its number. 0 when there is no such tile. */
export function tileByName(ctx: SimContext, ref: string | number): number {
  const set = ctx.assets.tileset ?? DEFAULT_TILESET;
  if (typeof ref === 'number') return set[ref] ? ref : 0;
  const text = ref.trim();
  if (/^\d+$/.test(text)) return set[Number(text)] ? Number(text) : 0;
  for (const [id, def] of Object.entries(set)) if (def.name.toLowerCase() === text.toLowerCase()) return Number(id);
  return 0;
}

function allowed(ctx: SimContext): BlockResult | null {
  const rules = ctx.runtime.blockRules;
  if (!rules.enabled) return fail('This scene does not let the game place or break blocks. Turn on "Blocks while playing" in the scene settings.');
  if (ctx.runtime.blockEdits >= rules.limit) return fail(`The game has already made ${rules.limit} block edits, which is as many as this scene allows.`);
  return null;
}

const cellBox = (x: number, y: number, z: number): Aabb => ({ x0: x, x1: x + 1, y0: y, y1: y + 1, z0: z, z1: z + 1 });

/** Tell the game host that a map cell changed, so it can be drawn again. */
export function markDirty(ctx: SimContext, x: number, y: number): void {
  let list = ctx.runtime.scratch.get('dirtyCells') as { x: number; y: number }[] | undefined;
  if (!list) ctx.runtime.scratch.set('dirtyCells', (list = []));
  if (list.length < 20000) list.push({ x, y });
}

/** Is any body standing where a block would go? */
function bodyIn(ctx: SimContext, box: Aabb): boolean {
  for (const e of ctx.world.query(C.Transform, C.Body)) {
    const t = e.require<TransformIso>(C.Transform);
    const b = e.require<Body>(C.Body);
    const mine = b.turn?.box ?? bodyBox(gravityFrame(b.g ?? b.gdir ?? ctx.runtime.gravity), { x: t.x, y: t.y, h: t.h }, b.radius, b.height);
    if (mine.x0 < box.x1 - 1e-6 && mine.x1 > box.x0 + 1e-6 && mine.y0 < box.y1 - 1e-6 && mine.y1 > box.y0 + 1e-6 && mine.z0 < box.z1 - 1e-6 && mine.z1 > box.z0 + 1e-6) return true;
  }
  return false;
}

function remember(ctx: SimContext, x: number, y: number): void {
  const map = ctx.map!;
  ctx.runtime.editedCells.add(y * map.width + x);
  ctx.runtime.blockEdits++;
  markDirty(ctx, x, y);
}

/** What block is at a level of a cell (null when there is none). */
export function blockAtCell(ctx: SimContext, x: number, y: number, z: number): (StackBlock & { name: string }) | null {
  const map = ctx.map;
  if (!map) return null;
  const b = map.blockAt(x, y, z);
  if (!b) return null;
  return { ...b, name: (ctx.assets.tileset ?? DEFAULT_TILESET)[b.tile]?.name ?? `tile ${b.tile}` };
}

/** Put a block in the world. */
export function placeBlock(ctx: SimContext, edit: BlockEdit): BlockResult {
  const no = allowed(ctx);
  if (no) return no;
  const map = ctx.map;
  if (!map) return fail('This scene has no map.');
  const { x, y, z } = edit;
  if (!map.inBounds(x, y) || z < 0 || z > 254) return fail(`There is no place at ${x}, ${y}, level ${z}.`);
  const tile = tileByName(ctx, edit.tile);
  if (tile === EMPTY_TILE) return fail(`There is no tile called "${edit.tile}".`);
  if (map.blockAt(x, y, z)) return fail('There is already a block there.');
  if ((edit.solid ?? true) && bodyIn(ctx, cellBox(x, y, z))) return fail('Something is standing there.');
  const extra = { ...(edit.shape && edit.shape !== 'cube' ? { shape: edit.shape, rot: edit.rot ?? 0 } : {}), ...(edit.solid === false ? { solid: false } : {}) };
  if (!map.setBlock(x, y, z, tile, undefined, extra)) return fail('That cell cannot take blocks.');
  remember(ctx, x, y);
  ctx.events.emit('block-placed', { x, y, z, tile });
  return { ok: true, why: '' };
}

/** Take a block out of the world. */
export function breakBlock(ctx: SimContext, x: number, y: number, z: number): BlockResult {
  const no = allowed(ctx);
  if (no) return no;
  const map = ctx.map;
  if (!map) return fail('This scene has no map.');
  const had = map.blockAt(x, y, z);
  if (!had) return fail('There is no block there.');
  if (!map.removeBlock(x, y, z)) return fail('That block cannot be taken away.');
  remember(ctx, x, y);
  ctx.events.emit('block-broken', { x, y, z, tile: had.tile });
  return { ok: true, why: '' };
}
