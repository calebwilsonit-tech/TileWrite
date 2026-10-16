import { describe, expect, it } from 'vitest';
import { encodeRle, getPixel, newCel, newSprite, parseSprite, setPixel } from '@tilewright/runtime';
import { SpriteDoc } from './doc';

function doc(w = 8, h = 8): SpriteDoc {
  const s = newSprite('hero', w, h);
  s.frames[0]!.cels.l1 = encodeRle(newCel(w, h));
  return SpriteDoc.fromSprite(s);
}

const px = (d: SpriteDoc, x: number, y: number, frame = d.frame, layer = d.layer): number => getPixel(d.cel(frame, layer), { w: d.width, h: d.height }, x, y);

describe('drawing', () => {
  it('draws immediately and undoes a stroke as one step', () => {
    const d = doc();
    const s = d.beginStroke('Pencil')!;
    s.setMany([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], 3);
    expect(px(d, 2, 1)).toBe(3);
    s.commit();
    expect(d.history.labels).toEqual(['Pencil']);
    d.history.undo();
    expect(px(d, 2, 1)).toBe(0);
    d.history.redo();
    expect(px(d, 2, 1)).toBe(3);
    expect(d.dirty).toBe(true);
  });

  it('adds nothing to history when nothing changed, and can cancel', () => {
    const d = doc();
    const a = d.beginStroke('x')!;
    a.set(1, 1, 0);
    a.commit();
    expect(d.history.canUndo).toBe(false);
    const b = d.beginStroke('y')!;
    b.set(2, 2, 4);
    b.cancel();
    expect(px(d, 2, 2)).toBe(0);
  });

  it('ignores out-of-bounds pixels and refuses to draw on a hidden layer', () => {
    const d = doc();
    const s = d.beginStroke('x')!;
    s.set(-1, 0, 3);
    s.set(8, 0, 3);
    s.set(0, 8, 3);
    expect(d.currentCel.every((v) => v === 0)).toBe(true);
    s.cancel();
    d.setLayerVisible('l1', false);
    expect(d.beginStroke('hidden')).toBeNull();
  });
});

describe('frames', () => {
  it('adds, duplicates, deletes and reorders with clips following', () => {
    const d = doc();
    d.beginStroke('x')!.setMany([{ x: 0, y: 0 }], 5);
    const s = d.beginStroke('x')!;
    s.setMany([{ x: 0, y: 0 }], 5);
    s.commit();
    d.addFrame(true); // frame 2 is a copy
    expect(d.frames).toHaveLength(2);
    expect(px(d, 0, 0, 1)).toBe(5);
    expect(d.frame).toBe(1);
    d.addFrame(false); // frame 3 blank
    expect(px(d, 0, 0, 2)).toBe(0);
    d.addClip('walk');
    expect(d.clips[0]!.all).toEqual([0, 1, 2]);
    d.moveFrame(2, 0);
    expect(d.clips[0]!.all).toEqual([1, 2, 0]); // each list entry still points at the same picture
    expect(px(d, 0, 0, 0)).toBe(0);
    d.removeFrame(0);
    expect(d.frames).toHaveLength(2);
    expect(d.clips[0]!.all).toEqual([0, 1]); // the removed frame left the clip, others shifted down
    d.history.undo();
    expect(d.frames).toHaveLength(3);
    expect(d.clips[0]!.all).toEqual([1, 2, 0]);
  });

  it('never deletes the last frame, and clamps frame durations', () => {
    const d = doc();
    d.removeFrame(0);
    expect(d.frames).toHaveLength(1);
    d.setDuration(0, 5);
    expect(d.frames[0]!.duration).toBe(10);
    d.setDuration(0, 999999);
    expect(d.frames[0]!.duration).toBe(60000);
  });
});

describe('layers', () => {
  it('adds, renames, hides, orders, merges and deletes layers', () => {
    const d = doc();
    d.addLayer();
    expect(d.layers).toHaveLength(2);
    const top = d.layer;
    d.renameLayer(top, 'Armour');
    expect(d.layers[1]!.name).toBe('Armour');
    d.beginStroke('x')!.setMany([{ x: 1, y: 1 }], 7);
    const s = d.beginStroke('draw')!;
    s.setMany([{ x: 1, y: 1 }], 7);
    s.commit();
    d.mergeDown();
    expect(d.layers).toHaveLength(1);
    expect(px(d, 1, 1, 0, 'l1')).toBe(7);
    d.history.undo();
    expect(d.layers).toHaveLength(2);
    expect(px(d, 1, 1, 0, top)).toBe(7);
    d.moveLayer(top, -1);
    expect(d.layers[0]!.id).toBe(top);
    d.removeLayer(top);
    expect(d.layers).toHaveLength(1);
    d.removeLayer(d.layers[0]!.id);
    expect(d.layers).toHaveLength(1); // the last layer stays
  });
});

describe('palette', () => {
  it('changes, adds and removes colours, remapping pixels', () => {
    const d = doc();
    const s = d.beginStroke('x')!;
    s.setMany([{ x: 0, y: 0 }], 3);
    s.setMany([{ x: 1, y: 0 }], 5);
    s.commit();
    d.setColor(3, '#112233ff');
    expect(d.palette[3]).toBe('#112233ff');
    d.setColor(0, '#ff0000ff'); // transparent entry cannot change
    expect(d.palette[0]).toBe('#00000000');
    const idx = d.addColor('#abcdef12');
    expect(d.palette[idx]).toBe('#abcdef12');
    expect(d.addColor('#ABCDEF12')).toBe(idx); // already there
    d.removeColor(3);
    expect(px(d, 0, 0)).toBe(0); // pixels with the removed colour become transparent
    expect(px(d, 1, 0)).toBe(4); // later colours shifted down
    d.history.undo();
    expect(px(d, 0, 0)).toBe(3);
    expect(px(d, 1, 0)).toBe(5);
  });

  it('rejects invalid colours', () => {
    const d = doc();
    d.setColor(3, 'red');
    expect(d.palette[3]).toBe('#e8553dff');
  });
});

describe('canvas, feet and boxes', () => {
  it('resizes keeping pixels and moving the feet point and boxes', () => {
    const d = doc(8, 8);
    const s = d.beginStroke('x')!;
    s.setMany([{ x: 7, y: 7 }], 4);
    s.commit();
    d.addBox('hit', { x: 1, y: 1, w: 3, h: 3 });
    d.resize(10, 12, true);
    expect([d.width, d.height]).toEqual([10, 12]);
    expect(px(d, 8, 9)).toBe(4); // centred: +1 x, +2 y
    expect(d.frames[0]!.boxes[0]).toMatchObject({ x: 2, y: 3 });
    expect(d.cel(0, 'l1')).toHaveLength(120);
    d.history.undo();
    expect([d.width, d.height]).toEqual([8, 8]);
    expect(px(d, 7, 7)).toBe(4);
    d.resize(4, 4);
    expect(px(d, 7, 7)).toBe(0); // cropped away
  });

  it('keeps the feet point in range', () => {
    const d = doc();
    d.setOrigin(100, -5);
    expect(d.origin).toEqual({ x: 8, y: 0 });
  });

  it('adds, edits, removes and copies hit and hurt boxes', () => {
    const d = doc();
    d.addFrame(false);
    d.selectFrame(0);
    d.addBox('hurt', { x: 0, y: 0, w: 4, h: 6 });
    d.updateBox(0, { w: 0 });
    expect(d.frames[0]!.boxes[0]!.w).toBe(1);
    d.copyBoxesToAll();
    expect(d.frames[1]!.boxes).toHaveLength(1);
    d.removeBox(0);
    expect(d.frames[0]!.boxes).toHaveLength(0);
    expect(d.frames[1]!.boxes).toHaveLength(1);
  });
});

describe('transforms and selection', () => {
  it('flips, shifts and rotates the current cel', () => {
    const d = doc(4, 4);
    const s = d.beginStroke('x')!;
    s.setMany([{ x: 0, y: 0 }], 9);
    s.commit();
    d.transform('flipH');
    expect(px(d, 3, 0)).toBe(9);
    d.transform('down');
    expect(px(d, 3, 1)).toBe(9);
    d.transform('rotate');
    expect(px(d, 2, 3)).toBe(9);
    d.history.undo();
    d.history.undo();
    d.history.undo();
    expect(px(d, 0, 0)).toBe(9);
  });

  it('transforms only the selection when there is one', () => {
    const d = doc(6, 2);
    const s = d.beginStroke('x')!;
    s.setMany([{ x: 0, y: 0 }, { x: 5, y: 0 }], 3);
    s.commit();
    d.setSelection({ x: 0, y: 0, w: 3, h: 2 });
    d.transform('flipH');
    expect(px(d, 2, 0)).toBe(3); // flipped inside the box
    expect(px(d, 5, 0)).toBe(3); // outside untouched
    expect(px(d, 0, 0)).toBe(0);
  });

  it('does not rotate a non-square canvas', () => {
    const d = doc(6, 2);
    d.transform('rotate');
    expect(d.history.canUndo).toBe(false);
  });

  it('moves and copies the selection', () => {
    const d = doc(8, 4);
    const s = d.beginStroke('x')!;
    s.setMany([{ x: 1, y: 1 }, { x: 2, y: 1 }], 6);
    s.commit();
    d.setSelection({ x: 1, y: 1, w: 2, h: 1 });
    d.moveSelection(3, 1);
    expect(px(d, 1, 1)).toBe(0);
    expect(px(d, 4, 2)).toBe(6);
    expect(d.selection).toMatchObject({ x: 4, y: 2 });
    d.moveSelection(-3, -1, true);
    expect(px(d, 4, 2)).toBe(6); // original stays
    expect(px(d, 1, 1)).toBe(6); // copy lands here
    expect(d.tightSelection()).toEqual({ x: 1, y: 1, w: 2, h: 1 });
  });
});

describe('clips', () => {
  it('adds unique clips and edits directions, mirroring and events as undoable steps', () => {
    const d = doc();
    d.addFrame();
    d.addFrame();
    expect(d.addClip('walk')).not.toBeNull();
    expect(d.addClip('walk')).toBeNull();
    expect(d.addClip('   ')).toBeNull();
    d.updateClip('walk', 'Set directions', (c) => {
      c.mirror = true;
      c.dirs.E = [0, 1];
      c.dirs.S = [2];
      c.events.push({ at: 1, name: 'footstep' });
    });
    expect(d.clips[0]!.dirs.E).toEqual([0, 1]);
    d.renameClip('walk', 'run');
    expect(d.clips[0]!.name).toBe('run');
    d.history.undo();
    expect(d.clips[0]!.name).toBe('walk');
    d.history.undo();
    expect(d.clips[0]!.mirror).toBe(false);
    d.removeClip('walk');
    expect(d.clips).toHaveLength(0);
  });
});

describe('procedural shapes and saving', () => {
  it('turns shapes on with a starter shape and edits them', () => {
    const d = doc();
    d.enableProcedural(true);
    expect(d.procedural!.shapes).toHaveLength(1);
    d.updateShapes('Wider', (shapes) => {
      shapes[0]!.w = 1.2;
    });
    expect(d.procedural!.shapes[0]!.w).toBe(1.2);
    d.history.undo();
    expect(d.procedural!.shapes[0]!.w).toBe(0.6);
    d.enableProcedural(false);
    expect(d.procedural).toBeNull();
  });

  it('serialises to a valid sprite and back, omitting empty cels', () => {
    const d = doc(6, 6);
    const s = d.beginStroke('x')!;
    s.setMany([{ x: 2, y: 2 }], 4);
    s.commit();
    d.addLayer(); // empty second layer
    d.addClip('idle');
    const data = d.toSprite();
    expect(Object.keys(data.frames[0]!.cels)).toEqual(['l1']);
    expect(parseSprite(JSON.parse(JSON.stringify(data))).ok).toBe(true);
    const again = SpriteDoc.fromSprite(data);
    expect(px(again, 2, 2, 0, 'l1')).toBe(4);
    expect(again.layers).toHaveLength(2);
    expect(again.clips[0]!.name).toBe('idle');
    setPixel(again.cel(0, 'l1'), { w: 6, h: 6 }, 0, 0, 1);
    expect(px(d, 0, 0, 0, 'l1')).toBe(0); // independent copies
  });
});
