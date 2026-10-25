import { FLAG, SceneSchema, gridToScreen, shapeBoxes, type IsoConfig, type SceneData, type TileDefData } from '@tilewright/runtime';
import { Canvas, clip, colorFor, shade, type Pt } from './canvas';

/**
 * A picture of a scene file, drawn from its data alone (no window, no textures): the map at the game's own angle with each
 * tile in its colour and height, blocks built block by block, water and pits, the objects as markers with their names, regions
 * as outlines and wires as lines. It is a sketch to understand a layout from, not what the game looks like: slopes are drawn
 * as tilted tops, tile pictures (art) as the tile's flat colour.
 */

export interface ScenePicture {
  png: Uint8Array;
  width: number;
  height: number;
  notes: string[];
}

export interface PreviewProject {
  tileset: readonly TileDefData[];
  iso: IsoConfig;
}

const GREY: TileDefData = { id: 0, name: '?', top: 0x777777, left: 0x555555, right: 0x666666 };
const MAX_W = 1100;
const MAX_H = 760;

export function renderScene(input: unknown, project: PreviewProject): ScenePicture | null {
  const parsed = SceneSchema.safeParse(input);
  if (!parsed.success) return null;
  return drawScene(parsed.data, project);
}

function drawScene(scene: SceneData, project: PreviewProject): ScenePicture {
  const { map } = scene;
  const W = map.width;
  const H = map.height;
  const iso = project.iso;
  const defs = new Map(project.tileset.map((t) => [t.id, t]));
  const def = (id: number): TileDefData => defs.get(id) ?? { ...GREY, id };
  const stacks = new Map<number, NonNullable<typeof map.stacks>[number]>();
  for (const s of map.stacks ?? []) stacks.set(s.y * W + s.x, s);

  // how tall the world gets, to know the picture's size
  let top = 1;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) top = Math.max(top, (map.heights[y]?.[x] ?? 0) + 1);
  for (const s of map.stacks ?? []) for (const b of s.blocks) top = Math.max(top, b.z + 2);

  const notes: string[] = [];
  const unitW = ((W + H) * iso.tileW) / 2;
  const unitH = ((W + H) * iso.tileH) / 2 + top * iso.heightPx;
  const k = Math.min(1, (MAX_W - 20) / unitW, (MAX_H - 20) / unitH);
  const tooSmall = k * iso.tileW < 5;

  if (tooSmall) return topDown(scene, defs, notes);

  const width = Math.ceil(unitW * k) + 20;
  const height = Math.ceil(unitH * k) + 20;
  const c = new Canvas(width, height);
  const ox = (H * iso.tileW * k) / 2 + 10;
  const oy = top * iso.heightPx * k + 10;
  const P = (gx: number, gy: number, z: number): Pt => {
    const p = gridToScreen(gx, gy, z, iso);
    return [p.x * k + ox, p.y * k + oy];
  };

  const face = (corners: [number, number, number][], color: number, edge = true): void => {
    const pts = corners.map(([x, y, z]) => P(x, y, z));
    c.poly(pts, color);
    if (edge && k * iso.tileW >= 14) c.polyStroke(pts, shade(color, 0.72), 0.45);
  };
  /** A box between two corners, the three faces that look toward the camera. */
  const box = (x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, d: TileDefData): void => {
    face([[x0, y1, z0], [x1, y1, z0], [x1, y1, z1], [x0, y1, z1]], d.left); // south side
    face([[x1, y0, z0], [x1, y1, z0], [x1, y1, z1], [x1, y0, z1]], d.right); // east side
    face([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], d.top); // top
  };

  let pits = 0;
  let water = 0;
  let walls = 0;
  let maxHeight = 0;
  const used = new Map<number, number>();
  for (let sum = 0; sum <= W + H - 2; sum++) {
    for (let x = Math.max(0, sum - (H - 1)); x <= Math.min(W - 1, sum); x++) {
      const y = sum - x;
      const tile = map.tiles[y]?.[x] ?? 0;
      const flags = map.flags[y]?.[x] ?? 0;
      const stack = stacks.get(y * W + x);
      if (stack) {
        if (stack.floor !== 0 && !stack.blocks.some((b) => b.z === 0)) box(x, x + 1, y, y + 1, -0.0001, 0, def(stack.floor));
        for (const b of [...stack.blocks].sort((a, bb) => a.z - bb.z)) {
          const d = def(b.tile);
          used.set(b.tile, (used.get(b.tile) ?? 0) + 1);
          maxHeight = Math.max(maxHeight, b.z + 1);
          for (const [bx0, bx1, by0, by1, bz0, bz1] of [...shapeBoxes(b.shape, b.rot)].sort((p, q) => p[4] - q[4])) box(x + bx0, x + bx1, y + by0, y + by1, b.z + bz0, b.z + bz1, b.solid === false ? { ...d, top: shade(d.top, 1.15), left: shade(d.left, 1.15), right: shade(d.right, 1.15) } : d);
        }
        continue;
      }
      if (tile === 0) continue;
      used.set(tile, (used.get(tile) ?? 0) + 1);
      const d = def(tile);
      const h = map.heights[y]?.[x] ?? 0;
      maxHeight = Math.max(maxHeight, h);
      if ((flags & FLAG.PIT) !== 0) {
        pits++;
        face([[x, y, h], [x + 1, y, h], [x + 1, y + 1, h], [x, y + 1, h]], 0x08090c, false);
        continue;
      }
      const slope = (map.slopes[y]?.[x] ?? 0) & 7;
      if (slope === 0) {
        box(x, x + 1, y, y + 1, 0, h, d);
      } else {
        // the ground rises one level across the cell toward the way it points
        const hi = h + 1;
        const zOf = (cx: number, cy: number): number => ((slope === 1 && cy === y) || (slope === 3 && cy === y + 1) || (slope === 2 && cx === x + 1) || (slope === 4 && cx === x) ? hi : h);
        face([[x, y + 1, 0], [x + 1, y + 1, 0], [x + 1, y + 1, zOf(x + 1, y + 1)], [x, y + 1, zOf(x, y + 1)]], d.left);
        face([[x + 1, y, 0], [x + 1, y + 1, 0], [x + 1, y + 1, zOf(x + 1, y + 1)], [x + 1, y, zOf(x + 1, y)]], d.right);
        face([[x, y, zOf(x, y)], [x + 1, y, zOf(x + 1, y)], [x + 1, y + 1, zOf(x + 1, y + 1)], [x, y + 1, zOf(x, y + 1)]], shade(d.top, 1.08));
      }
      if ((flags & FLAG.WATER) !== 0) {
        water++;
        face([[x, y, h], [x + 1, y, h], [x + 1, y + 1, h], [x, y + 1, h]], 0x2f6fd0, false);
      }
      if ((flags & FLAG.BLOCK) !== 0) {
        walls++;
        const pts = [P(x, y, h + 2), P(x + 1, y, h + 2), P(x + 1, y + 1, h + 2), P(x, y + 1, h + 2)];
        c.polyStroke(pts, 0xffffff, 0.35);
        c.poly([P(x + 1, y, h), P(x + 1, y + 1, h), P(x + 1, y + 1, h + 2), P(x + 1, y, h + 2)], 0xffffff, 0.12);
        c.poly([P(x, y + 1, h), P(x + 1, y + 1, h), P(x + 1, y + 1, h + 2), P(x, y + 1, h + 2)], 0xffffff, 0.18);
      }
    }
  }

  // regions, as outlines on the ground with their names
  for (const r of scene.regions) {
    const pts = [P(r.x, r.y, 0.05), P(r.x + r.w, r.y, 0.05), P(r.x + r.w, r.y + r.h, 0.05), P(r.x, r.y + r.h, 0.05)];
    const col = colorFor(r.name);
    c.poly(pts, col, 0.14);
    c.polyStroke(pts, col, 0.95);
    c.label(pts[0]![0] + 3, pts[0]![1] + 3, clip(r.name, 18), col);
  }

  // objects
  const where = new Map<string, Pt>();
  const at = (e: SceneData['entities'][number]): { x: number; y: number; h: number } | null => {
    const t = e.components.transform as { x?: unknown; y?: unknown; h?: unknown } | undefined;
    return t && typeof t.x === 'number' && typeof t.y === 'number' ? { x: t.x, y: t.y, h: typeof t.h === 'number' ? t.h : 0 } : null;
  };
  const markers: { e: SceneData['entities'][number]; p: Pt; color: number; player: boolean }[] = [];
  for (const e of scene.entities) {
    const t = at(e);
    if (!t) continue;
    const player = e.tags.includes('player');
    const color = player ? 0xffd24a : e.tags.some((g) => /enemy|hostile|boss/.test(g)) ? 0xe05a5a : colorFor(e.prefab ?? e.tags[0] ?? e.name);
    const p = P(t.x, t.y, t.h);
    where.set(e.id, p);
    where.set(e.name, p);
    markers.push({ e, p, color, player });
  }
  for (const w of scene.wires) {
    const a = where.get(w.from.entity);
    const b = where.get(w.to.entity);
    if (a && b) c.line(a[0], a[1] - 5, b[0], b[1] - 5, 0x58d0e0);
  }
  const labelAll = markers.length <= 40;
  for (const m of markers.sort((a, b) => a.p[1] - b.p[1])) {
    c.line(m.p[0], m.p[1], m.p[0], m.p[1] - 8, 0x000000, 0.8);
    c.circle(m.p[0], m.p[1] - 9, 3.4, 0x000000);
    c.circle(m.p[0], m.p[1] - 9, 2.4, m.color);
    if (m.player) c.circle(m.p[0], m.p[1] - 9, 5.5, 0xffffff, false);
    if (labelAll || m.player || m.e.tags.length > 0) c.label(m.p[0] + 6, m.p[1] - 13, clip(m.e.name, 14), m.color);
  }

  notes.push(`Map ${W} x ${H} cells, ground up to ${maxHeight} level${maxHeight === 1 ? '' : 's'} high; ${scene.entities.length} object${scene.entities.length === 1 ? '' : 's'}${scene.regions.length > 0 ? `, ${scene.regions.length} region${scene.regions.length === 1 ? '' : 's'} (outlined, named)` : ''}${scene.wires.length > 0 ? `, ${scene.wires.length} wire${scene.wires.length === 1 ? '' : 's'} (blue lines)` : ''}.`);
  if (pits + water + walls > 0) notes.push(`${[pits ? `${pits} pit cell${pits === 1 ? '' : 's'} (black)` : '', water ? `${water} water cell${water === 1 ? '' : 's'} (blue)` : '', walls ? `${walls} invisible-wall cell${walls === 1 ? '' : 's'} (white outline)` : ''].filter(Boolean).join(', ')}.`);
  if (markers.some((m) => m.player)) notes.push('The player is the yellow marker with a white ring; other objects are coloured by what they are made from, and their names are beside them.');
  if (!labelAll) notes.push(`Only the objects that have tags are named (there are ${markers.length}).`);
  notes.push('This is a sketch drawn from the file, not the game: tiles are flat colours, tile pictures are not shown, and the camera is the standard one.');
  return { png: c.toPng(), width, height, notes };
}

/** A very big map: one coloured square a cell, darker where the ground is lower, objects as dots. */
function topDown(scene: SceneData, defs: Map<number, TileDefData>, notes: string[]): ScenePicture {
  const { map } = scene;
  const px = Math.max(1, Math.min(4, Math.floor(MAX_W / Math.max(map.width, map.height))));
  const c = new Canvas(map.width * px + 4, map.height * px + 4, 0x101216);
  let top = 1;
  for (const row of map.heights) for (const h of row) top = Math.max(top, h);
  for (let y = 0; y < map.height; y++) {
    for (let x = 0; x < map.width; x++) {
      const t = map.tiles[y]?.[x] ?? 0;
      if (t === 0) continue;
      const h = map.heights[y]?.[x] ?? 0;
      const base = defs.get(t)?.top ?? 0x777777;
      c.rect(x * px + 2, y * px + 2, px, px, ((map.flags[y]?.[x] ?? 0) & FLAG.PIT) !== 0 ? 0x050608 : shade(base, 0.7 + (0.5 * h) / top));
    }
  }
  for (const e of scene.entities) {
    const t = e.components.transform as { x?: unknown; y?: unknown } | undefined;
    if (t && typeof t.x === 'number' && typeof t.y === 'number') c.circle(t.x * px + 2, t.y * px + 2, Math.max(1.5, px / 1.5), e.tags.includes('player') ? 0xffd24a : 0xffffff);
  }
  notes.push(`Map ${map.width} x ${map.height} cells (too big to draw at an angle, so it is seen from straight above: lighter is higher, black is a pit), ${scene.entities.length} objects as white dots, the player yellow.`);
  return { png: c.toPng(), width: c.width, height: c.height, notes };
}
