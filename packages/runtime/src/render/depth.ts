import { DEFAULT_ISO, type IsoConfig } from '../iso/math';

/**
 * A drawable's volume in grid space: x/y in cells, z in height levels.
 * Footprint is [minX,maxX] x [minY,maxY]; it rises from minZ to maxZ.
 */
export interface DepthBox {
  id: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
  /** Tie-break only: nudges an item in front of / behind others it has no hard ordering with. */
  sortOffset?: number;
}

/** 1 if `b` must be drawn after `a`, -1 if before, 0 if they impose no order. */
function relation(a: DepthBox, b: DepthBox): number {
  // Separation in the ground plane wins over height: a thing in front on the ground covers one behind,
  // however high the one behind floats.
  const bFrontX = b.minX >= a.maxX;
  const bFrontY = b.minY >= a.maxY;
  const aFrontX = a.minX >= b.maxX;
  const aFrontY = a.minY >= b.maxY;
  if ((bFrontX || bFrontY) && !(aFrontX || aFrontY)) return 1;
  if ((aFrontX || aFrontY) && !(bFrontX || bFrontY)) return -1;
  if (bFrontX || bFrontY) return 0; // side by side: they cannot overlap on screen
  // footprints overlap in the plane -> the higher one is in front
  if (b.minZ >= a.maxZ) return 1;
  if (a.minZ >= b.maxZ) return -1;
  return 0; // interpenetrating; the tie-break key decides
}

function tieKey(b: DepthBox): number {
  return (b.minX + b.maxX + b.minY + b.maxY) / 2 + (b.minZ + b.maxZ) * 0.001 + (b.sortOffset ?? 0);
}

interface Node {
  box: DepthBox;
  key: number;
  index: number;
  left: number;
  right: number;
  top: number;
  bottom: number;
  after: number[];
  waiting: number;
}

/** Binary min-heap over nodes, ordered by (key, id) so results never depend on input order. */
class NodeHeap {
  private a: Node[] = [];
  get size(): number {
    return this.a.length;
  }
  private less(x: Node, y: Node): boolean {
    return x.key < y.key || (x.key === y.key && x.box.id < y.box.id);
  }
  push(n: Node): void {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i]!, a[p]!)) break;
      [a[i], a[p]] = [a[p]!, a[i]!];
      i = p;
    }
  }
  pop(): Node {
    const a = this.a;
    const top = a[0]!;
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l]!, a[m]!)) m = l;
        if (r < a.length && this.less(a[r]!, a[m]!)) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m]!, a[i]!];
        i = m;
      }
    }
    return top;
  }
}

/**
 * Back-to-front draw order for boxes, correct for tall and multi-cell objects at any height.
 * Pairs that overlap on screen are ordered by `relation`; the rest fall back to a stable key.
 * If the constraints ever form a cycle (interpenetrating geometry), the cycle is broken by key order.
 * Returns the ids in the order they should be drawn.
 */
export function sortBoxes(boxes: readonly DepthBox[], cfg: IsoConfig = DEFAULT_ISO): number[] {
  const hw = cfg.tileW / 2;
  const hh = cfg.tileH / 2;
  const nodes: Node[] = boxes.map((box, index) => ({
    box,
    key: tieKey(box),
    index,
    left: (box.minX - box.maxY) * hw,
    right: (box.maxX - box.minY) * hw,
    top: (box.minX + box.minY) * hh - box.maxZ * cfg.heightPx,
    bottom: (box.maxX + box.maxY) * hh - box.minZ * cfg.heightPx,
    after: [],
    waiting: 0,
  }));

  // Sweep along screen X to find overlapping pairs without testing every pair.
  const byLeft = [...nodes].sort((p, q) => p.left - q.left);
  let active: Node[] = [];
  for (const n of byLeft) {
    active = active.filter((o) => o.right > n.left);
    for (const o of active) {
      if (o.bottom <= n.top || n.bottom <= o.top) continue; // no vertical overlap
      const r = relation(o.box, n.box);
      if (r === 1) {
        o.after.push(n.index);
        n.waiting++;
      } else if (r === -1) {
        n.after.push(o.index);
        o.waiting++;
      }
    }
    active.push(n);
  }

  const ready = new NodeHeap();
  const pendingByKey: Node[] = [];
  for (const n of nodes) {
    if (n.waiting === 0) ready.push(n);
    else pendingByKey.push(n);
  }
  pendingByKey.sort((p, q) => p.key - q.key || p.box.id - q.box.id);

  const done = new Uint8Array(nodes.length);
  const out: number[] = [];
  let cursor = 0;
  while (out.length < nodes.length) {
    let n: Node;
    if (ready.size > 0) {
      n = ready.pop();
    } else {
      // cycle: release the lowest-key node that is still waiting
      while (done[pendingByKey[cursor]!.index]) cursor++;
      n = pendingByKey[cursor]!;
    }
    if (done[n.index]) continue;
    done[n.index] = 1;
    out.push(n.box.id);
    for (const ai of n.after) {
      const m = nodes[ai]!;
      if (!done[m.index] && --m.waiting === 0) ready.push(m);
    }
  }
  return out;
}

/** Simple box for a thing standing at (x, y, h) with a centred footprint. */
export function boxAt(id: number, x: number, y: number, h: number, w: number, d: number, height: number, sortOffset = 0): DepthBox {
  return { id, minX: x - w / 2, maxX: x + w / 2, minY: y - d / 2, maxY: y + d / 2, minZ: h, maxZ: h + height, sortOffset };
}
