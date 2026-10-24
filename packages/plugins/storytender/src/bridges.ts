import type { BridgeSourceDef, Collider, Entity, TransformIso } from '@tilewright/plugin-sdk';
import { C } from '@tilewright/plugin-sdk';

/**
 * Cells a text block can turn into a bridge over a pit or water: its footprint, if it starts underlined, or the player can
 * format it, or a wire underlines it. (Which of these happens, and when, is the puzzle; checks only need to know the way
 * can be opened.)
 */
export function textBridgeCells(entities: readonly { id: string; components: Record<string, unknown> }[], wires: readonly { to: { entity: string; input: string } }[]): Set<string> {
  const wired = new Set(wires.filter((w) => w.to.input === 'underline').map((w) => w.to.entity));
  const out = new Set<string>();
  for (const e of entities) {
    const tb = e.components.textBlock as { format?: string; playerCanFormat?: boolean } | undefined;
    const t = e.components.transform as { x: number; y: number } | undefined;
    if (!tb || !t) continue;
    if (tb.format !== 'underline' && tb.playerCanFormat === false && !wired.has(e.id)) continue;
    const c = (e.components.collider as { w?: number; d?: number } | undefined) ?? {};
    const w = c.w ?? 2;
    const d = c.d ?? 1;
    for (let x = Math.floor(t.x - w / 2 + 0.05); x <= Math.floor(t.x + w / 2 - 0.05); x++) for (let y = Math.floor(t.y - d / 2 + 0.05); y <= Math.floor(t.y + d / 2 - 0.05); y++) out.add(`${x},${y}`);
  }
  return out;
}

/** The footprint of an object, as the cells it covers. */
function footprint(t: { x: number; y: number }, w: number, d: number): string[] {
  const out: string[] = [];
  for (let x = Math.floor(t.x - w / 2 + 0.05); x <= Math.floor(t.x + w / 2 - 0.05); x++) for (let y = Math.floor(t.y - d / 2 + 0.05); y <= Math.floor(t.y + d / 2 - 0.05); y++) out.push(`${x},${y}`);
  return out;
}

/** Text blocks: a bridge over a pit or water once underlined. */
export const textBridges: BridgeSourceDef = {
  id: 'text-blocks',
  possible: textBridgeCells,
  live(world) {
    const out = new Set<string>();
    for (const o of world.query('textBlock', C.Transform) as Iterable<Entity>) {
      if (!(o.get<{ underline?: boolean }>('label')?.underline ?? false)) continue;
      const t = o.require<TransformIso>(C.Transform);
      const c = o.get<Collider>(C.Collider);
      for (const cell of footprint(t, c?.w ?? 2, c?.d ?? 1)) out.add(cell);
    }
    return out;
  },
  movable: (e) => e.components.textBlock !== undefined,
};
