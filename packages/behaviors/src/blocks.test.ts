import { describe, expect, it } from 'vitest';
import { C, applySave, currentFlags, serializeGame, tileMapFromRows, tileMapToRows, type Body, type SceneData, type TransformIso } from '@tilewright/runtime';
import { GRID_PLUS_X, flatScene, player, rig, type Rig } from '@tilewright/plugin-sdk/testing';
import { SCRIPT_API_VERSION, blockAtCell, breakBlock, contextOf, newAction, newCondition, newRow, placeBlock } from '@tilewright/behaviors';

/** Phase 3, step 4.3: gravity and blocks from the logic side (rows, scripts) and at run time. */

function room(extra: Partial<SceneData> = {}): { r: Rig; scene: SceneData } {
  const { scene } = flatScene(12, 12);
  scene.entities.push(player('p', 5.5, 5.5));
  Object.assign(scene, extra);
  const r = rig(scene);
  r.sim.compat = currentFlags();
  return { r, scene };
}

const feet = (r: Rig): TransformIso => r.get('p').get<TransformIso>(C.Transform)!;
const body = (r: Rig): Body => r.get('p').get<Body>(C.Body)!;

describe('gravity from rows', () => {
  it('a Quick Action turns gravity for the scene and the player walks on the wall', () => {
    const { scene } = flatScene(12, 12);
    scene.entities.push(player('p', 5.5, 5.5));
    const row = newRow('r1');
    row.conditions = [newCondition('sceneStart')];
    row.actions = [{ ...newAction('setGravity'), params: { who: 'scene', dir: '-x' } }];
    scene.events.push(row);
    const r = rig(scene);
    r.sim.compat = currentFlags();
    r.run(120);
    expect(r.sim.runtime.gravity).toBe('-x');
    expect(body(r).g).toBe('-x');
    expect(body(r).state).toBe('ground');
    expect(feet(r).x).toBeCloseTo(0, 3);
    // a row can ask which way it points
    const asks = newRow('r2');
    asks.conditions = [{ ...newCondition('gravityIs'), params: { who: 'player', dir: '-x' } }];
    asks.actions = [{ ...newAction('setVariable'), params: { name: 'onWall', op: 'set', value: '1' } }];
    r.sim.runtime.sheet.push(asks);
    r.run(3);
    expect(r.sim.runtime.vars.onWall).toBe(1);
  });

  it('refuses, with a message, in a project that plays with the older physics (gravity only points down there)', () => {
    const { r } = room();
    r.sim.compat = { ...currentFlags(), blockPhysics: false };
    const messages: string[] = [];
    r.sim.events.on('problem', (d) => messages.push(String(d.text)));
    const row = newRow('r1');
    row.conditions = [newCondition('always')];
    row.actions = [{ ...newAction('setGravity'), params: { who: 'scene', dir: '+z' } }];
    r.sim.runtime.sheet.push(row);
    r.run(3);
    expect(r.sim.runtime.gravity).toBe('-z');
    expect(messages.join(' ')).toContain('older physics');
  });

  it('the landing and the turn reach event rows', () => {
    const { r } = room();
    const seen: string[] = [];
    r.sim.events.on('gravity-changed', () => seen.push('turned'));
    r.sim.events.on('landed', () => seen.push('landed'));
    r.run(5); // standing on the floor
    r.sim.runtime.gravity = '+x';
    r.run(120);
    expect(seen).toEqual(['turned', 'landed']);
  });
});

describe('placing and breaking blocks while the game runs', () => {
  it('is off unless the scene says so, and says why', () => {
    const { r } = room();
    const ctx = contextOf(r.sim);
    const res = placeBlock(ctx, { x: 3, y: 3, z: 0, tile: 'stone' });
    expect(res.ok).toBe(false);
    expect(res.why).toContain('does not let the game place or break blocks');
    expect(blockAtCell(ctx, 3, 3, 0)).toBeNull();
  });

  it('places and breaks blocks when allowed, the physics takes them as solid at once, and the edits are counted', () => {
    const { r } = room({ blocks: { runtime: true, limit: 3 } });
    const ctx = contextOf(r.sim);
    // a row-less script path: the same functions the rows and scripts call
    expect(placeBlock(ctx, { x: 8, y: 5, z: 0, tile: 'stone' }).ok).toBe(true);
    expect(placeBlock(ctx, { x: 8, y: 5, z: 1, tile: 'stone' }).ok).toBe(true);
    expect(blockAtCell(ctx, 8, 5, 1)?.name).toBe('stone');
    expect(placeBlock(ctx, { x: 8, y: 5, z: 1, tile: 'stone' }).why).toContain('already a block');
    expect(placeBlock(ctx, { x: 99, y: 5, z: 1, tile: 'stone' }).ok).toBe(false);
    expect(placeBlock(ctx, { x: 7, y: 7, z: 0, tile: 'nonsense' }).why).toContain('no tile called');
    // walk into it: stopped
    r.run(120, GRID_PLUS_X);
    expect(feet(r).x).toBeLessThan(8 - 0.3 + 1e-3);
    expect(breakBlock(ctx, 8, 5, 0).ok).toBe(true);
    expect(ctx.runtime.blockEdits).toBe(3);
    expect(breakBlock(ctx, 8, 5, 1).why).toContain('as many as this scene allows');
    // something standing in the place stops a block going there
    const t = feet(r);
    const blocked = placeBlock({ ...ctx, runtime: { ...ctx.runtime, blockEdits: 0 } } as never, { x: Math.floor(t.x), y: Math.floor(t.y), z: 0, tile: 'stone' });
    expect(blocked.why).toContain('Something is standing there');
  });

  it('what the game placed is saved and comes back when the save is loaded', () => {
    const { r, scene } = room({ blocks: { runtime: true, limit: 50 } });
    const ctx = contextOf(r.sim);
    placeBlock(ctx, { x: 2, y: 2, z: 0, tile: 'stone' });
    placeBlock(ctx, { x: 2, y: 2, z: 1, tile: 'brick', shape: 'stairs', rot: 1 });
    const save = serializeGame(r.sim, { stamp: 'x' });
    expect(save.blocks).toHaveLength(1);
    expect(save.blockEdits).toBe(2);
    const again = rig({ ...scene, map: tileMapToRows(tileMapFromRows(scene.map)) });
    applySave(again.sim, JSON.parse(JSON.stringify(save)));
    const b = again.sim.map!.blockAt(2, 2, 1)!;
    expect(b.shape).toBe('stairs');
    expect(b.rot).toBe(1);
    expect(again.sim.map!.blockAt(2, 2, 0)!.tile).toBe(2);
    expect(again.sim.runtime.blockEdits).toBe(2);
  });
});

describe('the scripting API', () => {
  it('has a version, and gravity and blocks are in it', async () => {
    expect(SCRIPT_API_VERSION).toBe('1.1.0');
    const { r } = room({ blocks: { runtime: true, limit: 10 } });
    const { gameViewOf } = await import('./index');
    const g = gameViewOf(contextOf(r.sim), r.get('p'), { log: () => undefined });
    expect(g.gravity).toBe('-z');
    g.gravity = '+z';
    expect(r.sim.runtime.gravity).toBe('+z');
    g.gravity = 'sideways'; // not a direction: ignored
    expect(r.sim.runtime.gravity).toBe('+z');
    expect(g.setBlock(1, 1, 0, 'stone')).toBe(true);
    expect(g.blockAt(1, 1, 0)).toEqual({ tile: 'stone', shape: 'cube', solid: true });
    expect(g.breakBlock(1, 1, 0)).toBe(true);
    expect(g.blockAt(1, 1, 0)).toBeUndefined();
    const me = g.player!;
    me.gravity = '-y';
    expect(body(r).gdir).toBe('-y');
    expect(me.gravity).toBe('-y');
  });
});
