import { afterEach, describe, expect, it } from 'vitest';
import { Simulation, physicsSystem } from '@tilewright/runtime';
import {
  actionDef,
  activePackIds,
  addStandardSystems,
  behaviorDef,
  conditionDef,
  editorExtensions,
  getBehavior,
  installPack,
  isPackInstalled,
  listPacks,
  packContents,
  packInputActions,
  packSystems,
  registerPack,
  setActivePacks,
  uninstallPack,
  type Pack,
} from '@tilewright/behaviors';
import '@tilewright/bundled-plugins';

afterEach(() => setActivePacks(undefined));

describe('packs', () => {
  it('start with everything on, so a project made before packs existed plays as it always did', () => {
    expect(getBehavior('echoRecorder')).toBeDefined();
    expect(getBehavior('health')).toBeDefined();
    expect(conditionDef('stoneSays')).toBeDefined();
    expect(actionDef('damage')).toBeDefined();
    expect(activePackIds().sort()).toEqual(['ai', 'combat', 'controls', 'inventory', 'lighting', 'prebuilt-screens', 'sim', 'story', 'storytender', 'turns']);
  });

  it('an empty list turns every optional part off, leaving only the core', () => {
    setActivePacks([]);
    expect(activePackIds()).toEqual(['prebuilt-screens']);
    for (const id of ['echoRecorder', 'sentenceStone', 'health', 'meleeAttack', 'pickup', 'npcTalk', 'patrol', 'light', 'checkpoint', 'stateMachine']) expect(getBehavior(id), id).toBeUndefined();
    for (const id of ['gate', 'pressurePlate', 'lever', 'timer', 'logic', 'spawner', 'portal', 'followCamera']) expect(getBehavior(id), id).toBeDefined();
    expect(conditionDef('stoneSays')).toBeUndefined();
    expect(actionDef('damage')).toBeUndefined();
    expect(actionDef('setVariable')).toBeDefined();
    expect(packInputActions()).toEqual({});
  });

  it('turning a pack back on restores what it added; a pack that needs another turns it on too', () => {
    setActivePacks(['storytender']);
    expect(activePackIds().sort()).toEqual(['lighting', 'prebuilt-screens', 'storytender']);
    expect(getBehavior('echoRecorder')).toBeDefined();
    expect(getBehavior('light')).toBeDefined();
    expect(getBehavior('health')).toBeUndefined();
    expect(packInputActions().echo?.bindings).toContain('key:KeyR');
    setActivePacks(['combat']);
    expect(getBehavior('echoRecorder')).toBeUndefined();
    expect(getBehavior('health')).toBeDefined();
    expect(actionDef('damage')).toBeDefined();
    expect(Object.keys(packInputActions()).sort()).toEqual(['attack', 'dodge']);
  });

  it('turning off a pack takes its dependents with it', () => {
    setActivePacks(['storytender']);
    uninstallPack('lighting');
    expect(isPackInstalled('storytender')).toBe(false);
  });

  it('a programmer\'s pack adds behaviours, blocks, systems, buttons and editor parts through the plugin API, and removes them cleanly', () => {
    let ticks = 0;
    const pack: Pack = {
      id: 'test-pack',
      name: 'Test pack',
      version: '0.1.0',
      description: 'for tests',
      install(api) {
        api.behavior(
          behaviorDef({
            id: 'testSpinner',
            name: 'Test Spinner',
            category: 'Test',
            description: 'spins',
            phase: 'actuator',
            defaults: { rate: 2 },
            fields: [{ key: 'rate', label: 'Rate', type: 'number' }],
            inputs: [],
            outputs: [],
            requires: {},
            update: () => undefined,
          }),
        );
        api.condition({ id: 'testCond', label: 'Test condition', category: 'Test', params: [], describe: () => 'test', test: () => true });
        api.action({ id: 'testAct', label: 'Test action', category: 'Test', params: [], describe: () => 'test', run: () => undefined });
        api.system('tick', () => void ticks++);
        api.inputAction('zoom_in', { label: 'Zoom in', bindings: ['key:Equal'] });
        api.panel({ id: 'test-panel', title: 'Test', mount: () => undefined });
        api.tool({ id: 'test-tool', label: 'Test tool', onCell: () => undefined });
        api.importer({ id: 'test-importer', label: 'Test files', extensions: ['.tst'], import: () => 'ok' });
      },
    };
    registerPack(pack);
    expect(listPacks().find((p) => p.id === 'test-pack')).toMatchObject({ active: false, builtin: false });
    installPack('test-pack');
    expect(getBehavior('testSpinner')?.name).toBe('Test Spinner');
    expect(conditionDef('testCond')).toBeDefined();
    expect(actionDef('testAct')).toBeDefined();
    expect(packInputActions().zoom_in?.label).toBe('Zoom in');
    expect(editorExtensions().panels.get('test-panel')?.plugin).toBe('test-pack');
    expect(editorExtensions().tools.has('test-tool')).toBe(true);
    expect(editorExtensions().importers.get('test-importer')?.extensions).toEqual(['.tst']);
    expect(packContents('test-pack')?.behaviors).toEqual(['testSpinner']);
    expect(packSystems().map((s) => s.name)).toContain('test-pack:tick');
    const sim = new Simulation(1);
    addStandardSystems(sim, physicsSystem);
    sim.step();
    sim.step();
    expect(ticks).toBe(2);
    uninstallPack('test-pack');
    expect(getBehavior('testSpinner')).toBeUndefined();
    expect(conditionDef('testCond')).toBeUndefined();
    expect(editorExtensions().panels.has('test-panel')).toBe(false);
    expect(packInputActions().zoom_in).toBeUndefined();
  });

  it('a pack whose install fails is left uninstalled, with a plain message', () => {
    registerPack({
      id: 'broken-pack',
      name: 'Broken pack',
      version: '0.0.1',
      description: '',
      install() {
        throw new Error('boom');
      },
    });
    expect(() => installPack('broken-pack')).toThrow(/Broken pack.*boom/);
    expect(isPackInstalled('broken-pack')).toBe(false);
  });
});
