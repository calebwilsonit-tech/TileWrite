import type { EntityData, TileSet } from '@tilewright/runtime';

/**
 * The editor groups things into layers you can hide and lock. Ground is the terrain, Walls are the tiles marked as
 * walls, Objects are everything placed in the world, and two kinds of object have layers of their own:
 * Decoration (props with the "decoration" tag) and Lights (anything that shines, except the player).
 */
export type ObjectLayer = 'objects' | 'decoration' | 'lights';

export function objectLayerOf(e: Pick<EntityData, 'tags' | 'components'>): ObjectLayer {
  if (e.tags.includes('decoration')) return 'decoration';
  if (!e.tags.includes('player') && e.components.light !== undefined) return 'lights';
  return 'objects';
}

/** Whether a tile belongs to the Walls layer. */
export const isWallTile = (tileset: TileSet, tile: number): boolean => tileset[tile]?.wall === true;
