import { describe, expect, it } from 'vitest';
import { Simulation } from '../core/simulation';
import { CURRENT_SCHEMA_VERSION } from '../project/schema';
import { loadScene } from '../project/scene';
import { tileMapToRows } from '../project/scene';
import { TileMap } from '../tilemap/tilemap';
import { C, type TransformIso } from '../scene/components';
import { CURRENT_SAVE_VERSION, SaveError, SaveManager, SaveSchema, applySave, migrateSave, parseSave, serializeGame, type SaveStorage } from './save';

function scene() {
  const map = new TileMap(12, 12);
  map.fill(1, 0);
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    name: 'T',
    map: tileMapToRows(map),
    entities: [
      { id: 'p', name: 'Player', tags: ['player'], components: { transform: { x: 2.5, y: 2.5, h: 0, facing: 2 } } },
      { id: 'coin', name: 'Coin', tags: ['persistent'], components: { transform: { x: 5.5, y: 5.5, h: 0, facing: 2 } } },
      { id: 'door', name: 'Door', tags: ['persistent'], components: { transform: { x: 7.5, y: 5.5, h: 0, facing: 2 }, collider: { w: 1, d: 1, height: 2, solid: true, trigger: false, layer: 1, mask: 65535, enabled: true, inside: [] } } },
      { id: 'tree', name: 'Tree', tags: [], components: { transform: { x: 9.5, y: 5.5, h: 0, facing: 2 } } },
    ],
    regions: [],
    wires: [],
    variables: [{ name: 'gold', value: 0 }],
    events: [],
  };
}

function game(): Simulation {
  const sim = new Simulation();
  loadScene(sim, scene() as never, { scene: 'scenes/main.scene.json' });
  return sim;
}

function memory(): SaveStorage & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(p) {
      const v = files.get(p);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async write(p, t) {
      files.set(p, t);
    },
    async exists(p) {
      return files.has(p);
    },
    async remove(p) {
      files.delete(p);
    },
  };
}

describe('serializeGame and applySave', () => {
  it('keeps flags, inventory, the respawn point, the player and the state of persistent objects', () => {
    const a = game();
    a.runtime.vars.gold = 12;
    a.runtime.vars['item:key'] = 2;
    a.runtime.checkpoint = { scene: 'scenes/main.scene.json', x: 3.5, y: 3.5, h: 0, name: 'Respawn' };
    a.runtime.difficulty = 'hard';
    const p = a.world.withTag('player')[0]!.get<TransformIso>(C.Transform)!;
    p.x = 8.2;
    p.y = 4.1;
    a.world.destroy(a.runtime.ids.get('coin')!); // picked up
    a.world.flush();
    a.world.get(a.runtime.ids.get('door')!)!.get<{ enabled: boolean }>(C.Collider)!.enabled = false; // opened
    const save = serializeGame(a, { stamp: '2026-10-16T12:00:00Z', label: 'Hub', playSeconds: 90 });
    expect(save.gone).toEqual(['coin']);
    expect(save.objects.map((o) => o.id)).toEqual(['door']);
    expect(JSON.parse(JSON.stringify(save))).toEqual(save); // plain data

    const b = game();
    applySave(b, save);
    expect(b.runtime.vars.gold).toBe(12);
    expect(b.runtime.vars['item:key']).toBe(2);
    expect(b.runtime.difficulty).toBe('hard');
    expect(b.runtime.checkpoint?.name).toBe('Respawn');
    const bp = b.world.withTag('player')[0]!.get<TransformIso>(C.Transform)!;
    expect([bp.x, bp.y]).toEqual([8.2, 4.1]);
    b.world.flush();
    expect(b.world.get(b.runtime.ids.get('coin')!)).toBeUndefined();
    expect(b.world.get(b.runtime.ids.get('door')!)!.get<{ enabled: boolean }>(C.Collider)!.enabled).toBe(false);
    expect(b.world.get(b.runtime.ids.get('tree')!)).toBeDefined(); // not persistent: comes back from the scene
  });

  it('does not count a non-persistent object that was destroyed as gone', () => {
    const a = game();
    a.world.destroy(a.runtime.ids.get('tree')!);
    a.world.flush();
    expect(serializeGame(a).gone).toEqual([]);
  });

  it('restores health when the player has it', () => {
    const a = game();
    a.world.withTag('player')[0]!.set('state:health', { hp: 2, dead: false, iframes: 0 });
    const save = serializeGame(a);
    expect(save.player!.hp).toBe(2);
    const b = game();
    b.world.withTag('player')[0]!.set('state:health', { hp: 9, dead: true, iframes: 5 });
    applySave(b, save);
    expect(b.world.withTag('player')[0]!.get<{ hp: number; dead: boolean }>('state:health')).toMatchObject({ hp: 2, dead: false });
  });
});

describe('save format', () => {
  it('migrates and validates, with plain-English errors', () => {
    const ok = SaveSchema.parse({ saveVersion: CURRENT_SAVE_VERSION });
    expect(migrateSave(JSON.parse(JSON.stringify(ok))).vars).toEqual({});
    expect(() => migrateSave(null)).toThrow(/not a save game/);
    expect(() => migrateSave({})).toThrow(/missing its version/);
    expect(() => migrateSave({ saveVersion: 99 })).toThrow(/newer version/);
    expect(() => migrateSave({ saveVersion: 1, vars: { a: [] } })).toThrow(SaveError);
    expect(() => parseSave('{ nope')).toThrow(/not readable text/);
  });
});

describe('SaveManager', () => {
  const data = (label: string) => SaveSchema.parse({ saveVersion: CURRENT_SAVE_VERSION, label, scene: 'scenes/a.scene.json', savedAt: '2026-01-01T00:00:00Z' });

  it('writes slots, lists them, reads them back and removes them', async () => {
    const m = new SaveManager(memory(), 'saves');
    await m.write('slot1', data('First'));
    await m.write('autosave', data('Auto'));
    const list = await m.list();
    expect(list.map((s) => [s.slot, s.exists, s.label])).toEqual([['autosave', true, 'Auto'], ['slot1', true, 'First'], ['slot2', false, ''], ['slot3', false, '']]);
    expect((await m.read('slot1')).data.label).toBe('First');
    await m.remove('slot1');
    await expect(m.read('slot1')).rejects.toThrow(/no save in that slot/);
  });

  it('keeps the previous save as a backup and recovers from a damaged file', async () => {
    const store = memory();
    const m = new SaveManager(store, 'saves');
    await m.write('slot1', data('One'));
    await m.write('slot1', data('Two'));
    store.files.set('saves/slot1.save.json', '{ broken');
    const r = await m.read('slot1');
    expect(r.recovered).toBe(true);
    expect(r.data.label).toBe('One'); // the backup is the save before the last one
    const info = (await m.list()).find((s) => s.slot === 'slot1')!;
    expect(info.damaged).toBe(false);
    expect(info.label).toBe('One');
  });

  it('says so when a slot and its backup are both damaged, and never overwrites a good backup with a bad file', async () => {
    const store = memory();
    const m = new SaveManager(store, 'saves');
    await m.write('slot2', data('Good'));
    await m.write('slot2', data('Better'));
    store.files.set('saves/slot2.save.json', 'garbage');
    await m.write('slot2', data('Newest')); // old file is garbage: the backup stays "Good"
    expect(JSON.parse(store.files.get('saves/slot2.save.json.bak')!).label).toBe('Good');
    store.files.set('saves/slot2.save.json', 'garbage');
    store.files.set('saves/slot2.save.json.bak', 'also garbage');
    await expect(m.read('slot2')).rejects.toThrow(SaveError);
    expect((await m.list()).find((s) => s.slot === 'slot2')).toMatchObject({ exists: true, damaged: true });
  });
});
