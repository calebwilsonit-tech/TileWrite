import { Container, Graphics, Text } from 'pixi.js';
import { facingVector } from '@tilewright/behaviors';
import { DEFAULT_ISO, gridToScreen, type IsoConfig, type RegionData, type TileMap } from '@tilewright/runtime';
import { collisionKind, type CollisionKind, type P } from '../tools/algorithms';
import type { Preview } from '../tools/tools';

/** Colours are colour-blind-safe pairs (blue/orange/yellow/purple differ in lightness as well as hue). */
export const COLLISION_COLORS: Record<CollisionKind, number> = {
  void: 0x000000,
  walkable: 0x2ec27e,
  blocked: 0xe5484d,
  pit: 0x1b1b1f,
  water: 0x3b82f6,
  stair: 0xf5d90a,
  trigger: 0xb18cff,
  deck: 0xff9f43,
};

export interface OverlayInput {
  map: TileMap;
  iso: IsoConfig;
  grid: boolean;
  collision: boolean;
  heightLabels: boolean;
  regions: { list: RegionData[]; visible: boolean; selected: string | null };
  walk: Set<string> | null;
  /** Wires between objects, as points in grid space; hot ones belong to the selected object. */
  wires: { a: { x: number; y: number; h: number }; b: { x: number; y: number; h: number }; hot: boolean }[];
  /** Patrol routes (grid space); the selected object's is bright. */
  paths: { points: { x: number; y: number; h: number }[]; loop: boolean; hot: boolean }[];
  /** What guards can see and hear. */
  cones: { x: number; y: number; h: number; facing: number; range: number; angle: number; hearing: number; hot: boolean }[];
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
          const kind = collisionKind(map, x, y);
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
        g.fill({ color: 0x40e08a, alpha: 0.55 });
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

    for (const c of o.cones) this.cone(g, c, iso);
    for (const pa of o.paths) this.path(g, pa, iso);
    for (const w of o.wires) this.wireLine(g, w.a, w.b, w.hot ? 0xffd34a : 0xe8b84a, w.hot ? 3 : 2, iso);
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

  /** A guard's view: a wedge for the vision cone and a ring for how far it hears. */
  private cone(g: Graphics, c: OverlayInput['cones'][number], iso: IsoConfig): void {
    const base = facingVector(c.facing);
    const baseAngle = Math.atan2(base.y, base.x);
    const half = (c.angle / 2) * (Math.PI / 180);
    const pts = [gridToScreen(c.x, c.y, c.h, iso)];
    const steps = 18;
    for (let i = 0; i <= steps; i++) {
      const a = baseAngle - half + (2 * half * i) / steps;
      pts.push(gridToScreen(c.x + Math.cos(a) * c.range, c.y + Math.sin(a) * c.range, c.h, iso));
    }
    g.poly(pts.flatMap((p) => [p.x, p.y])).fill({ color: 0xff9a3c, alpha: c.hot ? 0.22 : 0.09 });
    g.poly(pts.flatMap((p) => [p.x, p.y])).stroke({ width: c.hot ? 2 : 1, color: 0xff9a3c, alpha: c.hot ? 0.9 : 0.35 });
    if (c.hearing > 0) {
      const ring: number[] = [];
      for (let i = 0; i < 28; i++) {
        const a = (i / 28) * Math.PI * 2;
        const p = gridToScreen(c.x + Math.cos(a) * c.hearing, c.y + Math.sin(a) * c.hearing, c.h, iso);
        ring.push(p.x, p.y);
      }
      g.poly(ring).stroke({ width: 1, color: 0xffd34a, alpha: c.hot ? 0.8 : 0.25 });
    }
  }

  /** A patrol route: a line through the waypoints, numbered, with an arrow back to the start when it loops. */
  private path(g: Graphics, p: OverlayInput['paths'][number], iso: IsoConfig): void {
    if (p.points.length === 0) return;
    const color = 0x4ad1c8;
    const alpha = p.hot ? 0.95 : 0.4;
    const pts = p.points.map((q) => gridToScreen(q.x, q.y, q.h, iso));
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i]!;
      const b = i + 1 < pts.length ? pts[i + 1]! : p.loop && pts.length > 1 ? pts[0]! : null;
      if (b) g.moveTo(a.x, a.y).lineTo(b.x, b.y).stroke({ width: p.hot ? 3 : 2, color, alpha });
      g.circle(a.x, a.y, p.hot ? 6 : 4).fill({ color, alpha });
    }
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
