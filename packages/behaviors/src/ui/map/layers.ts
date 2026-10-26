import type { RegionData, TileDef } from '@tilewright/runtime';
import type { MapWorld } from './world';

/**
 * The numbers behind the layers of a map that are drawn from the world: the colour of every cell by the rule the layer names, the
 * regions with their colours, the lines of a grid. No drawing here; the screen paints what these say.
 */

export type Rgba = [number, number, number, number];

export function parseColour(text: string | undefined, fallback: Rgba = [128, 128, 128, 255]): Rgba {
  if (!text) return fallback;
  const t = text.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((c) => c + c).join('');
    if (h.length === 6 || h.length === 8) return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) : 255];
  }
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)(?:[\s,/]+([\d.]+))?\s*\)$/i.exec(t);
  if (m) return [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 255 : Math.round(Number(m[4]) * (Number(m[4]) <= 1 ? 255 : 1))];
  return fallback;
}

export const cssOfRgba = (c: Rgba): string => `rgba(${c[0]},${c[1]},${c[2]},${Math.round((c[3] / 255) * 1000) / 1000})`;

/** "grass:#4a7, stone:#889" as a lookup by name. */
export function parsePalette(text: unknown): Map<string, Rgba> {
  const out = new Map<string, Rgba>();
  if (typeof text !== 'string') return out;
  for (const part of text.split(',')) {
    const i = part.indexOf(':');
    if (i <= 0) continue;
    out.set(part.slice(0, i).trim(), parseColour(part.slice(i + 1)));
  }
  return out;
}

const str = (v: unknown, d = ''): string => (typeof v === 'string' ? v : v === undefined || v === null ? d : String(v));
const num = (v: unknown, d = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : Number.isFinite(Number(v)) && v !== '' && v !== undefined && v !== null ? Number(v) : d);
const bool = (v: unknown, d: boolean): boolean => (typeof v === 'boolean' ? v : v === undefined ? d : v === 'true' || v === 1);

const hex = (n: number): Rgba => [(n >> 16) & 255, (n >> 8) & 255, n & 255, 255];

/** Which region (its name) a cell is in: the first listed. */
export function regionNameAt(regions: readonly RegionData[], x: number, y: number): string {
  for (const r of regions) if (x >= r.x && y >= r.y && x < r.x + r.w && y < r.y + r.h) return r.name || r.id;
  return '';
}

const lighten = (c: Rgba, f: number): Rgba => [Math.min(255, Math.round(c[0] * f)), Math.min(255, Math.round(c[1] * f)), Math.min(255, Math.round(c[2] * f)), c[3]];

/** The colour of one cell by the layer's rule. */
export function cellColour(world: MapWorld, s: Record<string, unknown>, x: number, y: number, regionAt: (x: number, y: number) => string, palette: Map<string, Rgba>, fallback: Rgba): Rgba | null {
  const tile = world.tileAt(x, y);
  const by = str(s.colourBy, 'tile');
  const h = world.heightAt(x, y);
  const empty = str(s.empty);
  const emptyColour = empty ? parseColour(empty) : null;
  if (by !== 'table' && by !== 'region' && tile === 0) return emptyColour;
  const def: TileDef | undefined = world.tileset[tile];
  const name = str(s.name);
  let c: Rgba | undefined;
  switch (by) {
    case 'tag': {
      const tags = def?.props?.tags ?? [];
      for (const t of name.split(',').map((x2) => x2.trim()).filter(Boolean)) if (tags.includes(t)) c = palette.get(t) ?? fallback;
      for (const t of tags) if (!c && palette.has(t) && !name) c = palette.get(t);
      c ??= fallback;
      break;
    }
    case 'property': {
      const p = def?.props as Record<string, unknown> | undefined;
      const v = p?.[name] ?? (p?.custom as Record<string, unknown> | undefined)?.[name];
      c = palette.get(String(v)) ?? fallback;
      break;
    }
    case 'height': {
      const exact = palette.get(String(h));
      if (exact) c = exact;
      else {
        let best: Rgba | undefined;
        let bestKey = -Infinity;
        for (const [k, v] of palette) {
          const n = Number(k);
          if (Number.isFinite(n) && n <= h && n > bestKey) {
            best = v;
            bestKey = n;
          }
        }
        c = best ?? lighten(fallback, 0.75 + Math.min(0.9, h * 0.15));
      }
      break;
    }
    case 'region': {
      const r = regionAt(x, y);
      c = (r ? palette.get(r) : undefined) ?? (r ? fallback : (emptyColour ?? undefined)) ?? undefined;
      if (!r && !c) return emptyColour;
      break;
    }
    case 'table': {
      const v = world.valueAt(x, y);
      if (v === undefined) return emptyColour;
      c = palette.get(String(v));
      if (!c && typeof v === 'number') {
        // numbers with no entry run from the fallback colour (low) to white (high), 0 to 10
        const f = Math.max(0, Math.min(1, v / 10));
        c = [Math.round(fallback[0] + (255 - fallback[0]) * f), Math.round(fallback[1] + (255 - fallback[1]) * f), Math.round(fallback[2] + (255 - fallback[2]) * f), 255];
      }
      c ??= fallback;
      break;
    }
    default: {
      // the tile's own colours (a named one in the palette wins)
      const base = palette.get(def?.name ?? '') ?? palette.get(String(tile)) ?? (def ? hex(def.top) : fallback);
      c = base;
      if (bool(s.shade, true) && h > 0) c = lighten(base, 1 + Math.min(0.6, h * 0.08));
    }
  }
  return c ?? fallback;
}

/** The colour of every cell, as numbers (r, g, b, a packed for a little-endian ImageData). */
export function terrainColours(world: MapWorld, s: Record<string, unknown>): Uint32Array {
  const palette = parsePalette(s.palette);
  const fallback = parseColour(str(s.fallback, '#6b7f5a'));
  const out = new Uint32Array(world.w * world.h);
  const names = new Map<string, string>();
  const regionAt = (x: number, y: number): string => {
    const k = `${x},${y}`;
    let n = names.get(k);
    if (n === undefined) {
      n = regionNameAt(world.regions, x, y);
      names.set(k, n);
    }
    return n;
  };
  const byRegion = str(s.colourBy) === 'region';
  for (let y = 0; y < world.h; y++) {
    for (let x = 0; x < world.w; x++) {
      const c = cellColour(world, s, x, y, byRegion ? regionAt : () => '', palette, fallback);
      out[y * world.w + x] = c ? (c[3] << 24) | (c[2] << 16) | (c[1] << 8) | c[0] : 0;
    }
  }
  names.clear();
  return out;
}

export const unpackColour = (v: number): Rgba => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];

// ---------- regions, grid ----------

export interface RegionDraw {
  id: string;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  colour: string;
}

/** The regions a regions layer draws: the ones named (all when none is), each with its colour. `show` says whether one passes the layer's condition. */
export function regionItems(regions: readonly RegionData[], s: Record<string, unknown>, show: (r: RegionData) => boolean): RegionDraw[] {
  const only = str(s.only)
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  const colours = parsePalette(s.colours);
  const base = str(s.colour, '#d9a45a55');
  return regions
    .filter((r) => (only.length === 0 || only.includes(r.name) || only.includes(r.id)) && show(r))
    .map((r) => ({ id: r.id, name: r.name, x: r.x, y: r.y, w: r.w, h: r.h, colour: colours.has(r.name) ? cssOfRgba(colours.get(r.name)!) : base }));
}

export { num as settingNumber, str as settingText, bool as settingBool };
