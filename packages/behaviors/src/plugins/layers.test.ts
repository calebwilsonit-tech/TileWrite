import { afterEach, describe, expect, it } from 'vitest';
import { parseProject } from '@tilewright/runtime';
import { freeLayerBit, layerList, layerNamed, projectLayerProblems, setProjectLayers } from './layers';
import { ghostLayerMask } from '../builtins/filters';
import { definePlugin, host } from './host';

afterEach(() => setProjectLayers([]));

describe('collision layers the project names', () => {
  it('are part of the layers there are, beside the engine\'s and the plugins\'', () => {
    expect(layerNamed('crate')).toBeUndefined();
    setProjectLayers([{ name: 'crate', bit: 7, label: 'Crates' }]);
    expect(layerNamed('crate')).toBe(1 << 7);
    expect(layerNamed('player')).toBe(2); // the engine's layers are all still there
    expect(layerList().find((l) => l.name === 'crate')).toMatchObject({ source: 'project', label: 'Crates', ghost: false });
    setProjectLayers(undefined);
    expect(layerNamed('crate')).toBeUndefined();
  });

  it('can be layers of ghosts, which a gate set to let ghosts pass lets through', () => {
    const before = ghostLayerMask();
    setProjectLayers([{ name: 'spirit', bit: 9, ghost: true }]);
    expect(ghostLayerMask() & (1 << 9)).not.toBe(0);
    setProjectLayers([]);
    expect(ghostLayerMask()).toBe(before);
  });

  it('start above the bits the engine and the plugins take, and say when all sixteen are used', () => {
    expect(freeLayerBit()).toBe(6);
    setProjectLayers(Array.from({ length: 10 }, (_, i) => ({ name: `l${i}`, bit: 6 + i })));
    expect(freeLayerBit()).toBe(3); // (bits 0, 1, 2, 4, 5 are the engine's)
    host.register(definePlugin({ id: 't-bit3', name: 'T', version: '1.0.0', engine: '^1.0.0' }, { install: (api) => api.collisionLayer({ name: 't-bit3', bit: 3 }) }));
    host.install('t-bit3');
    try {
      expect(freeLayerBit()).toBeNull();
    } finally {
      host.uninstall('t-bit3');
    }
  });

  it('are refused when a name or a bit is already another layer\'s', () => {
    expect(projectLayerProblems([{ name: 'crate', bit: 7 }])).toEqual([]);
    expect(projectLayerProblems([{ name: 'player', bit: 7 }])[0]).toMatch(/same name/);
    expect(projectLayerProblems([{ name: 'crate', bit: 1 }])[0]).toMatch(/bit 1.*"player"/);
    expect(projectLayerProblems([{ name: 'a', bit: 8 }, { name: 'b', bit: 8 }])[0]).toMatch(/bit 8.*"a"/);
  });

  it('are saved in the project file, and a project without any reads as before', () => {
    const base = { schemaVersion: 2, name: 'G', scenes: ['s.scene.json'], startScene: 's.scene.json' };
    const withLayers = parseProject({ ...base, collisionLayers: [{ name: 'crate', bit: 7 }] });
    expect(withLayers.ok && withLayers.value.collisionLayers).toEqual([{ name: 'crate', bit: 7 }]);
    const without = parseProject(base);
    expect(without.ok && without.value.collisionLayers).toBeUndefined();
    expect(parseProject({ ...base, collisionLayers: [{ name: 'Bad Name', bit: 7 }] }).ok).toBe(false);
    expect(parseProject({ ...base, collisionLayers: [{ name: 'ok', bit: 16 }] }).ok).toBe(false);
  });
});
