import { describe, expect, it } from 'vitest';
import { AudioEngine, type AudioContextLike, type GainNodeLike, type SourceNodeLike } from './engine';
import { MixerSchema } from './mixer';

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
    expect(a.volumes).toEqual({ master: 1, music: 0, sfx: 0.5, voice: 1 });
    const values = ctx.gains.slice(0, 4).map((g) => g.gain.value);
    expect(values).toEqual([1, 0, 0.5, 1]); // master, music, sound effects, voice
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

describe('the project mix', () => {
  type Fake = ReturnType<typeof withPanner>;
  function withPanner() {
    const ctx = new FakeContext() as FakeContext & { panners: { pan: { value: number }; connected: unknown }[]; createStereoPanner(): { pan: { value: number; setValueAtTime(): void; linearRampToValueAtTime(): void; cancelScheduledValues(): void }; connect(to: unknown): void; disconnect(): void } };
    ctx.panners = [];
    ctx.createStereoPanner = () => {
      const p = { connected: null as unknown, pan: { value: 0, setValueAtTime: () => undefined, linearRampToValueAtTime: () => undefined, cancelScheduledValues: () => undefined }, connect(to: unknown) { this.connected = to; }, disconnect() {} };
      ctx.panners.push(p);
      return p;
    };
    return ctx;
  }
  const mix = (m: Record<string, unknown>) => MixerSchema.parse(m);
  const loud = async (random = () => 0.5): Promise<{ a: AudioEngine; ctx: Fake }> => {
    const ctx = withPanner();
    const a = new AudioEngine(() => ctx, random);
    for (const n of ['hit', 'hit2', 'hit3', 'voice', 'calm']) await a.load(n, bytes());
    return { a, ctx };
  };

  it('multiplies the player\'s volumes with the project\'s bus levels', async () => {
    const { a, ctx } = await loud();
    a.setMixer(mix({ buses: { master: 0.5, music: 0.8, sfx: 1.2, voice: 1 } }));
    a.setVolumes({ master: 0.8, music: 0.5, sfx: 0.5, voice: 1 });
    expect(ctx.gains.slice(0, 4).map((g) => g.gain.value)).toEqual([0.4, 0.4, 0.6, 1]);
  });

  it('uses the sound\'s own loudness, pitch drift and cooldown', async () => {
    const { a, ctx } = await loud(() => 1);
    a.setMixer(mix({ sounds: { hit: { volume: 0.5, pitchVariation: 0.2, cooldown: 1 } } }));
    expect(a.play('hit')).toBe(true);
    const rate = (ctx.sources[0] as unknown as { playbackRate: { value: number } }).playbackRate.value;
    expect(rate).toBeCloseTo(1.2, 5);
    const g = ctx.gains[ctx.gains.length - 1]!;
    expect(g.gain.value).toBeCloseTo(0.5);
    ctx.currentTime += 0.5;
    expect(a.play('hit')).toBe(false); // the cooldown is a second
    ctx.currentTime += 0.6;
    expect(a.play('hit')).toBe(true);
    expect(a.play('hit', 1, 0)).toBe(false);
  });

  it('picks one of the variants at random, and a missing variant falls back to the sound itself', async () => {
    const picks: number[] = [0, 0.4, 0.99];
    let i = 0;
    const ctx = withPanner();
    const a = new AudioEngine(() => ctx, () => picks[i++ % 3]!);
    const buffers: Record<string, number> = {};
    for (const n of ['hit', 'hit2', 'hit3']) {
      await a.load(n, bytes(10 + Object.keys(buffers).length));
      buffers[n] = 1;
    }
    a.setMixer(mix({ sounds: { hit: { variants: ['hit2', 'hit3', 'ghost'], cooldown: 0, pitchVariation: 0 } } }));
    const seen = new Set<unknown>();
    for (let n = 0; n < 8; n++) {
      ctx.currentTime += 1;
      a.play('hit');
      seen.add((ctx.sources[ctx.sources.length - 1]!.buffer as { length: number }).length);
    }
    expect(seen.size).toBeGreaterThan(1);
    for (const l of seen) expect([10, 11, 12]).toContain(l);
  });

  it('puts voices on their own bus and ducks the music while they play', async () => {
    const { a, ctx } = await loud();
    a.setMixer(mix({ ducking: { amount: 0.7, release: 2 }, sounds: { voice: { bus: 'voice' } } }));
    a.playMusic('calm');
    expect(a.voicesSpeaking).toBe(0);
    expect(a.play('voice')).toBe(true);
    expect(a.voicesSpeaking).toBe(1);
    const duck = ctx.gains[4]!; // after master, music, effects, voice
    expect(duck.ramps.some(([v]) => Math.abs(v - 0.3) < 1e-9)).toBe(true);
    const voiceGain = ctx.gains[ctx.gains.length - 1]!;
    expect(voiceGain.connected).toBe(ctx.gains[3]); // the voice bus
    ctx.sources[ctx.sources.length - 1]!.onended?.();
    expect(a.voicesSpeaking).toBe(0);
    expect(duck.ramps.some(([v, t]) => v === 1 && t >= 2)).toBe(true); // back up over the release time
    a.setMixer(mix({ ducking: { enabled: false }, sounds: { voice: { bus: 'voice' } } }));
    ctx.currentTime += 1;
    const before = duck.ramps.length;
    a.play('voice');
    expect(duck.ramps.length).toBe(before);
  });

  it('gives music its loop points, loudness and fade time', async () => {
    const { a, ctx } = await loud();
    a.setMixer(mix({ music: { calm: { volume: 0.5, loopStart: 2, loopEnd: 8, fade: 4 } } }));
    a.playMusic('calm');
    const s = ctx.sources[0]!;
    expect(s.loopStart).toBe(2);
    expect(s.loopEnd).toBe(8);
    const g = ctx.gains.find((x) => x.ramps.some(([v, t]) => v === 0.5 && t === 4))!;
    expect(g).toBeDefined();
    const plain = (await loud()).a;
    plain.playMusic('calm');
    expect(plain.currentMusic).toBe('calm');
  });

  it('places a sound left or right when the machine can, and plays it from the middle when it cannot', async () => {
    const { a, ctx } = await loud();
    a.play('hit', 1, 0, { pan: 0.6 });
    expect(ctx.panners[0]!.pan.value).toBeCloseTo(0.6);
    expect(ctx.panners[0]!.connected).toBe(ctx.gains[ctx.gains.length - 1]);
    const plain = engine();
    await plain.a.load('hit', bytes());
    expect(plain.a.play('hit', 1, 0, { pan: -1 })).toBe(true);
  });

  it('keeps looping sounds in the world matched to the request: start, follow, replace and stop', async () => {
    const { a, ctx } = await loud();
    const req = (name: string, gain: number, pan = 0) => ({ name, gain, pan });
    a.syncAmbient(new Map([['e1', req('calm', 0.5, -0.4)]]));
    expect(a.ambientKeys).toEqual(['e1']);
    expect(ctx.sources[0]!.loop).toBe(true);
    a.syncAmbient(new Map([['e1', req('calm', 0.2, 0.3)]]));
    expect(ctx.sources).toHaveLength(1); // the same loop carries on
    expect(ctx.panners[0]!.pan.value).toBeCloseTo(0.3);
    a.syncAmbient(new Map([['e1', req('hit', 1)]])); // another sound: the loop is replaced
    expect(ctx.sources).toHaveLength(2);
    expect(ctx.sources[0]!.stopped).not.toBeNull();
    a.syncAmbient(new Map([['e2', req('nothing', 1)]])); // no such file: nothing starts
    expect(a.ambientKeys).toEqual([]);
    a.syncAmbient(new Map([['e1', req('calm', 1)]]));
    a.stopAll();
    expect(a.ambientKeys).toEqual([]);
  });
});
