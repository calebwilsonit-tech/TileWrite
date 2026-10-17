import { describe, expect, it } from 'vitest';
import { MixerSchema, checkMixer, newMixer, pickVariant, spatialize } from './mixer';

describe('the mix file', () => {
  it('fills in a sensible mix from nothing', () => {
    const m = newMixer();
    expect(m.buses).toEqual({ master: 1, music: 1, sfx: 1, voice: 1 });
    expect(m.ducking.enabled).toBe(true);
    expect(m.sounds).toEqual({});
    expect(MixerSchema.safeParse({ sounds: { hit: { bus: 'music' } } }).success).toBe(false); // only effects and voice
    expect(MixerSchema.safeParse({ buses: { master: 4 } }).success).toBe(false);
  });

  it('explains what is wrong in plain English', () => {
    const known = new Set(['hit', 'hit2', 'theme']);
    const m = MixerSchema.parse({
      sounds: { hit: { variants: ['hit2', 'zap', 'hit'] }, ghost: {} },
      music: { theme: { loopStart: 9, loopEnd: 4 }, nothing: {} },
    });
    const problems = checkMixer(m, known);
    expect(problems.join('\n')).toMatch(/picks from "zap"/);
    expect(problems.join('\n')).toMatch(/lists itself/);
    expect(problems.join('\n')).toMatch(/settings for the sound "ghost"/);
    expect(problems.join('\n')).toMatch(/ends its loop \(4s\) before it starts \(9s\)/);
    expect(problems.join('\n')).toMatch(/music settings for "nothing"/);
    expect(checkMixer(newMixer(), known)).toEqual([]);
  });

  it('chooses variants evenly, counting the sound itself as one of them', () => {
    const m = MixerSchema.parse({ sounds: { hit: { variants: ['hit2', 'hit3'] } } });
    expect(pickVariant(m, 'hit', () => 0)).toBe('hit');
    expect(pickVariant(m, 'hit', () => 0.5)).toBe('hit2');
    expect(pickVariant(m, 'hit', () => 0.99)).toBe('hit3');
    expect(pickVariant(m, 'other', () => 0.5)).toBe('other');
    expect(pickVariant(null, 'hit', () => 0.5)).toBe('hit');
  });
});

describe('sound in space', () => {
  const f = { near: 2, far: 10 };

  it('is full volume up close, silent far away and falls smoothly between', () => {
    expect(spatialize(5, 5, 5, 5, f).gain).toBe(1);
    expect(spatialize(5, 5, 6.5, 5, f).gain).toBe(1);
    expect(spatialize(5, 5, 15, 5, f).gain).toBe(0);
    const mid = spatialize(5, 5, 11, 5, f).gain;
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(spatialize(5, 5, 9, 5, f).gain).toBeGreaterThan(spatialize(5, 5, 12, 5, f).gain);
  });

  it('pans by where the source is on the screen: to the right of the listener is right', () => {
    expect(spatialize(5, 5, 5, 5, f).pan).toBe(0);
    expect(spatialize(5, 5, 8, 5, f).pan).toBeGreaterThan(0.1); // more x: right on screen
    expect(spatialize(5, 5, 5, 8, f).pan).toBeLessThan(-0.1); // more y: left on screen
    expect(spatialize(5, 5, 7, 7, f).pan).toBeCloseTo(0, 5); // straight down the screen
    expect(Math.abs(spatialize(5, 5, 14, 5, f).pan)).toBeLessThanOrEqual(0.85);
  });

  it('copes with nonsense settings', () => {
    expect(spatialize(0, 0, 3, 0, { near: 8, far: 4 }).gain).toBeGreaterThanOrEqual(0);
  });
});
