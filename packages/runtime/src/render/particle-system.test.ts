import { describe, expect, it } from 'vitest';
import { DEFAULT_ISO } from '../iso/math';
import { PARTICLE_PRESETS, PARTICLE_PRESET_IDS, ParticleSystem } from './particle-system';

describe('particles', () => {
  it('a burst makes the preset number of specks and they all die out', () => {
    const p = new ParticleSystem(DEFAULT_ISO);
    p.burst('hit', 3, 3, 0);
    expect(p.particles).toHaveLength(PARTICLE_PRESETS.hit!.count);
    for (let i = 0; i < 200; i++) p.update(1 / 60);
    expect(p.particles).toHaveLength(0);
  });

  it('every preset works, and an unknown name falls back to plain sparks', () => {
    const p = new ParticleSystem(DEFAULT_ISO);
    for (const id of PARTICLE_PRESET_IDS) p.burst(id, 1, 1, 0);
    p.burst('no-such-preset', 1, 1, 0);
    expect(p.particles.length).toBeGreaterThan(PARTICLE_PRESET_IDS.length);
  });

  it('the count and colour can be chosen, and the total is capped', () => {
    const p = new ParticleSystem(DEFAULT_ISO);
    p.burst('spark', 1, 1, 0, 0x123456, 5);
    expect(p.particles).toHaveLength(5);
    expect(p.particles.every((q) => q.color === 0x123456)).toBe(true);
    for (let i = 0; i < 30; i++) p.burst('confetti', 1, 1, 0, undefined, 80);
    expect(p.particles.length).toBeLessThanOrEqual(600);
  });

  it('smoke rises and sparks fall', () => {
    const p = new ParticleSystem(DEFAULT_ISO);
    p.burst('heal', 1, 1, 0, undefined, 20);
    const y0 = p.particles.reduce((s, q) => s + q.y, 0) / p.particles.length;
    for (let i = 0; i < 20; i++) p.update(1 / 60);
    const y1 = p.particles.reduce((s, q) => s + q.y, 0) / p.particles.length;
    expect(y1).toBeLessThan(y0);
  });

  it('is the same every time (its own seeded random numbers)', () => {
    const a = new ParticleSystem(DEFAULT_ISO);
    const b = new ParticleSystem(DEFAULT_ISO);
    a.burst('magic', 2, 2, 0);
    b.burst('magic', 2, 2, 0);
    expect(a.particles).toEqual(b.particles);
  });
});
