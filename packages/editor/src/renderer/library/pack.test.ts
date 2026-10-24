import { describe, expect, it } from 'vitest';
import type { TileDefData } from '@tilewright/runtime';
import { PACK_FORMAT, PACK_VERSION, applyImport, checkPack, decodeFile, describePack, encodeFile, findClashes, parsePack, spritesOfTiles, tileClosure, tilesUsedByStructure, type Pack } from './pack';

const tile = (id: number, name: string, extra: Partial<TileDefData> = {}): TileDefData => ({ id, name, top: 1, left: 2, right: 3, ...extra });
const file = (path: string, data = '{}') => ({ path, encoding: 'utf8' as const, data });

const pack = (over: Partial<Pack> = {}): Pack => ({
  format: PACK_FORMAT,
  formatVersion: PACK_VERSION,
  name: 'Meadow',
  kind: 'tileset',
  description: '',
  author: '',
  licence: 'CC0-1.0',
  tags: [],
  createdAt: '',
  files: [file('assets/sprites/meadow.sprite.json'), file('assets/sprites/meadow_edge.sprite.json')],
  tiles: [tile(1, 'Meadow', { art: 'meadow' }), tile(2, 'meadow edge-N', { art: 'meadow_edge', group: 1 })],
  autotile: [{ id: 'r1', name: 'edge N', base: 1, pattern: '0*******', result: 2 }],
  uiPrefabs: [],
  uiScreens: [],
  code: false,
  ...over,
});

describe('reading packs', () => {
  it('accepts a good pack and explains a bad one', () => {
    expect(parsePack(JSON.parse(JSON.stringify(pack()))).ok).toBe(true);
    const bad = parsePack({ hello: 1 });
    expect(bad.ok).toBe(false);
    expect((bad as { error: string }).error).toContain('not a Tilewright asset pack');
    expect((parsePack({ ...pack(), formatVersion: 99 }) as { error: string }).error).toContain('newer');
    expect(parsePack({ ...pack(), kind: 'nonsense' }).ok).toBe(false);
  });

  it('lists what is inside, and finds broken references and a wrong tile size', () => {
    expect(describePack(pack()).map((e) => `${e.kind}:${e.name}`)).toEqual(['sprite:meadow', 'sprite:meadow_edge', 'tile:Meadow', 'tile:meadow edge-N', 'rule:1 autotile rules']);
    expect(checkPack(pack())).toEqual([]);
    expect(checkPack(pack({ files: [file('assets/sprites/meadow.sprite.json')] })).some((p) => p.includes('"meadow_edge", which is not in the pack'))).toBe(true);
    expect(checkPack(pack({ files: [file('../evil.json')] })).some((p) => p.includes('outside the assets folder'))).toBe(true);
    expect(checkPack(pack({ files: [file('assets/x.js')] })).some((p) => p.includes('code but the pack does not say'))).toBe(true);
    expect(checkPack(pack({ tileSize: { w: 32, h: 16 } }), { tileW: 64, tileH: 32 }).some((p) => p.includes('drawn for 32 x 16'))).toBe(true);
  });

  it('round-trips binary files through text', () => {
    const bytes = new Uint8Array(70000).map((_, i) => i % 251);
    const f = encodeFile('assets/audio/a.wav', bytes);
    expect(f.encoding).toBe('base64');
    expect([...(decodeFile(f) as Uint8Array)].slice(0, 5)).toEqual([0, 1, 2, 3, 4]);
    expect((decodeFile(f) as Uint8Array).length).toBe(70000);
    expect(decodeFile(encodeFile('a.json', '{"x":1}'))).toBe('{"x":1}');
  });
});

describe('importing', () => {
  const have = (over: Partial<Parameters<typeof applyImport>[1]> = {}) => ({ files: new Set<string>(), tiles: [tile(1, 'Grass'), tile(2, 'Stone')], uiPrefabs: [], ...over });

  it('into a project with no clashes: new tile ids that do not collide, variants and rules follow', () => {
    const r = applyImport(pack(), have(), 'rename');
    expect(r.renamed).toEqual([]);
    expect(r.tiles.map((t) => t.name)).toEqual(['Grass', 'Stone', 'Meadow', 'meadow edge-N']);
    const meadow = r.tiles.find((t) => t.name === 'Meadow')!;
    const edge = r.tiles.find((t) => t.name === 'meadow edge-N')!;
    expect(meadow.id).toBe(3);
    expect(edge).toMatchObject({ id: 4, group: 3 });
    expect(r.autotile).toEqual([expect.objectContaining({ base: 3, result: 4 })]);
    expect(r.files.map((f) => f.path)).toEqual(['assets/sprites/meadow.sprite.json', 'assets/sprites/meadow_edge.sprite.json']);
  });

  it('flags clashes and, when keeping both, renames sprites and tiles and keeps them joined', () => {
    const h = have({ files: new Set(['assets/sprites/meadow.sprite.json']), tiles: [tile(1, 'Grass'), tile(2, 'Meadow', { art: 'old' })] });
    expect(findClashes(pack(), h)).toEqual([{ kind: 'file', name: 'assets/sprites/meadow.sprite.json' }, { kind: 'tile', name: 'Meadow' }]);
    const r = applyImport(pack(), h, 'rename');
    expect(r.files[0]!.path).toBe('assets/sprites/meadow_2.sprite.json');
    const copy = r.tiles.find((t) => t.name === 'Meadow 2')!;
    expect(copy.art).toBe('meadow_2');
    expect(r.tiles.find((t) => t.name === 'Meadow')!.art).toBe('old');
    expect(r.tiles.find((t) => t.name === 'meadow edge-N')!.group).toBe(copy.id);
    expect(r.renamed.length).toBeGreaterThan(1);
  });

  it('replace keeps the existing tile id so placed copies follow; skip changes nothing', () => {
    const h = have({ files: new Set(['assets/sprites/meadow.sprite.json']), tiles: [tile(1, 'Grass'), tile(5, 'Meadow', { art: 'old' })] });
    const r = applyImport(pack(), h, 'replace');
    expect(r.tiles.find((t) => t.name === 'Meadow')).toMatchObject({ id: 5, art: 'meadow' });
    expect(r.tileMap.get(1)).toBe(5);
    expect(r.tiles.find((t) => t.name === 'meadow edge-N')!.group).toBe(5);
    const s = applyImport(pack(), h, 'skip');
    expect(s.tiles.find((t) => t.name === 'Meadow')!.art).toBe('old');
    expect(s.skipped).toContain('assets/sprites/meadow.sprite.json');
    expect(s.files.map((f) => f.path)).toEqual(['assets/sprites/meadow_edge.sprite.json']);
  });

  it('structures follow the tiles they were built from', () => {
    const structure = { name: 'Hut', blocks: [{ x: 0, y: 0, z: 0, tile: 1 }, { x: 1, y: 0, z: 0, tile: 2, faces: { top: 1 } }] };
    expect(tilesUsedByStructure(structure).sort()).toEqual([1, 2]);
    const p = pack({ kind: 'structure', files: [file('assets/structures/Hut.structure.json', JSON.stringify(structure)), file('assets/sprites/meadow.sprite.json'), file('assets/sprites/meadow_edge.sprite.json')] });
    const r = applyImport(p, have(), 'rename');
    const written = JSON.parse(r.files.find((f) => f.path.endsWith('.structure.json'))!.data) as typeof structure;
    expect(written.blocks.map((b) => b.tile)).toEqual([3, 4]);
    expect(written.blocks[1]!.faces).toEqual({ top: 3 });
  });

  it('interface pieces are renamed too', () => {
    const w = { id: 'w1', name: 'Slot', type: 'panel' } as never;
    const p = pack({ kind: 'ui', files: [], tiles: [], autotile: [], uiPrefabs: [{ name: 'Slot', widget: w }] });
    const r = applyImport(p, have({ uiPrefabs: [{ name: 'Slot', widget: w }] }), 'rename');
    expect(r.uiPrefabs.map((x) => x.name)).toEqual(['Slot', 'Slot 2']);
    expect(applyImport(p, have({ uiPrefabs: [{ name: 'Slot', widget: w }] }), 'skip').uiPrefabs).toHaveLength(1);
  });
});

describe('whole interface screens', () => {
  const have = (over: Partial<Parameters<typeof applyImport>[1]> = {}) => ({ files: new Set<string>(), tiles: [], uiPrefabs: [], ...over });
  const screen = (name: string, id = name.toLowerCase()) => ({ id, name, root: { id: 'r', name: 'root', type: 'panel' }, modal: true, back: 'auto', backTo: '', priority: 0, dim: 0, transition: 'none', mapX: 0, mapY: 0, opensOnStart: false, role: 'pause', from: { plugin: 'prebuilt-screens', screen: 'prebuilt-pause', revision: 1, hash: 'abc' } }) as never;

  it('travel in a pack of their own kind, with the part they play and where they came from, and are listed and found when they clash', () => {
    const p = pack({ kind: 'ui', files: [], tiles: [], autotile: [], uiScreens: [screen('Pause')], formatVersion: 2 });
    const parsed = parsePack(JSON.parse(JSON.stringify(p)));
    expect(parsed.ok && parsed.pack.uiScreens[0]).toMatchObject({ name: 'Pause', role: 'pause', from: { plugin: 'prebuilt-screens' } });
    expect(describePack(p)).toEqual([{ kind: 'ui screen', name: 'Pause' }]);
    expect(findClashes(p, have({ uiScreens: [screen('Pause', 'mine')] }))).toEqual([{ kind: 'ui screen', name: 'Pause' }]);
    expect(findClashes(p, have())).toEqual([]);
  });

  it('are renamed, replaced or skipped on a clash, and always get an id nobody else has', () => {
    const p = pack({ kind: 'ui', files: [], tiles: [], autotile: [], uiScreens: [screen('Pause', 'pause')] });
    const mine = have({ uiScreens: [screen('Pause', 'pause')] });
    const renamed = applyImport(p, mine, 'rename');
    expect(renamed.uiScreens.map((s) => [s.name, s.id])).toEqual([['Pause', 'pause'], ['Pause 2', 'pause 2']]);
    expect(renamed.renamed).toEqual(['UI screen Pause -> Pause 2']);
    expect(applyImport(p, mine, 'skip').uiScreens).toHaveLength(1);
    const replaced = applyImport({ ...p, uiScreens: [{ ...(screen('Pause', 'other') as object), dim: 0.5 } as never] }, mine, 'replace');
    expect(replaced.uiScreens).toHaveLength(1);
    expect(replaced.uiScreens[0]).toMatchObject({ id: 'pause', dim: 0.5 });
  });
});

describe('what a set of tiles needs', () => {
  it('the closure includes variants and base tiles, and their pictures are listed', () => {
    const all = [tile(1, 'a', { variants: [{ tile: 3, weight: 1 }], art: 'a' }), tile(2, 'b'), tile(3, 'c', { art: 'c', leftArt: 'c_l', anim: { frames: ['w#0', 'w#1'], fps: 4 } }), tile(4, 'edge', { group: 2, art: 'e' })];
    expect(tileClosure(all, [1]).map((t) => t.id)).toEqual([1, 3]);
    expect(tileClosure(all, [4]).map((t) => t.id)).toEqual([2, 4]);
    expect(spritesOfTiles(tileClosure(all, [1])).sort()).toEqual(['a', 'c', 'c_l', 'w']);
  });
});
