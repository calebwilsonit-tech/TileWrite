import { describe, expect, it } from 'vitest';
import { decodePng } from '@tilewright/runtime';
import { analyse, decodeWav, describeLevels, measure, mp3Info, tagLoops, type Decoded } from './audio';

const u16 = (n: number): number[] => [n & 255, (n >> 8) & 255];
const u32 = (n: number): number[] => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
const text = (s: string): number[] => [...s].map((c) => c.charCodeAt(0));

/** A mono 16-bit WAV: `silence` seconds of nothing, then a sine at `amp` for `tone` seconds; optionally a sampler chunk with one loop. */
function wav(opts: { rate?: number; silence?: number; tone: number; amp: number; tail?: number; loop?: [number, number]; channels?: 1 | 2 }): Uint8Array {
  const rate = opts.rate ?? 8000;
  const channels = opts.channels ?? 1;
  const lead = Math.round((opts.silence ?? 0) * rate);
  const body = Math.round(opts.tone * rate);
  const tail = Math.round((opts.tail ?? 0) * rate);
  const frames = lead + body + tail;
  const samples: number[] = [];
  for (let i = 0; i < frames; i++) {
    const v = i >= lead && i < lead + body ? Math.round(Math.sin((2 * Math.PI * 440 * (i - lead)) / rate) * opts.amp * 32767) : 0;
    for (let c = 0; c < channels; c++) samples.push(...u16(v & 0xffff));
  }
  const fmt = [...text('fmt '), ...u32(16), ...u16(1), ...u16(channels), ...u32(rate), ...u32(rate * channels * 2), ...u16(channels * 2), ...u16(16)];
  const data = [...text('data'), ...u32(samples.length), ...samples];
  // the sampler chunk's fixed part is 36 bytes (nine numbers: the loop count is the eighth), then 24 bytes for each loop
  const smpl = opts.loop ? [...text('smpl'), ...u32(36 + 24), ...u32(0), ...u32(0), ...u32(0), ...u32(60), ...u32(0), ...u32(0), ...u32(0), ...u32(1), ...u32(0), ...u32(0), ...u32(0), ...u32(opts.loop[0]), ...u32(opts.loop[1]), ...u32(0), ...u32(0)] : [];
  const parts = [...fmt, ...smpl, ...data];
  return new Uint8Array([...text('RIFF'), ...u32(4 + parts.length), ...text('WAVE'), ...parts]);
}

describe('WAV files', () => {
  it('are read to their samples, with their length, format and loop points', () => {
    const file = wav({ tone: 1, amp: 0.5, loop: [2000, 7000] });
    const r = decodeWav(file)!;
    expect(r.info).toMatchObject({ format: 'WAV', sampleRate: 8000, channels: 1, bits: 16 });
    expect(r.info.seconds).toBeCloseTo(1, 3);
    expect(r.info.loops).toEqual([{ start: 2000, end: 7000, source: 'the sampler chunk of the WAV file' }]);
    expect(r.decoded.channels[0]!.length).toBe(8000);
    expect(Math.max(...r.decoded.channels[0]!)).toBeCloseTo(0.5, 2);
    expect(decodeWav(new Uint8Array(10))).toBeNull();
  });
});

describe('measuring a sound', () => {
  it('gives the peak and the average in decibels, and the silence at each end', () => {
    const r = decodeWav(wav({ silence: 0.2, tone: 1, amp: 0.5, tail: 0.4 }))!;
    const lv = measure(r.decoded);
    expect(lv.seconds).toBeCloseTo(1.6, 2);
    expect(lv.peakDb).toBeCloseTo(-6.02, 1);
    // a sine's average is 0.707 of its peak (-3 dB) over the part where it plays; over the whole file the silence lowers it
    expect(lv.loudestDb).toBeCloseTo(-9.03, 0);
    expect(lv.rmsDb).toBeLessThan(lv.loudestDb);
    expect(lv.leadSilence).toBeCloseTo(0.2, 1);
    expect(lv.trailSilence).toBeCloseTo(0.4, 1);
    expect(lv.clipped).toBe(0);
    expect(lv.silent).toBe(false);
  });

  it('says when a sound clips, when it is silent, and when one ear is nearly empty', () => {
    expect(measure(decodeWav(wav({ tone: 0.5, amp: 1 }))!.decoded).clipped).toBeGreaterThan(0);
    const nothing = measure({ sampleRate: 8000, channels: [new Float32Array(800)] });
    expect(nothing.silent).toBe(true);
    expect(nothing.peakDb).toBe(-Infinity);
    const loud = new Float32Array(800).fill(0.5);
    const quiet = new Float32Array(800).fill(0.01);
    expect(measure({ sampleRate: 8000, channels: [loud, quiet] }).lopsided).toBe(true);
  });

  it('puts the numbers in words, and never says how it sounds', () => {
    const r = decodeWav(wav({ silence: 0.2, tone: 1, amp: 0.5, loop: [1600, 8000] }))!;
    const out = analyse('audio/jump.wav', r.info, r.decoded);
    expect(out.text).toContain('audio/jump.wav: a sound file (WAV), 1.20 s, mono, 8000 Hz, 16-bit');
    expect(out.text).toContain('peak -6.0 dBFS');
    expect(out.text).toContain('It does not clip');
    expect(out.text).toContain('Loop point from 0.200 s to 1.000 s');
    expect(out.text).toContain('I cannot listen to sound');
    const picture = decodePng(out.png);
    expect(picture.width).toBe(900);
    expect(picture.height).toBeGreaterThan(150);
    expect(describeLevels('a.wav', { format: 'WAV', loops: [], cues: [] }, null)).toContain('No loop points are stored');
  });

  it('draws a lane for each ear', () => {
    const mono = analyse('a.wav', { format: 'WAV', loops: [], cues: [] }, { sampleRate: 8000, channels: [new Float32Array(800).fill(0.3)] }).png;
    const stereo = analyse('a.wav', { format: 'WAV', loops: [], cues: [] }, { sampleRate: 8000, channels: [new Float32Array(800).fill(0.3), new Float32Array(800).fill(0.1)] } satisfies Decoded).png;
    expect(decodePng(stereo).height).toBeGreaterThan(decodePng(mono).height);
  });
});

describe('MP3 files', () => {
  /** MPEG 1 layer III, 128 kbps, 44100 Hz, stereo: frames of 417 bytes. */
  const frame = (): number[] => [0xff, 0xfb, 0x90, 0x00, ...new Array<number>(413).fill(0)];

  it('have their length worked out from the bitrate, as they have no length field', () => {
    const file = new Uint8Array(Array.from({ length: 100 }, frame).flat());
    const info = mp3Info(file)!;
    expect(info).toMatchObject({ format: 'MP3', sampleRate: 44100, channels: 2, bitrateKbps: 128 });
    expect(info.seconds).toBeCloseTo((417 * 100 * 8) / 128000, 2);
  });

  it('have it exactly from the frame count when a variable-bitrate header gives one, after a tag at the front', () => {
    const first = frame();
    first.splice(4 + 32, 12, ...text('Xing'), 0, 0, 0, 1, ...[0, 0, 0, 200]); // flags: frame count present; 200 frames
    const tag = [...text('ID3'), 3, 0, 0, 0, 0, 0, 20, ...new Array<number>(20).fill(0)];
    const info = mp3Info(new Uint8Array([...tag, ...first, ...Array.from({ length: 10 }, frame).flat()]))!;
    expect(info.vbr).toBe(true);
    expect(info.seconds).toBeCloseTo((200 * 1152) / 44100, 3);
    expect(mp3Info(new Uint8Array(500))).toBeNull();
  });
});

describe('loop points written in tags', () => {
  it('are found as start and length, or start and end', () => {
    expect(tagLoops(new Uint8Array(text('OggS...LOOPSTART=44100\u0000LOOPLENGTH=88200'))) ).toEqual([{ start: 44100, end: 132300, source: 'the LOOPSTART tags of the file' }]);
    expect(tagLoops(new Uint8Array(text('loop_start=100 LOOP_END=900')))[0]).toMatchObject({ start: 100, end: 900 });
    expect(tagLoops(new Uint8Array(text('LOOPSTART=5')))[0]!.end).toBe(-1);
    expect(tagLoops(new Uint8Array(text('nothing here')))).toEqual([]);
  });
});
