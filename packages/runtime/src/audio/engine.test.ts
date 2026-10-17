import { describe, expect, it } from 'vitest';
import { AudioEngine, type AudioContextLike, type GainNodeLike, type SourceNodeLike } from './engine';

/** A pretend sound card that remembers what was asked of it. */
class FakeContext implements AudioContextLike {
  currentTime = 0;
  state = 'suspended';
  destination = { name: 'destination' };
  gains: (GainNodeLike & { ramps: [number, number][]; connected: unknown })[] = [];
  sources: (SourceNodeLike & { started: number; stopped: number | null })[] = [];
  decoded: ArrayBuffer[] = [];
  createGain() {
    const ramps: [number, number][] = [];
    const g = {
      ramps,
      connected: null as unknown,
      gain: { value: 1, setValueAtTime: () => undefined, linearRampToValueAtTime: (v: number, t: number) => ramps.push([v, t]), cancelScheduledValues: () => undefined },
      connect(to: unknown) {
        this.connected = to;
      },
      disconnect() {},
    };
    this.gains.push(g);
    return g;
  }
  createBufferSource() {
    const s = {
      buffer: null as unknown,
      loop: false,
      playbackRate: { value: 1 },
      onended: null as (() => void) | null,
      started: 0,
      stopped: null as number | null,
      connect() {},
      disconnect() {},
      start() {
        this.started++;
      },
      stop(when?: number) {
        this.stopped = when ?? 0;
      },
    };
    this.sources.push(s);
    return s;
  }
  async decodeAudioData(data: ArrayBuffer): Promise<unknown> {
    if (data.byteLength === 0) throw new Error('empty');
    this.decoded.push(data);
    return { length: data.byteLength };
  }
  async resume(): Promise<void> {
    this.state = 'running';
  }
  async close(): Promise<void> {}
}

function engine(): { a: AudioEngine; ctx: FakeContext } {
  const ctx = new FakeContext();
  return { a: new AudioEngine(() => ctx), ctx };
}
const bytes = (n = 8): Uint8Array => new Uint8Array(n).fill(1);

describe('audio engine', () => {
  it('loads sounds by name, and says so when a file cannot be decoded', async () => {
    const { a } = engine();
    expect(await a.load('hit', bytes())).toBe(true);
    expect(await a.load('broken', new Uint8Array(0))).toBe(false);
    expect(a.names()).toEqual(['hit']);
    expect(a.problems.join(' ')).toContain('"broken"');
  });

  it('decodes a copy, so the original bytes stay usable', async () => {
    const { a, ctx } = engine();
    const original = bytes(16);
    await a.load('x', original);
    expect(ctx.decoded[0]).not.toBe(original.buffer);
    expect(original.length).toBe(16);
  });

  it('plays a known sound and ignores an unknown one', async () => {
    const { a, ctx } = engine();
    await a.load('hit', bytes());
    expect(a.play('nope')).toBe(false);
    expect(a.play('hit')).toBe(true);
    expect(ctx.sources.filter((s) => s.started > 0)).toHaveLength(1);
  });

  it('a sound asked for twice in the same instant plays once, and not more than 24 at a time', async () => {
    const { a, ctx } = engine();
    await a.load('hit', bytes());
    expect(a.play('hit')).toBe(true);
    expect(a.play('hit')).toBe(false);
    for (let i = 0; i < 40; i++) {
      ctx.currentTime += 0.1;
      a.play('hit');
    }
    expect(ctx.sources.filter((s) => s.started > 0).length).toBeLessThanOrEqual(24);
    ctx.sources[0]!.onended?.(); // one finishes, room for another
    ctx.currentTime += 0.1;
    expect(a.play('hit')).toBe(true);
  });

  it('each play drifts a little in pitch, within the allowed range', async () => {
    const ctx = new FakeContext();
    const a = new AudioEngine(() => ctx, () => 1);
    await a.load('hit', bytes());
    a.play('hit');
    expect((ctx.sources[0] as unknown as { playbackRate: { value: number } }).playbackRate.value).toBeCloseTo(1.05, 5);
    ctx.currentTime += 1;
    a.play('hit', 1, 0);
    expect((ctx.sources[1] as unknown as { playbackRate: { value: number } }).playbackRate.value).toBe(1);
  });

  it('music loops, asking for the same track again does nothing, and a change crossfades', async () => {
    const { a, ctx } = engine();
    await a.load('calm', bytes());
    await a.load('fight', bytes());
    expect(a.playMusic('missing')).toBe(false);
    expect(a.playMusic('calm', 2)).toBe(true);
    expect(a.currentMusic).toBe('calm');
    const calm = ctx.sources[0]!;
    expect(calm.loop).toBe(true);
    expect(a.playMusic('calm')).toBe(false);
    ctx.currentTime = 10;
    expect(a.playMusic('fight', 2)).toBe(true);
    expect(a.currentMusic).toBe('fight');
    expect(calm.stopped).toBeGreaterThanOrEqual(12);
    expect(ctx.gains.some((g) => g.ramps.some(([v, t]) => v === 0 && t === 12))).toBe(true);
    expect(ctx.gains.some((g) => g.ramps.some(([v, t]) => v === 1 && t === 12))).toBe(true);
    a.playMusic('');
    expect(a.currentMusic).toBe('');
  });

  it('volumes are clamped and applied to the buses', async () => {
    const { a, ctx } = engine();
    await a.load('hit', bytes());
    a.setVolumes({ master: 2, music: -1, sfx: 0.5 });
    expect(a.volumes).toEqual({ master: 1, music: 0, sfx: 0.5 });
    const values = ctx.gains.slice(0, 3).map((g) => g.gain.value);
    expect(values).toEqual([1, 0, 0.5]); // master, music, sound effects
  });

  it('unlock resumes a suspended context; with no audio on this machine nothing throws', async () => {
    const { a, ctx } = engine();
    await a.unlock();
    expect(ctx.state).toBe('running');
    const none = new AudioEngine(() => null);
    expect(none.available).toBe(false);
    expect(await none.load('x', bytes())).toBe(false);
    expect(none.play('x')).toBe(false);
    expect(none.playMusic('x')).toBe(false);
  });
});
