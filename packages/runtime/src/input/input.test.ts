import { describe, expect, it } from 'vitest';
import { InputMap, InputPlayback, InputRecorder, InputState } from './input';

describe('InputMap', () => {
  const map = new InputMap({ jump: ['key:Space', 'pad:button0'], left: ['key:KeyA', 'pad:axis0-'] });

  it('resolves raw bindings to actions', () => {
    expect(map.resolve({ 'key:Space': 1 })).toEqual({ jump: 1 });
    expect(map.resolve({ 'pad:axis0-': 0.4, 'key:KeyA': 1 })).toEqual({ left: 1 });
    expect(map.resolve({ 'key:KeyZ': 1 })).toEqual({});
  });

  it('supports analog values', () => {
    expect(map.resolve({ 'pad:axis0-': 0.4 }).left).toBeCloseTo(0.4);
  });

  it('rebinds an action', () => {
    const m = new InputMap({ jump: ['key:Space'] });
    m.rebind('jump', ['key:KeyJ']);
    expect(m.resolve({ 'key:Space': 1 })).toEqual({});
    expect(m.resolve({ 'key:KeyJ': 1 })).toEqual({ jump: 1 });
  });
});

describe('InputState', () => {
  it('detects press and release edges', () => {
    const s = new InputState();
    s.update({});
    expect(s.pressed('a')).toBe(false);
    s.update({ a: 1 });
    expect(s.pressed('a')).toBe(true);
    expect(s.down('a')).toBe(true);
    s.update({ a: 1 });
    expect(s.pressed('a')).toBe(false);
    expect(s.down('a')).toBe(true);
    s.update({});
    expect(s.released('a')).toBe(true);
    s.update({});
    expect(s.released('a')).toBe(false);
  });

  it('computes axes and vectors', () => {
    const s = new InputState();
    s.update({ r: 1, d: 0.5 });
    expect(s.axis('l', 'r')).toBe(1);
    expect(s.vector('l', 'r', 'u', 'd')).toEqual({ x: 1, y: 0.5 });
    s.update({ l: 1, r: 1 });
    expect(s.axis('l', 'r')).toBe(0);
  });
});

describe('InputRecorder / InputPlayback', () => {
  it('stores only changes and plays them back tick for tick', () => {
    const rec = new InputRecorder();
    const frames: Record<string, number>[] = [{}, {}, { a: 1 }, { a: 1 }, { a: 1, b: 1 }, {}, {}];
    frames.forEach((f) => rec.record(f));
    const out = rec.finish();
    expect(out.length).toBe(7);
    expect(out.events.map((e) => e[0])).toEqual([2, 4, 5]);

    const pb = new InputPlayback(out);
    const got = frames.map(() => pb.next());
    expect(got).toEqual(frames);
    expect(pb.done).toBe(true);
    expect(pb.next()).toEqual({});
  });

  it('records an action held from the very first tick', () => {
    const rec = new InputRecorder();
    rec.record({ a: 1 });
    rec.record({ a: 1 });
    const pb = new InputPlayback(rec.finish());
    expect(pb.next()).toEqual({ a: 1 });
    expect(pb.next()).toEqual({ a: 1 });
  });

  it('can be reset and replayed', () => {
    const rec = new InputRecorder();
    rec.record({ a: 1 });
    rec.record({});
    const pb = new InputPlayback(rec.finish());
    pb.next();
    pb.next();
    pb.reset();
    expect(pb.done).toBe(false);
    expect(pb.next()).toEqual({ a: 1 });
  });
});

describe('a quick tap', () => {
  it('is seen for one read even when the key goes down and up between two frames, and not seen again', async () => {
    const { DomInputSource } = await import('./keyboard');
    const target = new EventTarget() as unknown as Window;
    const source = new DomInputSource(target, () => []);
    const key = (type: string) => Object.assign(new Event(type), { code: 'KeyE', repeat: false });
    target.dispatchEvent(key('keydown'));
    target.dispatchEvent(key('keyup'));
    expect(source.read()['key:KeyE']).toBe(1);
    expect(source.read()['key:KeyE']).toBeUndefined();
    // a key that is held stays down on every read
    target.dispatchEvent(key('keydown'));
    expect(source.read()['key:KeyE']).toBe(1);
    expect(source.read()['key:KeyE']).toBe(1);
    target.dispatchEvent(key('keyup'));
    expect(source.read()['key:KeyE']).toBeUndefined();
    source.dispose?.();
  });
});
