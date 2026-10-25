import type { TileDefData } from '@tilewright/runtime';
import { Canvas, clip, shade, type Pt } from './canvas';

/**
 * A picture of a project's tiles: each as a little block in its three colours (top, left side, right side) with its number and
 * name under it. Tile pictures (art) are not drawn, only the flat colours the tile falls back on; the lines under the picture
 * say which tiles have art, animation or special properties.
 */

export interface TilesetPicture {
  png: Uint8Array;
  width: number;
  height: number;
  notes: string[];
}

const COLUMNS = 8;
const CELL_W = 96;
const CELL_H = 74;
const MOST = 160;

export function renderTileset(tileset: readonly TileDefData[]): TilesetPicture | null {
  if (tileset.length === 0) return null;
  const shown = tileset.slice(0, MOST);
  const rows = Math.ceil(shown.length / COLUMNS);
  const c = new Canvas(COLUMNS * CELL_W + 8, rows * CELL_H + 8);
  shown.forEach((t, i) => {
    const cx = 4 + (i % COLUMNS) * CELL_W + CELL_W / 2;
    const top = 4 + Math.floor(i / COLUMNS) * CELL_H + 6;
    const hw = 20; // half the width of the block's top
    const hh = 10;
    const depth = 16;
    const quad = (pts: Pt[], color: number): void => {
      c.poly(pts, color);
      c.polyStroke(pts, shade(color, 0.7), 0.5);
    };
    quad([[cx - hw, top + hh], [cx, top + 2 * hh], [cx, top + 2 * hh + depth], [cx - hw, top + hh + depth]], t.left);
    quad([[cx, top + 2 * hh], [cx + hw, top + hh], [cx + hw, top + hh + depth], [cx, top + 2 * hh + depth]], t.right);
    quad([[cx, top], [cx + hw, top + hh], [cx, top + 2 * hh], [cx - hw, top + hh]], t.top);
    const caption = `${t.id} ${clip(t.name, 16)}`;
    c.text(cx - c.textWidth(caption) / 2, top + 2 * hh + depth + 6, caption, 0xdddddd);
    const marks = [t.wall ? 'WALL' : '', t.props?.water ? 'WATER' : '', t.props?.pit ? 'PIT' : '', t.props?.stair ? 'STAIR' : '', t.props?.solid ? 'SOLID' : '', t.art || t.leftArt || t.rightArt ? 'ART' : '', t.anim ? 'ANIM' : ''].filter(Boolean).join(' ');
    if (marks) c.text(cx - c.textWidth(clip(marks, 22)) / 2, top + 2 * hh + depth + 14, clip(marks, 22), 0x8fa0b8);
  });
  const notes = [`${tileset.length} tile${tileset.length === 1 ? '' : 's'}${tileset.length > shown.length ? ` (the first ${shown.length} are drawn)` : ''}, each as a block: top, left side and right side colours, with its number and name.`];
  const withArt = tileset.filter((t) => t.art || t.leftArt || t.rightArt);
  if (withArt.length > 0) notes.push(`${withArt.length} of them have pictures (sprites) that are not drawn here; the colours are what they fall back on.`);
  const animated = tileset.filter((t) => t.anim).length;
  if (animated > 0) notes.push(`${animated} animated.`);
  return { png: c.toPng(), width: c.width, height: c.height, notes };
}
