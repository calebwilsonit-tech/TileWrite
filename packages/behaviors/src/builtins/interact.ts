import { C, type Entity, type SimContext, type TransformIso } from '@tilewright/runtime';

/** True when the player just pressed interact and this is the nearest object of its kind within reach. */
export function interactedBy(ctx: SimContext, e: Entity, reach: number, behaviourId: string): boolean {
  if (!ctx.input.pressed('interact')) return false;
  let best: Entity | undefined;
  let bestD = Infinity;
  for (const p of ctx.world.withTag('player')) {
    const pt = p.get<TransformIso>(C.Transform);
    if (!pt) continue;
    for (const o of ctx.world.query(behaviourId, C.Transform)) {
      const ot = o.require<TransformIso>(C.Transform);
      const d = Math.hypot(pt.x - ot.x, pt.y - ot.y);
      if (d <= reach && (d < bestD || (d === bestD && best !== undefined && o.id < best.id))) {
        best = o;
        bestD = d;
      }
    }
  }
  return best === e;
}
