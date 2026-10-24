import { describe, expect, it } from 'vitest';
import { FLAG, newScene, type EntityData, type PrefabData } from '@tilewright/runtime';
import { newRow } from '@tilewright/behaviors';
import { EditorDoc } from './doc';
import { validateScene } from './validate';
import { crateEntity, playerEntity } from '../project/templates';
import { extractPrefab } from '@tilewright/runtime';
import { deletePrefab, listPrefabs, loadAllPrefabs, prefabNameProblem, savePrefab } from '../project/prefabs';
import type { AssetFs } from '../studio/assets';

function doc(): EditorDoc {
  const d = EditorDoc.fromScene(newScene('T', 12, 12));
  d.addEntities([{ ...playerEntity('x', 2.5, 2.5), name: 'Player' }]);
  return d;
}

function plate(x: number, y: number): Omit<EntityData, 'id'> {
  return {
    name: 'Plate',
    tags: [],
    components: {
      transform: { x, y, h: 0, facing: 2 },
      collider: { w: 0.9, d: 0.9, height: 0.1, solid: false, trigger: true, layer: 16, mask: 65535, enabled: true, inside: [] },
      pressurePlate: { activatedBy: 'anything' },
    },
  };
}

function gate(x: number, y: number): Omit<EntityData, 'id'> {
  return {
    name: 'Gate',
    tags: [],
    components: {
      transform: { x, y, h: 0, facing: 2 },
      collider: { w: 1, d: 1, height: 1.6, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] },
      gate: { openWhen: 'any' },
    },
  };
}

describe('wires in the editor document', () => {
  it('adds, undoes, redoes and refuses duplicate wires', () => {
    const d = doc();
    const [p, g] = d.addEntities([plate(4.5, 4.5), gate(6.5, 4.5)]);
    const from = { entity: p!.id, output: 'active' };
    const to = { entity: g!.id, input: 'open' };
    const w = d.addWire(from, to);
    expect(w).not.toBeNull();
    expect(d.addWire(from, to)).toBeNull();
    expect(d.wires).toHaveLength(1);
    d.history.undo();
    expect(d.wires).toHaveLength(0);
    d.history.redo();
    expect(d.wires.map((x) => x.id)).toEqual([w!.id]);
    d.removeWire(w!.id);
    expect(d.wires).toHaveLength(0);
    d.history.undo();
    expect(d.wires).toHaveLength(1);
  });

  it('deleting an object takes its wires with it, and undo brings both back', () => {
    const d = doc();
    const [p, g] = d.addEntities([plate(4.5, 4.5), gate(6.5, 4.5)]);
    d.addWire({ entity: p!.id, output: 'active' }, { entity: g!.id, input: 'open' });
    d.removeEntities([g!.id]);
    expect(d.wires).toHaveLength(0);
    d.history.undo();
    expect(d.entities.some((e) => e.id === g!.id)).toBe(true);
    expect(d.wires).toHaveLength(1);
  });

  it('survives a save: wires, variables and event rows are in the scene data', () => {
    const d = doc();
    const [p, g] = d.addEntities([plate(4.5, 4.5), gate(6.5, 4.5)]);
    d.addWire({ entity: p!.id, output: 'active' }, { entity: g!.id, input: 'open' });
    d.setVariables('vars', [{ name: 'keys', value: 0 }]);
    d.setEvents('rows', [newRow('ev1')]);
    const again = EditorDoc.fromScene(d.toScene());
    expect(again.wires).toHaveLength(1);
    expect(again.variables).toEqual([{ name: 'keys', value: 0 }]);
    expect(again.events.map((r) => r.id)).toEqual(['ev1']);
  });

  it('setEvents is one undo step and ignores no-op edits', () => {
    const d = doc();
    d.setEvents('Add row', [newRow('ev1')]);
    const steps = d.history.labels.length;
    d.setEvents('Same again', [newRow('ev1')]);
    expect(d.history.labels).toHaveLength(steps);
    d.history.undo();
    expect(d.events).toEqual([]);
  });
});

describe('logic validation', () => {
  it('is clean for a connected plate and gate', () => {
    const d = doc();
    const [p, g] = d.addEntities([plate(4.5, 4.5), gate(6.5, 4.5)]);
    d.addWire({ entity: p!.id, output: 'active' }, { entity: g!.id, input: 'open' });
    expect(validateScene(d)).toEqual([]);
  });

  it('explains a wire to an object that no longer has the signal', () => {
    const d = doc();
    const [p, g] = d.addEntities([plate(4.5, 4.5), gate(6.5, 4.5)]);
    d.addWire({ entity: p!.id, output: 'active' }, { entity: g!.id, input: 'open' });
    d.updateEntities([g!.id], 'remove behaviour', (e) => {
      delete e.components.gate;
    });
    const ids = validateScene(d).map((x) => x.id);
    expect(ids.some((i) => i.startsWith('wire-in-'))).toBe(true);
    d.updateEntities([p!.id], 'remove behaviour', (e) => {
      delete e.components.pressurePlate;
    });
    expect(validateScene(d).some((x) => x.id.startsWith('wire-out-') && /does not send a signal/.test(x.message))).toBe(true);
  });

  it('warns when a behaviour is missing the parts it needs', () => {
    const d = doc();
    d.addEntities([{ name: 'Naked plate', tags: [], components: { transform: { x: 4.5, y: 4.5, h: 0, facing: 2 }, pressurePlate: { activatedBy: 'anything' } } }]);
    expect(validateScene(d).some((x) => x.id.startsWith('needs-') && /missing its/.test(x.message))).toBe(true);
  });

  it('flags event rows that name an object or prefab that does not exist, in plain English', () => {
    const d = doc();
    const row = newRow('ev1');
    row.actions = [{ id: 'a1', type: 'spawn', params: { prefab: 'Nope', at: 'self' } } as never];
    d.setEvents('row', [row]);
    const problems = validateScene(d, new Set<string>(), new Set(['Wooden crate']));
    expect(problems.some((p) => p.id.startsWith('events-ev1'))).toBe(true);
  });
});

describe('M6 validation', () => {
  it('explains a sentence stone with nothing to swap and an echo recorder that can never record', () => {
    const d = doc();
    d.addEntities([
      { name: 'Stone', tags: [], components: { transform: { x: 4.5, y: 4.5, h: 0, facing: 2 }, collider: { w: 0.7, d: 0.7, height: 1, solid: true, trigger: false, layer: 16, mask: 65535, enabled: true, inside: [] }, sentenceStone: { before: 'x', words: 'only', after: '', selected: 0, reach: 1.5, variable: '' } } },
    ]);
    d.updateEntities([d.entities.find((e) => e.name === 'Player')!.id], 'echo', (e) => {
      e.components.echoRecorder = { seconds: 8, capacity: 0, capacityVariable: '', ending: 'hold', ghostAlpha: 0.5 };
    });
    const found = validateScene(d);
    expect(found.some((p) => p.id.startsWith('stone-words-') && /fewer than two/.test(p.message))).toBe(true);
    expect(found.some((p) => p.id.startsWith('echo-capacity-') && /0 echoes/.test(p.message))).toBe(true);
    d.updateEntities([d.entities.find((e) => e.name === 'Player')!.id], 'echo', (e) => {
      (e.components.echoRecorder as { capacityVariable: string }).capacityVariable = 'slots';
    });
    expect(validateScene(d).some((p) => p.id.startsWith('echo-capacity-'))).toBe(false);
  });

  it('the new objects in the Place tool carry their behaviours', async () => {
    const { allPrefabs } = await import('../tools/prefabs');
    const PREFABS = allPrefabs(new Map());
    const make = (id: string) => PREFABS.find((p) => p.id === id)!.make(3.5, 3.5, 0);
    expect(make('stone').components).toHaveProperty('sentenceStone');
    expect(make('text').components).toHaveProperty('textBlock');
    expect(make('lantern').components).toHaveProperty('light');
    expect(make('lightsensor').components).toHaveProperty('lightSensor');
    expect(make('dough').components).toHaveProperty('growing');
    expect(make('dough').components).toHaveProperty('collider');
  });
});
describe('M7 validation', () => {
  const guard = (points: string): Omit<EntityData, 'id'> => ({ name: 'Guard', tags: ['enemy'], components: { transform: { x: 3.5, y: 3.5, h: 0, facing: 2 }, patrol: { points, mode: 'loop', speed: 1.8, waitSeconds: 0.5 } } });

  it('explains a patrol with too few points, a point off the map, and a route with no way through', () => {
    const d = doc();
    d.addEntities([guard('3.5,3.5')]);
    expect(validateScene(d).some((p) => p.id.startsWith('patrol-short-') && /fewer than two/.test(p.message))).toBe(true);
    d.updateEntities([d.entities.find((e) => e.name === 'Guard')!.id], 'route', (e) => {
      (e.components.patrol as { points: string }).points = '3.5,3.5; 40.5,3.5';
    });
    expect(validateScene(d).some((p) => p.id.startsWith('patrol-out-'))).toBe(true);
    d.updateEntities([d.entities.find((e) => e.name === 'Guard')!.id], 'route', (e) => {
      (e.components.patrol as { points: string }).points = '3.5,3.5; 8.5,3.5';
    });
    expect(validateScene(d).some((p) => p.id.startsWith('patrol-'))).toBe(false);
    for (let y = 0; y < 12; y++) d.paint('wall', [{ x: 6, y, patch: { flags: FLAG.BLOCK } }]);
    expect(validateScene(d).some((p) => p.id.startsWith('patrol-blocked-') && /cannot walk from patrol point 1 to point 2/.test(p.message))).toBe(true);
  });

  it('a boss that only fights in its room needs a region marked for bosses around it', () => {
    const d = doc();
    d.addEntities([{ name: 'Boss', tags: ['enemy', 'boss'], components: { transform: { x: 6.5, y: 6.5, h: 0, facing: 2 }, health: { max: 8, onDeath: 'stay' }, bossPhases: { onlyInRoom: true } } }]);
    expect(validateScene(d).some((p) => p.id.startsWith('boss-room-'))).toBe(true);
    d.addRegion({ name: 'Arena', x: 4, y: 4, w: 6, h: 6, cameraBounds: false, music: '', darkness: 0, bossActive: true });
    expect(validateScene(d).some((p) => p.id.startsWith('boss-room-'))).toBe(false);
  });

  it('the Place tool offers guards, bosses and spikes ready to use', async () => {
    const { allPrefabs } = await import('../tools/prefabs');
    const PREFABS = allPrefabs(new Map());
    const g = PREFABS.find((p) => p.id === 'guard')!.make(3.5, 3.5, 0);
    for (const part of ['health', 'vision', 'chase', 'patrol', 'damageOnTouch', 'body']) expect(g.components, part).toHaveProperty(part);
    expect((g.components.body as { layer: number }).layer).toBe(4);
    const b = PREFABS.find((p) => p.id === 'boss')!.make(3.5, 3.5, 0);
    expect(b.components).toHaveProperty('bossPhases');
    expect((b.components.health as { onDeath: string }).onDeath).toBe('stay');
    expect(PREFABS.find((p) => p.id === 'spikes')!.make(1.5, 1.5, 0).components).toHaveProperty('damageOnTouch');
  });
});
describe('M9 validation: switches and gates that are connected to nothing', () => {
  it('warns about a plate that does nothing and a gate that can never open, and is quiet once they are wired', () => {
    const d = doc();
    const [p, g] = d.addEntities([plate(4.5, 4.5), gate(6.5, 4.5)]);
    const ids = (): string[] => validateScene(d).map((x) => x.id);
    expect(ids().some((i) => i.startsWith(`unused-${p!.id}-pressurePlate`))).toBe(true);
    expect(validateScene(d).find((x) => x.id.startsWith('unused-'))!.message).toMatch(/not connected to anything/);
    expect(ids().some((i) => i.startsWith(`gate-shut-${g!.id}`))).toBe(true);
    d.addWire({ entity: p!.id, output: 'active' }, { entity: g!.id, input: 'open' });
    expect(ids().filter((i) => i.startsWith('unused-') || i.startsWith('gate-shut-'))).toEqual([]);
  });

  it('an inverted gate, or one an event row opens, is fine on its own', () => {
    const d = doc();
    const [g] = d.addEntities([{ ...gate(6.5, 4.5), components: { ...gate(6.5, 4.5).components, gate: { openWhen: 'any', invert: true } } }]);
    expect(validateScene(d).some((x) => x.id.startsWith('gate-shut-'))).toBe(false);
    d.updateEntities([g!.id], 'no invert', (e) => {
      (e.components.gate as { invert: boolean }).invert = false;
    });
    expect(validateScene(d).some((x) => x.id.startsWith('gate-shut-'))).toBe(true);
    const row = newRow('r1');
    row.actions = [{ id: 'a1', type: 'setEnabled', params: { who: `id:${g!.id}`, state: 'off' } } as never];
    d.setEvents('row', [row]);
    expect(validateScene(d).some((x) => x.id.startsWith('gate-shut-'))).toBe(false);
  });
});
describe('prefab instances in the editor document', () => {
  const crate = (): EntityData => crateEntity('c', 3.5, 3.5);
  const prefab = (): PrefabData => extractPrefab(crate(), 'Crate');

  it('collapses instances to their overrides on save and fills them in on load', () => {
    const prefabs = new Map([['Crate', prefab()]]);
    const d = EditorDoc.fromScene(newScene('T', 8, 8), prefabs);
    const [a, b] = d.addEntities([
      { ...crate(), prefab: 'Crate', name: 'A' },
      { ...crate(), prefab: 'Crate', name: 'B' },
    ]);
    d.updateEntities([b!.id], 'colour', (e) => {
      (e.components.sprite as { color: number }).color = 0x00ff00;
    });
    const scene = d.toScene();
    const sa = scene.entities.find((e) => e.id === a!.id)!;
    const sb = scene.entities.find((e) => e.id === b!.id)!;
    expect(Object.keys(sa.components)).toEqual(['transform']);
    expect(sb.components.sprite).toEqual({ color: 0x00ff00 });
    const loaded = EditorDoc.fromScene(scene, prefabs);
    expect((loaded.getEntity(b!.id)!.components.sprite as { color: number }).color).toBe(0x00ff00);
    expect(loaded.getEntity(a!.id)!.components.pushable).toEqual({ slideSpeed: 6 });
  });

  it('setPrefabs re-fills untouched instances but keeps overrides', () => {
    const prefabs = new Map([['Crate', prefab()]]);
    const d = EditorDoc.fromScene(newScene('T', 8, 8), prefabs);
    const [a, b] = d.addEntities([
      { ...crate(), prefab: 'Crate', name: 'A' },
      { ...crate(), prefab: 'Crate', name: 'B' },
    ]);
    d.updateEntities([b!.id], 'colour', (e) => {
      (e.components.sprite as { color: number }).color = 0x00ff00;
    });
    const changed = prefab();
    (changed.root.components.sprite as { color: number }).color = 0xcc0000;
    d.setPrefabs(new Map([['Crate', changed]]));
    expect((d.getEntity(a!.id)!.components.sprite as { color: number }).color).toBe(0xcc0000);
    expect((d.getEntity(b!.id)!.components.sprite as { color: number }).color).toBe(0x00ff00);
  });

  it('keeps instances (as they are) when their prefab is deleted', () => {
    const prefabs = new Map([['Crate', prefab()]]);
    const d = EditorDoc.fromScene(newScene('T', 8, 8), prefabs);
    const [a] = d.addEntities([{ ...crate(), prefab: 'Crate' }]);
    d.setPrefabs(new Map());
    expect(d.getEntity(a!.id)!.prefab).toBe('Crate');
    expect(d.getEntity(a!.id)!.components.pushable).toBeDefined();
  });
});

function memoryAssetFs(): AssetFs & { files: Map<string, string> } {
  const files = new Map<string, string>();
  return {
    files,
    async read(f) {
      const v = files.get(f);
      if (v === undefined) throw new Error('ENOENT');
      return v;
    },
    async write(f, t) {
      files.set(f, t);
    },
    async readBinary() {
      return new Uint8Array();
    },
    async writeBinary() {
      /* unused */
    },
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
    async list(dir) {
      return [...files.keys()].filter((k) => k.startsWith(dir)).map((k) => ({ name: k.slice(dir.length + 1), dir: false }));
    },
  };
}

describe('prefab files', () => {
  it('saves, lists, loads and deletes', async () => {
    const fs = memoryAssetFs();
    const p = extractPrefab(crateEntity('c', 3.5, 3.5), 'Wooden crate');
    await savePrefab(fs, '/proj', p);
    expect(await listPrefabs(fs, '/proj')).toEqual(['Wooden crate']);
    const { prefabs, problems } = await loadAllPrefabs(fs, '/proj');
    expect(problems).toEqual([]);
    expect(prefabs.get('Wooden crate')).toEqual(p);
    await deletePrefab(fs, '/proj', 'Wooden crate');
    expect(await listPrefabs(fs, '/proj')).toEqual([]);
  });

  it('reports a damaged prefab file instead of failing the whole load', async () => {
    const fs = memoryAssetFs();
    await savePrefab(fs, '/proj', extractPrefab(crateEntity('c', 1, 1), 'Good'));
    fs.files.set('/proj/assets/prefabs/Bad.prefab.json', '{ not json');
    const { prefabs, problems } = await loadAllPrefabs(fs, '/proj');
    expect([...prefabs.keys()]).toEqual(['Good']);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Bad/);
  });

  it('checks names in plain English', () => {
    expect(prefabNameProblem('')).toMatch(/Give the prefab a name/);
    expect(prefabNameProblem('a/b')).toMatch(/letters, numbers/);
    expect(prefabNameProblem('Crate', ['crate'])).toMatch(/already exists/);
    expect(prefabNameProblem('Crate 2')).toBeNull();
  });
});
