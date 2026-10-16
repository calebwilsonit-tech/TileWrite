import { describe, expect, it } from 'vitest';
import { FLAG, SLOPE, newScene } from '@tilewright/runtime';
import { EditorDoc } from './doc';
import { validateScene } from './validate';
import { playerEntity } from '../project/templates';

function doc(): EditorDoc {
  const d = EditorDoc.fromScene(newScene('T', 12, 12));
  d.addEntities([{ ...playerEntity('x', 2.5, 2.5), name: 'Player' }]);
  return d;
}

const ids = (d: EditorDoc): string[] => validateScene(d).map((p) => p.id);

describe('validateScene', () => {
  it('is clean for a simple scene', () => {
    expect(validateScene(doc())).toEqual([]);
  });

  it('requires a player start, in plain English', () => {
    const d = EditorDoc.fromScene(newScene('T', 4, 4));
    const p = validateScene(d)[0]!;
    expect(p.severity).toBe('error');
    expect(p.message).toMatch(/no player start/);
  });

  it('warns about several players, entities outside the map and on bad ground', () => {
    const d = doc();
    d.addEntities([{ ...playerEntity('y', 5.5, 5.5), name: 'Second' }]);
    expect(ids(d)).toContain('many-players');
    d.addEntities([{ name: 'Lost', tags: [], components: { transform: { x: 50, y: 2, h: 0, facing: 2 } } }]);
    expect(ids(d).some((i) => i.startsWith('outside-'))).toBe(true);
    d.paint('x', [{ x: 8, y: 8, patch: { flags: FLAG.PIT } }]);
    d.addEntities([{ ...playerEntity('z', 8.5, 8.5), tags: [], name: 'Walker' }]);
    expect(ids(d).some((i) => i.startsWith('pit-'))).toBe(true);
  });

  it('finds stairs that do not meet the floor or lead anywhere', () => {
    const d = doc();
    d.paint('x', [{ x: 5, y: 5, patch: { slope: SLOPE.E | 8, height: 0 } }]);
    const found = ids(d);
    expect(found).toContain('slope-top-5-5'); // next cell is level 0, stairs expect level 1
    d.paint('x', [{ x: 6, y: 5, patch: { height: 1 } }]);
    expect(ids(d)).not.toContain('slope-top-5-5');
    d.paint('x', [{ x: 4, y: 5, patch: { height: 3 } }]);
    expect(ids(d)).toContain('slope-base-5-5');
    d.paint('x', [{ x: 5, y: 5, patch: { slope: SLOPE.W | 8 } }]);
    d.paint('x', [{ x: 6, y: 5, patch: { tile: 0 } }]);
    expect(ids(d)).toContain('slope-low-5-5');
  });

  it('flags floor the player can never reach, and stops flagging it once there is a way', () => {
    const d = doc();
    expect(ids(d)).not.toContain('unreachable');
    // a full-width cliff splits the room; the far side cannot be reached
    for (let x = 0; x < 12; x++) d.paint('wall', [{ x, y: 6, patch: { height: 3 } }]);
    expect(ids(d)).toContain('unreachable');
    // a stair up and a stair down is still not enough on its own if the top does not line up...
    d.paint('flatten', [{ x: 4, y: 6, patch: { height: 0 } }]); // a gap in the wall
    expect(ids(d)).not.toContain('unreachable');
    // water across the whole room also cuts it off
    for (let x = 0; x < 12; x++) d.paint('water', [{ x, y: 6, patch: { height: 0, flags: FLAG.WATER } }]);
    expect(ids(d)).toContain('unreachable');
  });

  it('flags regions past the edge', () => {
    const d = doc();
    d.addRegion({ name: 'Big', x: 8, y: 8, w: 10, h: 2, cameraBounds: false, music: '', darkness: 0, bossActive: false });
    expect(validateScene(d).some((p) => /sticks out/.test(p.message))).toBe(true);
  });
});
