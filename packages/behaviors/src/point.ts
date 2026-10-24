import { C, type SimContext, type TransformIso } from '@tilewright/runtime';
import { resolveRef } from './events/sheet';

/** A reference ("player", "id:e3", "tag:guard", "name:Keeper") or a point "x,y", as a place on the map. */
export function resolvePoint(ctx: SimContext, ref: string): { x: number; y: number } | undefined {
  const m = /^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/.exec(ref);
  if (m) return { x: Number(m[1]), y: Number(m[2]) };
  const e = resolveRef(ctx, ref)[0];
  const t = e?.get<TransformIso>(C.Transform);
  return t ? { x: t.x, y: t.y } : undefined;
}
