import type { AutotileRuleData, SpriteData, TileDefData } from '@tilewright/runtime';
import { averageColor, nextTileId } from '../project/tiles';
import { blobRules, type BlobSlot } from './pixels';

/** Turning studio pictures into entries of the project's tile palette (and back). Pure functions over the tile list. */

export type TileProps = NonNullable<TileDefData['props']>;

export interface TileForm {
  name: string;
  props: TileProps;
  /** Use all the frames of the sprite as the animation of the top. */
  animate: boolean;
  fps: number;
  leftArt: string;
  rightArt: string;
  /** Levels tall the pictures on the sides are (they repeat upwards). */
  faceLevels: number;
  variants: { tile: number; weight: number }[];
}

export const emptyTileForm = (name: string): TileForm => ({ name, props: {}, animate: false, fps: 4, leftArt: '', rightArt: '', faceLevels: 1, variants: [] });

const shadeInt = (c: number, k: number): number => {
  const ch = (shift: number): number => Math.max(0, Math.min(255, Math.round(((c >> shift) & 255) * k)));
  return (ch(16) << 16) | (ch(8) << 8) | ch(0);
};

/** The tile that is drawn by this sprite (its top picture, or the first frame of its animation), if any. */
export function tileOfSprite(tiles: readonly TileDefData[], spriteName: string): TileDefData | undefined {
  return tiles.find((t) => t.group === undefined && (t.art === spriteName || t.anim?.frames[0]?.split('#')[0] === spriteName));
}

/** What the form of an existing tile shows. */
export function formOfTile(t: TileDefData): TileForm {
  return {
    name: t.name,
    props: structuredClone(t.props ?? {}),
    animate: !!t.anim,
    fps: t.anim?.fps ?? 4,
    leftArt: t.leftArt ?? '',
    rightArt: t.rightArt ?? '',
    faceLevels: t.faceLevels ?? 1,
    variants: structuredClone(t.variants ?? []),
  };
}

const clean = (p: TileProps): TileProps | undefined => {
  const out: TileProps = {};
  if (p.walkable === false) out.walkable = false;
  for (const k of ['stair', 'pit', 'water', 'blocksLight'] as const) if (p[k]) out[k] = true;
  if (p.footstep) out.footstep = p.footstep;
  if (p.sortOffset) out.sortOffset = p.sortOffset;
  if (p.tags && p.tags.length > 0) out.tags = [...p.tags];
  if (p.custom && Object.keys(p.custom).length > 0) out.custom = { ...p.custom };
  return Object.keys(out).length > 0 ? out : undefined;
};

/**
 * Put a sprite into the palette as a tile (or update the tile it already is). The tile id stays the same when it is updated, so
 * every placed copy changes with it.
 */
export function upsertTile(tiles: readonly TileDefData[], sprite: SpriteData, form: TileForm): { tiles: TileDefData[]; id: number } {
  const existing = tileOfSprite(tiles, sprite.name);
  const avg = averageColor(sprite);
  const frames = form.animate && sprite.frames.length > 1 ? sprite.frames.map((_, i) => `${sprite.name}#${i}`) : undefined;
  const base: TileDefData = {
    id: existing?.id ?? nextTileId(tiles),
    name: form.name.trim() || sprite.name,
    top: existing?.top ?? avg,
    left: existing?.left ?? shadeInt(avg, 0.78),
    right: existing?.right ?? shadeInt(avg, 0.6),
    ...(existing?.group !== undefined ? { group: existing.group } : {}),
    ...(existing?.wall ? { wall: true } : {}),
    ...(existing?.rim ? { rim: existing.rim } : {}),
    art: frames ? undefined : sprite.name,
  } as TileDefData;
  if (!frames) base.art = sprite.name;
  else delete base.art;
  if (frames) base.anim = { frames, fps: form.fps };
  if (form.leftArt) base.leftArt = form.leftArt;
  if (form.rightArt) base.rightArt = form.rightArt;
  if (form.faceLevels !== 1 && (form.leftArt || form.rightArt)) base.faceLevels = form.faceLevels;
  const props = clean(form.props);
  if (props) base.props = props;
  const variants = form.variants.filter((v) => v.weight > 0);
  if (variants.length > 0) base.variants = variants;
  const next = existing ? tiles.map((t) => (t.id === existing.id ? base : t)) : [...tiles, base];
  return { tiles: next, id: base.id };
}

export function slotSpriteName(set: string, slotId: string): string {
  return `${set}_${slotId.split('+').join('_')}`;
}

/** The tiles and rules that make an edge set work: one variant tile per piece, and a rule that picks it by the neighbours. */
export function addEdgeSet(
  tiles: readonly TileDefData[],
  rules: readonly AutotileRuleData[],
  baseTile: number,
  set: string,
  slots: readonly BlobSlot[],
): { tiles: TileDefData[]; rules: AutotileRuleData[] } {
  const base = tiles.find((t) => t.id === baseTile);
  if (!base) return { tiles: [...tiles], rules: [...rules] };
  // replace an earlier version of this set
  const prefix = `${set} `;
  const oldIds = new Set(tiles.filter((t) => t.group === baseTile && t.name.startsWith(prefix)).map((t) => t.id));
  const keptTiles = tiles.filter((t) => !oldIds.has(t.id));
  const keptRules = rules.filter((r) => !oldIds.has(r.result));
  let id = nextTileId(keptTiles);
  const ids = new Map<string, number>();
  const made: TileDefData[] = [];
  for (const s of slots) {
    if (s.id === 'centre') {
      ids.set(s.id, baseTile);
      continue;
    }
    ids.set(s.id, id);
    made.push({ id, name: `${prefix}${s.id}`, top: base.top, left: base.left, right: base.right, group: baseTile, art: slotSpriteName(set, s.id), ...(base.wall ? { wall: true } : {}), ...(base.props ? { props: base.props } : {}) });
    id++;
  }
  return { tiles: [...keptTiles, ...made], rules: [...keptRules, ...blobRules(baseTile, set, slots, (slot) => ids.get(slot) ?? baseTile)] };
}

/** Pieces of a set whose picture is blank (the guided sheet lists these as missing). */
export function missingSlots(slots: readonly BlobSlot[], set: string, sprites: ReadonlyMap<string, SpriteData>, isBlank: (s: SpriteData) => boolean): BlobSlot[] {
  return slots.filter((s) => {
    const sp = sprites.get(slotSpriteName(set, s.id));
    return !sp || isBlank(sp);
  });
}

/**
 * The tile to put in a cell when painting `tile`: the tile itself, or one of its variants now and then by weight (the tile counts
 * as weight 1). Always the same for the same cell, so repainting does not change what was there.
 */
export function pickTileVariant(tileset: readonly TileDefData[], tile: number, x: number, y: number): number {
  const def = tileset.find((t) => t.id === tile);
  const variants = def?.variants;
  if (!variants || variants.length === 0) return tile;
  const total = 1 + variants.reduce((n, v) => n + v.weight, 0);
  let n = Math.sin(x * 127.1 + y * 311.7 + tile * 74.7) * 43758.5453;
  n -= Math.floor(n);
  let at = n * total;
  if (at < 1) return tile;
  at -= 1;
  for (const v of variants) {
    if (at < v.weight) return v.tile;
    at -= v.weight;
  }
  return tile;
}
