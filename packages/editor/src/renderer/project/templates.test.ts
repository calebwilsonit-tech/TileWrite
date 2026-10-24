import { describe, expect, it } from 'vitest';
import { C, Simulation, TableSchema, loadScene, physicsSystem, pointerSnapshot, cameraSnapshot, type TransformIso } from '@tilewright/runtime';
import { listTemplates, templateById } from './templates';
import { addStandardSystems, packsOfProject, setActivePacks } from '@tilewright/behaviors';

function start(id: string): { sim: Simulation; ids: Map<string, ReturnType<typeof loadScene> extends Map<string, infer E> ? E : never>; built: ReturnType<ReturnType<typeof templateById>['build']> } {
  const built = templateById(id).build('T');
  setActivePacks(packsOfProject(built.project));
  const sim = new Simulation(1);
  const ids = loadScene(sim, built.scene);
  addStandardSystems(sim, physicsSystem);
  return { sim, ids, built };
}

describe('the genre starters', () => {
  it('each one names the packs it needs, and nothing it does not', () => {
    const packs = Object.fromEntries(listTemplates().map((t) => [t.id, t.build('T').project.plugins]));
    expect(packs.empty).toEqual([]);
    expect(packs.tactics).toEqual(['combat', 'turns', 'controls']);
    expect(packs.builder).toEqual(['controls', 'sim']);
    expect(packs['point-and-click']).toContain('controls');
    expect(packs['action-adventure']).not.toContain('turns');
  });

  it('tactics: a battle starts by itself, blue goes first, and a click walks a soldier', () => {
    const { sim, ids } = start('tactics');
    for (let i = 0; i < 4; i++) sim.step({});
    const turns = sim.runtime.turns;
    expect(turns.active ? sim.world.get(turns.order[turns.index] ?? -1)?.name : undefined).toBe('Knight');
    const knight = ids.get('e1')!;
    const camera = { x: 0, y: 200, zoom: 1, w: 1280, h: 720 };
    const act = (cell: { x: number; y: number }, buttons = { primary: true }) => sim.step({ ...cameraSnapshot(camera), ...pointerSnapshot(cell, buttons) });
    act({ x: 3, y: 10 });
    sim.step({ ...cameraSnapshot(camera), ...pointerSnapshot({ x: 3, y: 10 }) });
    act({ x: 3, y: 7 });
    for (let i = 0; i < 90; i++) sim.step({ ...cameraSnapshot(camera), ...pointerSnapshot({ x: 3, y: 7 }) });
    const at = knight.get<TransformIso>(C.Transform)!;
    expect(Math.abs(at.y - 10.5)).toBeGreaterThan(1.5);
  });

  it('builder: the buildings table and its houses are real files, and gold is there to spend', () => {
    const { built } = start('builder');
    const table = TableSchema.parse(JSON.parse(built.files!['assets/tables/Buildings.table.json']!));
    expect(table.rows.map((r) => r.id)).toEqual(['house', 'wall']);
    expect(Object.keys(built.files!)).toContain('assets/prefabs/House.prefab.json');
    expect(built.scene.variables).toEqual([{ name: 'gold', value: 100 }]);
  });

  it('every starter runs a second of game time without a problem', () => {
    for (const t of listTemplates()) {
      const { sim } = start(t.id);
      expect(() => {
        for (let i = 0; i < 60; i++) sim.step({});
      }, t.id).not.toThrow();
    }
  });
});
