import { Container, Graphics, Text } from 'pixi.js';
import { drawCone, drawFootprint, drawLightRadius, drawPath, drawWire, type ConeShape, type FootprintShape, type LightShape, type PathShape, type WireShape } from './debug-draw';
import { DEFAULT_ISO, gridToScreen, shapeBoxes, type IsoConfig, type RegionData, type TileMap } from '@tilewright/runtime';
import { collisionKind, type CollisionKind, type P } from '../tools/algorithms';
import type { Preview } from '../tools/tools';
import { PALETTE } from './palette';

/** The collision colours currently in use (see palette.ts: there is a colour-blind-safe set). */
export const COLLISION_COLORS: Record<CollisionKind, number> = PALETTE;

export interface OverlayInput {
  map: TileMap;
  iso: IsoConfig;
  grid: boolean;
  collision: boolean;
  /** Show the collision as a walker at this level would meet it (null = at the floor of each cell). */
  collisionLevel: number | null;
  heightLabels: boolean;
  regions: { list: RegionData[]; visible: boolean; selected: string | null };
  walk: Set<string> | null;
  /** Wires between objects, as points in grid space; hot ones belong to the selected object. */
  wires: WireShape[];
  /** Patrol routes (grid space); the selected object's is bright. */
  paths: PathShape[];
  /** What guards can see and hear. */
  cones: ConeShape[];
  /** Where objects take up room (trigger areas and solid things). */
  footprints: FootprintShape[];
  /** How far lights reach. */
  lights: LightShape[];
  previews: Preview[];
  zoom: number;
  /** World-space bounds currently visible, to avoid drawing labels off screen. */
  visible: { minX: number; minY: number; maxX: number; maxY: number };
}

export function cellTopHeight(map: TileMap, x: number, y: number): number {
  return Math.max(map.topHeight(x, y), map.getDeck(x, y));
}

/**
 * Editor gizmos drawn inside the world (grid, collision colours, brush previews, regions).
 * Rebuilt on demand, never every frame.
 */
export class OverlayDrawer {
  private readonly g = new Graphics();
  private readonly labelLayer = new Container();
  private labels: Text[] = [];

  constructor(private readonly root: Container) {
    root.addChild(this.g);
    root.addChild(this.labelLayer);
  }

  private diamond(g: Graphics, x: number, y: number, h: number, iso: IsoConfig): void {
    const n = gridToScreen(x, y, h, iso);
    const e = gridToScreen(x + 1, y, h, iso);
    const s = gridToScreen(x + 1, y + 1, h, iso);
    const w = gridToScreen(x, y + 1, h, iso);
    g.poly([n.x, n.y, e.x, e.y, s.x, s.y, w.x, w.y]);
  }

  draw(o: OverlayInput): void {
    const g = this.g;
    g.clear();
    const { map, iso } = o;

    if (o.collision) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          const kind = collisionKind(map, x, y, o.collisionLevel);
          if (kind === 'void') continue;
          this.diamond(g, x, y, cellTopHeight(map, x, y), iso);
          g.fill({ color: COLLISION_COLORS[kind], alpha: kind === 'walkable' ? 0.22 : 0.5 });
        }
      }
    }

    if (o.walk) {
      for (const key of o.walk) {
        const [xs, ys] = key.split(',');
        const x = Number(xs);
        const y = Number(ys);
        this.diamond(g, x, y, cellTopHeight(map, x, y), iso);
        g.fill({ color: PALETTE.reach, alpha: 0.55 });
      }
    }

    if (o.grid) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.getTile(x, y) === 0) continue;
          this.diamond(g, x, y, cellTopHeight(map, x, y), iso);
          g.stroke({ width: 1, color: 0xffffff, alpha: 0.1 });
        }
      }
    }

    if (o.regions.visible) {
      for (const r of o.regions.list) {
        const sel = r.id === o.regions.selected;
        const corners = [gridToScreen(r.x, r.y, 0, iso), gridToScreen(r.x + r.w, r.y, 0, iso), gridToScreen(r.x + r.w, r.y + r.h, 0, iso), gridToScreen(r.x, r.y + r.h, 0, iso)];
        g.poly(corners.flatMap((c) => [c.x, c.y]));
        g.fill({ color: 0xb18cff, alpha: sel ? 0.18 : 0.08 });
        g.poly(corners.flatMap((c) => [c.x, c.y]));
        g.stroke({ width: sel ? 3 : 2, color: sel ? 0xd9c6ff : 0xb18cff, alpha: 0.9 });
      }
    }

    for (const f of o.footprints) drawFootprint(g, f, iso);
    for (const l of o.lights) drawLightRadius(g, l, iso);
    for (const c of o.cones) drawCone(g, c, iso);
    for (const pa of o.paths) drawPath(g, pa, iso);
    for (const w of o.wires) drawWire(g, w, iso);
    for (const pv of o.previews) {
      if (pv.kind === 'wire') {
        this.wireLine(g, pv.from, { ...pv.to, h: pv.from.h }, 0xffffff, 2, iso);
      } else if (pv.kind === 'cells') {
        for (const c of pv.cells) {
          if (!map.inBounds(c.x, c.y)) continue;
          this.diamond(g, c.x, c.y, cellTopHeight(map, c.x, c.y), iso);
          g.fill({ color: pv.color, alpha: pv.alpha ?? 0.35 });
          this.diamond(g, c.x, c.y, cellTopHeight(map, c.x, c.y), iso);
          g.stroke({ width: 1.5, color: pv.color, alpha: 0.9 });
        }
      }
    }

    this.drawLabels(o);
  }

  /** A line with an arrowhead from one object to another (both in grid space). */
  private wireLine(g: Graphics, a: { x: number; y: number; h: number }, b: { x: number; y: number; h: number }, color: number, width: number, iso: IsoConfig): void {
    const pa = gridToScreen(a.x, a.y, a.h, iso);
    const pb = gridToScreen(b.x, b.y, b.h, iso);
    g.moveTo(pa.x, pa.y).lineTo(pb.x, pb.y).stroke({ width, color, alpha: 0.95 });
    g.circle(pa.x, pa.y, width + 1).fill({ color, alpha: 0.95 });
    const angle = Math.atan2(pb.y - pa.y, pb.x - pa.x);
    const head = 10;
    g.poly([pb.x, pb.y, pb.x - head * Math.cos(angle - 0.45), pb.y - head * Math.sin(angle - 0.45), pb.x - head * Math.cos(angle + 0.45), pb.y - head * Math.sin(angle + 0.45)]).fill({ color, alpha: 0.95 });
  }
  /** Per-cell height numbers and region names, only for what is on screen. */
  private drawLabels(o: OverlayInput): void {
    const wanted: { text: string; x: number; y: number; color: number }[] = [];
    const { map, iso } = o;
    if (o.heightLabels && o.zoom >= 0.7) {
      for (let y = 0; y < map.height; y++) {
        for (let x = 0; x < map.width; x++) {
          if (map.getTile(x, y) === 0) continue;
          const h = cellTopHeight(map, x, y);
          const p = gridToScreen(x + 0.5, y + 0.5, h, iso);
          if (p.x < o.visible.minX || p.x > o.visible.maxX || p.y < o.visible.minY || p.y > o.visible.maxY) continue;
          const base = map.getHeight(x, y);
          wanted.push({ text: map.getSlope(x, y) ? `${base}↗` : String(base), x: p.x, y: p.y, color: 0xffffff });
        }
      }
    }
    if (o.regions.visible) {
      for (const r of o.regions.list) {
        const p = gridToScreen(r.x + r.w / 2, r.y + r.h / 2, 0, iso);
        wanted.push({ text: r.name, x: p.x, y: p.y, color: 0xd9c6ff });
      }
    }
    while (this.labels.length < wanted.length) {
      const t = new Text({ text: '', style: { fontSize: 12, fill: 0xffffff, fontFamily: 'system-ui, sans-serif', stroke: { color: 0x000000, width: 3 } } });
      t.anchor.set(0.5);
      this.labelLayer.addChild(t);
      this.labels.push(t);
    }
    this.labels.forEach((t, i) => {
      const w = wanted[i];
      t.visible = w !== undefined;
      if (!w) return;
      t.text = w.text;
      t.style.fill = w.color;
      t.position.set(w.x, w.y);
    });
  }

  /** Outline one block (the cube of cell (x, y) between levels z and z + 1). */
  cube(g: Graphics, x: number, y: number, z: number, color: number, iso: IsoConfig = DEFAULT_ISO): void {
    const P = (dx: number, dy: number, dz: number): [number, number] => {
      const p = gridToScreen(x + dx, y + dy, z + dz, iso);
      return [p.x, p.y];
    };
    const edges: [[number, number, number], [number, number, number]][] = [];
    for (const dz of [0, 1]) {
      edges.push([[0, 0, dz], [1, 0, dz]], [[1, 0, dz], [1, 1, dz]], [[1, 1, dz], [0, 1, dz]], [[0, 1, dz], [0, 0, dz]]);
    }
    for (const [dx, dy] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) edges.push([[dx, dy, 0], [dx, dy, 1]]);
    for (const [a, b] of edges) {
      const pa = P(...a);
      const pb = P(...b);
      g.moveTo(pa[0], pa[1]).lineTo(pb[0], pb[1]);
    }
    g.stroke({ width: 2, color, alpha: 0.95 });
  }

  /** Light one face of a block (the way a Minecraft cursor does). */
  face(g: Graphics, x: number, y: number, z: number, face: 'top' | 'n' | 'e' | 's' | 'w', color: number, iso: IsoConfig = DEFAULT_ISO): void {
    const P = (dx: number, dy: number, dz: number): number[] => {
      const p = gridToScreen(x + dx, y + dy, z + dz, iso);
      return [p.x, p.y];
    };
    const corners: Record<string, [number, number, number][]> = {
      top: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]],
      n: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]],
      s: [[0, 1, 0], [1, 1, 0], [1, 1, 1], [0, 1, 1]],
      w: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]],
      e: [[1, 0, 0], [1, 1, 0], [1, 1, 1], [1, 0, 1]],
    };
    const poly = corners[face]!.flatMap(([a, b, c]) => P(a, b, c));
    g.poly(poly).fill({ color, alpha: 0.35 }).stroke({ width: 2, color, alpha: 0.95 });
  }

  /** A block-shaped ghost: where a block would be put (see-through, with its edges). A stair or a ramp is drawn as the steps it really is. */
  solid(g: Graphics, x: number, y: number, z: number, color: number, alpha: number, iso: IsoConfig = DEFAULT_ISO, shape: 'cube' | 'stairs' | 'ramp' = 'cube', rot = 0): void {
    const P = (dx: number, dy: number, dz: number): number[] => {
      const p = gridToScreen(x + dx, y + dy, z + dz, iso);
      return [p.x, p.y];
    };
    // each piece of the shape (the physics sees the same boxes), lowest first; of each the three faces that look toward the camera
    const pieces = [...shapeBoxes(shape, rot)].sort((a, b) => a[5] - b[5]);
    for (const [x0, x1, y0, y1, z0, z1] of pieces) {
      for (const [corners, shade] of [
        [[[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], 1],
        [[[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], 0.75],
        [[[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], 0.6],
      ] as [[number, number, number][], number][]) {
        g.poly(corners.flatMap(([a, b, c]) => P(a, b, c))).fill({ color, alpha: alpha * shade }).stroke({ width: 1, color, alpha: 0.7 });
      }
    }
  }

  /** Outline a box of blocks: the region of cells and levels (both ends included). */
  box(g: Graphics, r: { x0: number; y0: number; x1: number; y1: number; z0: number; z1: number }, color: number, iso: IsoConfig = DEFAULT_ISO): void {
    const P = (x: number, y: number, z: number): [number, number] => {
      const p = gridToScreen(x, y, z, iso);
      return [p.x, p.y];
    };
    const xs = [r.x0, r.x1 + 1];
    const ys = [r.y0, r.y1 + 1];
    const zs = [r.z0, r.z1 + 1];
    const edge = (a: [number, number, number], b: [number, number, number]): void => {
      const pa = P(...a);
      const pb = P(...b);
      g.moveTo(pa[0], pa[1]).lineTo(pb[0], pb[1]);
    };
    for (const z of zs) {
      edge([xs[0]!, ys[0]!, z], [xs[1]!, ys[0]!, z]);
      edge([xs[1]!, ys[0]!, z], [xs[1]!, ys[1]!, z]);
      edge([xs[1]!, ys[1]!, z], [xs[0]!, ys[1]!, z]);
      edge([xs[0]!, ys[1]!, z], [xs[0]!, ys[0]!, z]);
    }
    for (const x of xs) for (const y of ys) edge([x, y, zs[0]!], [x, y, zs[1]!]);
    g.stroke({ width: 2, color, alpha: 0.95 });
  }

  /** Draw a translucent box for an object about to be placed. */
  ghost(g: Graphics, x: number, y: number, h: number, w: number, d: number, height: number, color: number, iso: IsoConfig = DEFAULT_ISO): void {
    const pt = (dx: number, dy: number, dh: number): number[] => {
      const p = gridToScreen(x + dx, y + dy, h + dh, iso);
      return [p.x, p.y];
    };
    g.poly([...pt(-w / 2, -d / 2, height), ...pt(w / 2, -d / 2, height), ...pt(w / 2, d / 2, height), ...pt(-w / 2, d / 2, height)]);
    g.fill({ color, alpha: 0.55 });
  }

  /** Outline boxes for selected objects. */
  outline(boxes: { x: number; y: number; h: number; w: number; d: number; height: number }[], iso: IsoConfig): void {
    const g = this.g;
    for (const b of boxes) {
      const pt = (dx: number, dy: number, dh: number): [number, number] => {
        const p = gridToScreen(b.x + dx, b.y + dy, b.h + dh, iso);
        return [p.x, p.y];
      };
      const hx = b.w / 2 + 0.05;
      const hy = b.d / 2 + 0.05;
      const bot = [pt(-hx, -hy, 0), pt(hx, -hy, 0), pt(hx, hy, 0), pt(-hx, hy, 0)];
      const top = [pt(-hx, -hy, b.height), pt(hx, -hy, b.height), pt(hx, hy, b.height), pt(-hx, hy, b.height)];
      g.poly(bot.flat()).stroke({ width: 2, color: 0xffd34a });
      g.poly(top.flat()).stroke({ width: 2, color: 0xffd34a });
      for (let i = 0; i < 4; i++) {
        g.moveTo(bot[i]![0], bot[i]![1]).lineTo(top[i]![0], top[i]![1]).stroke({ width: 2, color: 0xffd34a });
      }
    }
  }

  get graphics(): Graphics {
    return this.g;
  }
}

export type { P };
