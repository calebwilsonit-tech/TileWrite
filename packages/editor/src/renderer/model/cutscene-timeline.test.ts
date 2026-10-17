import { describe, expect, it } from 'vitest';
import { CutsceneSchema } from '@tilewright/runtime';
import { TRACKS, hasDuration, schedule, setDuration, totalTime, trackOf } from './cutscene-timeline';

const scene = () =>
  CutsceneSchema.parse({
    name: 'Intro',
    steps: [
      { id: 'a', type: 'fade', to: 0, seconds: 1, async: true }, // the fade runs while the camera moves
      { id: 'b', type: 'cameraTo', target: 'player', seconds: 2 },
      { id: 'c', type: 'say', speaker: 'Elder', text: 'Welcome.' },
      { id: 'd', type: 'sound', name: 'chime' },
      { id: 'e', type: 'wait', seconds: 1.5 },
    ],
  });

describe('cutscene timeline', () => {
  it('starts each step when the one before it ends, and a "keep going" step runs beside the next', () => {
    const b = schedule(scene());
    expect(b.map((x) => [x.id, x.start])).toEqual([['a', 0], ['b', 0], ['c', 2], ['d', 4.5], ['e', 4.85]]);
    expect(b[0]!.parallel).toBe(true);
    expect(b[0]!.lane).toBe(0);
    expect(b[1]!.lane).toBe(1); // same track, overlapping: its own row
  });

  it('puts steps on the track for what they are about, and marks open-ended and instant ones', () => {
    const b = schedule(scene());
    expect(b.map((x) => x.track)).toEqual(['camera', 'camera', 'story', 'world', 'world']);
    expect(b.find((x) => x.id === 'c')).toMatchObject({ open: true, instant: false, label: 'Elder: Welcome.' });
    expect(b.find((x) => x.id === 'd')).toMatchObject({ instant: true, label: 'Play a sound: chime' });
    expect(b.find((x) => x.id === 'a')).toMatchObject({ open: false, duration: 1 });
    expect(TRACKS.map((t) => t.id)).toEqual(['camera', 'people', 'story', 'world']);
    expect(trackOf('move')).toBe('people');
  });

  it('knows the total time', () => {
    expect(totalTime(schedule(scene()))).toBeCloseTo(6.35, 5);
    expect(totalTime([])).toBe(0);
  });

  it('stretches only the steps that have a length, to the nearest tenth, never below the smallest that makes sense', () => {
    const c = scene();
    expect(hasDuration('wait')).toBe(true);
    expect(hasDuration('say')).toBe(false);
    const longer = setDuration(c, 'b', 3.04);
    expect(longer.steps.find((s) => s.id === 'b')).toMatchObject({ seconds: 3 });
    expect(longer.steps.find((s) => s.id === 'a')).toMatchObject({ seconds: 1 }); // others untouched
    expect(setDuration(c, 'c', 5)).toEqual(c); // a line of speech has no length setting
    expect(setDuration(c, 'e', 0).steps.find((s) => s.id === 'e')).toMatchObject({ seconds: 0.1 }); // a wait cannot be zero
    expect(setDuration(c, 'b', 0).steps.find((s) => s.id === 'b')).toMatchObject({ seconds: 0 }); // a camera move can be instant
    expect(c.steps.find((s) => s.id === 'b')).toMatchObject({ seconds: 2 }); // the original is not changed
  });
});
