import { describe, expect, it } from 'vitest';
import type { TileDefData } from '@tilewright/runtime';
import type { AssetFs } from '../studio/assets';
import { buildBehaviourPack, buildSpritePack, buildStructurePack, buildTilePack, guessBehaviourNeeds, thumbnailSprite, type PackSource } from './build';
import { checkPack } from './pack';

function source(files: Record<string, string>, tiles: TileDefData[] = []): PackSource {
  const fs = {
    read: async (f: string) => {
      const key = f.replace(/\\/g, '/').replace('P/', '');
      if (!(key in files)) throw new Error('missing');
      return files[key]!;
    },
    readBinary: async () => new Uint8Array([1, 2, 3]),
  } as unknown as AssetFs;
  return { fs, dir: 'P', tiles, autotile: [{ id: 'r', name: 'edge', base: 1, pattern: '********', result: 2 }], uiPrefabs: [], tileSize: { w: 64, h: 32 } };
}
const tile = (id: number, name: string, extra: Partial<TileDefData> = {}): TileDefData => ({ id, name, top: 1, left: 2, right: 3, ...extra });
const info = { name: 'Thing' };

describe('building packs from a project', () => {
  it('a tileset brings its variants, rules and pictures; the result checks out', async () => {
    const src = source({ 'assets/sprites/a.sprite.json': '{}', 'assets/sprites/e.sprite.json': '{}' }, [tile(1, 'A', { art: 'a' }), tile(2, 'A edge', { art: 'e', group: 1 }), tile(3, 'Other', { art: 'zzz' })]);
    const { pack, missing } = await buildTilePack(src, 'tileset', info, [1]);
    expect(missing).toEqual([]);
    expect(pack.tiles.map((t) => t.name)).toEqual(['A', 'A edge']);
    expect(pack.autotile).toHaveLength(1);
    expect(pack.files.map((f) => f.path).sort()).toEqual(['assets/sprites/a.sprite.json', 'assets/sprites/e.sprite.json']);
    expect(pack.tileSize).toEqual({ w: 64, h: 32 });
    expect(checkPack(pack)).toEqual([]);
    expect(thumbnailSprite(pack)).toBe('a');
  });

  it('reports pictures the project does not have instead of failing', async () => {
    const { pack, missing } = await buildTilePack(source({}, [tile(1, 'A', { art: 'gone' })]), 'tile', info, [1]);
    expect(missing).toEqual(['gone']);
    expect(pack.tiles).toHaveLength(1);
  });

  it('an attachment brings its other side, a prop its variants', async () => {
    const src = source({
      'assets/sprites/window.sprite.json': JSON.stringify({ meta: { otherSide: 'window_right' } }),
      'assets/sprites/window_right.sprite.json': '{}',
      'assets/sprites/oak.sprite.json': JSON.stringify({ meta: { variants: [{ sprite: 'oak2', weight: 1 }] } }),
      'assets/sprites/oak2.sprite.json': '{}',
    });
    expect((await buildSpritePack(src, 'attachment', info, ['window'])).pack.files.map((f) => f.path).sort()).toEqual(['assets/sprites/window.sprite.json', 'assets/sprites/window_right.sprite.json']);
    expect((await buildSpritePack(src, 'prop', info, ['oak'])).pack.files).toHaveLength(2);
  });

  it('a structure brings the tiles its blocks use and the pictures of the objects in it', async () => {
    const structure = { name: 'Hut', blocks: [{ x: 0, y: 0, z: 0, tile: 2 }], entities: [{ components: { sprite: { asset: 'window' } } }] };
    const src = source({ 'assets/structures/Hut.structure.json': JSON.stringify(structure), 'assets/sprites/b.sprite.json': '{}', 'assets/sprites/window.sprite.json': '{}' }, [tile(1, 'Unused'), tile(2, 'Brick', { art: 'b' })]);
    const { pack, missing } = await buildStructurePack(src, info, 'Hut');
    expect(missing).toEqual([]);
    expect(pack.tiles.map((t) => t.name)).toEqual(['Brick']);
    expect(pack.files.map((f) => f.path).sort()).toEqual(['assets/sprites/b.sprite.json', 'assets/sprites/window.sprite.json', 'assets/structures/Hut.structure.json']);
  });

  it('a behaviour brings the components and tables it mentions', async () => {
    const text = JSON.stringify({ rows: [{ when: 'Health.hp < 1', table: 'Loot' }] });
    expect(guessBehaviourNeeds(text, ['Health', 'Mana'], ['Loot', 'Prices'])).toEqual({ components: ['Health'], tables: ['Loot'] });
    const src = source({ 'assets/behaviors/Mortal.behavior.json': text, 'assets/components/Health.component.json': '{}' });
    const { pack, missing } = await buildBehaviourPack(src, info, ['Mortal'], { components: ['Health'], tables: ['Loot'] });
    expect(pack.files.map((f) => f.path)).toEqual(['assets/behaviors/Mortal.behavior.json', 'assets/components/Health.component.json']);
    expect(missing).toEqual(['table Loot']);
  });
});
