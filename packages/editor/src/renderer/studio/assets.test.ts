import { describe, expect, it } from 'vitest';
import { celFor, decodePng, encodePng, encodeRle, newScene, newSprite, stringifyScene, stringifySprite } from '@tilewright/runtime';
import {
  blankSprite,
  deleteSprite,
  exportSpriteSheet,
  findReferences,
  importAny,
  importPng,
  listSprites,
  loadAllSprites,
  loadMeta,
  loadSprite,
  saveMeta,
  saveSprite,
  spriteNameProblem,
  type AssetFs,
} from './assets';
import { playerEntity } from '../project/templates';

function memFs(): AssetFs & { files: Map<string, string | Uint8Array> } {
  const files = new Map<string, string | Uint8Array>();
  return {
    files,
    async read(f) {
      const v = files.get(f);
      if (typeof v !== 'string') throw new Error('ENOENT');
      return v;
    },
    async write(f, t) {
      files.set(f, t);
    },
    async readBinary(f) {
      const v = files.get(f);
      if (!(v instanceof Uint8Array)) throw new Error('not binary');
      return v;
    },
    async writeBinary(f, b) {
      files.set(f, b);
    },
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => ({ name: k.slice(prefix.length), dir: false }));
      if (names.length === 0 && ![...files.keys()].some((k) => k.startsWith(prefix))) throw new Error('ENOENT');
      return names;
    },
  };
}

describe('sprite names', () => {
  it('accepts simple names and rejects unsafe or duplicate ones', () => {
    expect(spriteNameProblem('hero')).toBeNull();
    expect(spriteNameProblem('Hero 2_b-c')).toBeNull();
    expect(spriteNameProblem('')).toMatch(/Give the sprite a name/);
    expect(spriteNameProblem('../evil')).toMatch(/Use letters/);
    expect(spriteNameProblem('a/b')).toMatch(/Use letters/);
    expect(spriteNameProblem('x'.repeat(41))).toMatch(/40 characters/);
    expect(spriteNameProblem('Hero', ['hero'])).toMatch(/already exists/);
  });
});

describe('sprite files', () => {
  it('saves, lists, loads and deletes', async () => {
    const fs = memFs();
    expect(await listSprites(fs, '/p')).toEqual([]);
    await saveSprite(fs, '/p', blankSprite('hero', 16, 16));
    await saveSprite(fs, '/p', blankSprite('crate', 8, 8));
    expect(await listSprites(fs, '/p')).toEqual(['crate', 'hero']);
    const s = await loadSprite(fs, '/p', 'hero');
    expect([s.width, s.height]).toEqual([16, 16]);
    await deleteSprite(fs, '/p', 'hero');
    expect(await listSprites(fs, '/p')).toEqual(['crate']);
  });

  it('refuses to save under an unsafe name', async () => {
    await expect(saveSprite(memFs(), '/p', { ...blankSprite('ok', 4, 4), name: '../escape' })).rejects.toThrow(/Use letters/);
  });

  it('explains damaged sprite files', async () => {
    const fs = memFs();
    fs.files.set('/p/assets/sprites/bad.sprite.json', '{ nope');
    await expect(loadSprite(fs, '/p', 'bad')).rejects.toThrow(/damaged/);
    const s = blankSprite('px', 4, 4);
    s.frames[0]!.cels.l1 = '3x1'; // too short for 16 pixels
    fs.files.set('/p/assets/sprites/px.sprite.json', stringifySprite(s));
    await expect(loadSprite(fs, '/p', 'px')).rejects.toThrow(/damaged pixel data in frame 1/);
    await expect(loadSprite(fs, '/p', 'missing')).rejects.toThrow(/could not read/);
  });

  it('loadAll keeps the good sprites and reports the bad ones', async () => {
    const fs = memFs();
    await saveSprite(fs, '/p', blankSprite('good', 4, 4));
    fs.files.set('/p/assets/sprites/bad.sprite.json', '{ nope');
    const r = await loadAllSprites(fs, '/p');
    expect([...r.sprites.keys()]).toEqual(['good']);
    expect(r.problems).toHaveLength(1);
  });

  it('exports a sheet PNG and atlas next to the sprite', async () => {
    const fs = memFs();
    const s = newSprite('hero', 8, 8);
    s.frames[0]!.cels.l1 = encodeRle(Uint8Array.from({ length: 64 }, (_, i) => (i === 9 ? 3 : 0)));
    const r = await exportSpriteSheet(fs, '/p', s);
    const png = fs.files.get(r.png) as Uint8Array;
    const img = decodePng(png);
    expect([img.width, img.height]).toEqual([r.width, r.height]);
    const atlas = JSON.parse(fs.files.get(r.atlas) as string);
    expect(atlas.frames).toHaveLength(1);
    expect(atlas.image).toBe('hero.sheet.png');
    await deleteSprite(fs, '/p', 'hero');
    expect(fs.files.has(r.png)).toBe(false);
  });
});

describe('import', () => {
  const makePng = (w: number, h: number, fill: (x: number, y: number) => number[]): Uint8Array => {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) rgba.set(fill(x, y), (y * w + x) * 4);
    return encodePng(w, h, rgba);
  };

  it('imports a PNG as one frame, reusing the palette and adding new colours', () => {
    const png = makePng(4, 4, (x, y) => (x === y ? [232, 85, 61, 255] : x === 0 ? [1, 2, 3, 255] : [0, 0, 0, 0]));
    const { sprite, notes } = importPng(png, 'pic');
    expect([sprite.width, sprite.height, sprite.frames.length]).toEqual([4, 4, 1]);
    const cel = celFor(sprite, 0, 'l1');
    expect(sprite.palette[cel[0]!]).toBe('#e8553dff'); // existing default colour reused
    expect(sprite.palette[cel[4]!]).toBe('#010203ff'); // new colour added
    expect(cel[3]).toBe(0);
    expect(notes[0]).toMatch(/Imported 1 frame/);
  });

  it('slices a sprite sheet into frames', () => {
    const png = makePng(8, 4, (x) => (x < 4 ? [255, 0, 0, 255] : [0, 0, 255, 255]));
    const { sprite } = importPng(png, 'sheet', 4, 4);
    expect(sprite.frames).toHaveLength(2);
    expect(sprite.width).toBe(4);
    const a = celFor(sprite, 0, 'l1')[0]!;
    const b = celFor(sprite, 1, 'l1')[0]!;
    expect(a).not.toBe(b);
  });

  it('explains oversized images and unreadable files', () => {
    const big = makePng(600, 4, () => [0, 0, 0, 255]);
    expect(() => importPng(big, 'big')).toThrow(/at most 512/);
    expect(() => importPng(new Uint8Array([1, 2, 3]), 'junk')).toThrow(/Could not read that image/);
    expect(() => importAny({ name: 'notes.txt', bytes: new Uint8Array(1) })).toThrow(/PNG and Aseprite/);
  });

  it('cleans up the sprite name from the file name', () => {
    const png = makePng(2, 2, () => [1, 1, 1, 255]);
    expect(importAny({ name: 'My Hero!!.png', bytes: png }).sprite.name).toBe('My Hero');
  });
});

describe('tags and references', () => {
  it('round-trips asset tags', async () => {
    const fs = memFs();
    expect(await loadMeta(fs, '/p')).toEqual({ tags: {} });
    await saveMeta(fs, '/p', { tags: { hero: ['character', 'player'] } });
    expect((await loadMeta(fs, '/p')).tags.hero).toEqual(['character', 'player']);
  });

  it('finds the objects that use a sprite, in every scene', async () => {
    const fs = memFs();
    const a = newScene('A', 4, 4);
    const hero = playerEntity('e1', 1, 1);
    (hero.components.sprite as { asset?: string }).asset = 'hero';
    a.entities.push(hero, { id: 'e2', name: 'Crate', tags: [], components: { sprite: { asset: 'crate' } } });
    const b = newScene('B', 4, 4);
    b.entities.push({ id: 'e1', name: 'Hero twin', tags: [], components: { animator: { asset: 'hero' } } });
    fs.files.set('/p/scenes/a.scene.json', stringifyScene(a));
    fs.files.set('/p/scenes/b.scene.json', stringifyScene(b));
    const project = { schemaVersion: 1, name: 'x', iso: { tileW: 64, tileH: 32, heightPx: 16 }, tileset: [], autotile: [], scenes: ['scenes/a.scene.json', 'scenes/b.scene.json', 'scenes/gone.scene.json'], startScene: 'scenes/a.scene.json' };
    const refs = await findReferences(fs, '/p', project, 'hero');
    expect(refs.map((r) => `${r.scene}:${r.entityName}`)).toEqual(['scenes/a.scene.json:Player', 'scenes/b.scene.json:Hero twin']);
    expect(await findReferences(fs, '/p', project, 'nothing')).toEqual([]);
  });
});
