import { Canvas, shade } from './preview/canvas';

/**
 * Sound for Claude, who cannot listen: what can be measured and seen instead. How long it is (also for MP3, which has no
 * length field), how loud (peak and average, in decibels below the loudest a file can hold), whether it clips, how much silence
 * is at each end, the loop points stored in the file, and a picture of its waveform with time marks. All of it is pure maths on
 * the samples; decoding a compressed file into samples is the window's job (`audio-browser.ts`), WAV is read here.
 */

export interface Decoded {
  sampleRate: number;
  /** One array per channel, samples from -1 to 1. */
  channels: Float32Array[];
}

export interface LoopPoint {
  /** In samples. */
  start: number;
  end: number;
  source: string;
}

export interface FileInfo {
  format: string;
  /** Seconds, when the file says. */
  seconds?: number;
  sampleRate?: number;
  channels?: number;
  bits?: number;
  bitrateKbps?: number;
  vbr?: boolean;
  loops: LoopPoint[];
  /** Positions of cue points, in samples. */
  cues: number[];
}

const u32 = (dv: DataView, o: number): number => dv.getUint32(o, true);
const tag = (b: Uint8Array, o: number, n: number): string => String.fromCharCode(...b.subarray(o, o + n));

// ---- WAV ----

/** The samples of a WAV file (PCM of 8, 16, 24 or 32 bits, or 32 and 64-bit float), with its loop and cue points. Null when it is not one this can read. */
export function decodeWav(bytes: Uint8Array): { decoded: Decoded; info: FileInfo } | null {
  if (bytes.length < 44 || tag(bytes, 0, 4) !== 'RIFF' || tag(bytes, 8, 4) !== 'WAVE') return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let fmt: { tag: number; channels: number; rate: number; bits: number } | null = null;
  let dataAt = -1;
  let dataLen = 0;
  const loops: LoopPoint[] = [];
  const cues: number[] = [];
  for (let at = 12; at + 8 <= bytes.length; ) {
    const id = tag(bytes, at, 4);
    const size = u32(dv, at + 4);
    const body = at + 8;
    if (id === 'fmt ' && body + 16 <= bytes.length) {
      let t = dv.getUint16(body, true);
      if (t === 0xfffe && size >= 26) t = dv.getUint16(body + 24, true); // extensible: the real format is the sub-format's first two bytes
      fmt = { tag: t, channels: dv.getUint16(body + 2, true), rate: u32(dv, body + 4), bits: dv.getUint16(body + 14, true) };
    } else if (id === 'data') {
      dataAt = body;
      dataLen = Math.min(size, bytes.length - body);
    } else if (id === 'smpl' && body + 36 <= bytes.length) {
      const n = Math.min(u32(dv, body + 28), 16);
      for (let i = 0; i < n && body + 36 + i * 24 + 24 <= bytes.length; i++) loops.push({ start: u32(dv, body + 36 + i * 24 + 8), end: u32(dv, body + 36 + i * 24 + 12), source: 'the sampler chunk of the WAV file' });
    } else if (id === 'cue ' && body + 4 <= bytes.length) {
      const n = Math.min(u32(dv, body), 64);
      for (let i = 0; i < n && body + 4 + i * 24 + 24 <= bytes.length; i++) cues.push(u32(dv, body + 4 + i * 24 + 20));
    }
    at = body + size + (size & 1);
  }
  if (!fmt || dataAt < 0 || fmt.channels < 1 || fmt.rate < 1) return null;
  const isFloat = fmt.tag === 3;
  if (!(fmt.tag === 1 || isFloat) || ![8, 16, 24, 32, 64].includes(fmt.bits) || (isFloat && fmt.bits !== 32 && fmt.bits !== 64)) return null;
  const bytesPer = fmt.bits / 8;
  const frames = Math.floor(dataLen / (bytesPer * fmt.channels));
  const channels = Array.from({ length: fmt.channels }, () => new Float32Array(frames));
  for (let f = 0; f < frames; f++) {
    for (let c = 0; c < fmt.channels; c++) {
      const o = dataAt + (f * fmt.channels + c) * bytesPer;
      let v: number;
      if (isFloat) v = fmt.bits === 32 ? dv.getFloat32(o, true) : dv.getFloat64(o, true);
      else if (fmt.bits === 8) v = (bytes[o]! - 128) / 128;
      else if (fmt.bits === 16) v = dv.getInt16(o, true) / 32768;
      else if (fmt.bits === 24) v = (((bytes[o]! | (bytes[o + 1]! << 8) | (bytes[o + 2]! << 16)) << 8) >> 8) / 8388608;
      else v = dv.getInt32(o, true) / 2147483648;
      channels[c]![f] = v;
    }
  }
  return {
    decoded: { sampleRate: fmt.rate, channels },
    info: { format: 'WAV', seconds: frames / fmt.rate, sampleRate: fmt.rate, channels: fmt.channels, bits: fmt.bits, loops, cues },
  };
}

// ---- MP3 ----

const BITRATES: Record<string, number[]> = {
  '1-1': [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  '1-2': [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  '1-3': [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  '2-1': [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  '2-2': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
  '2-3': [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
const RATES: Record<number, number[]> = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** The length of an MP3 (they have no length field: it is the frame count of the VBR header, or the size over the bitrate). */
export function mp3Info(bytes: Uint8Array): FileInfo | null {
  let start = 0;
  if (bytes.length > 10 && tag(bytes, 0, 3) === 'ID3') start = 10 + (((bytes[6]! & 127) << 21) | ((bytes[7]! & 127) << 14) | ((bytes[8]! & 127) << 7) | (bytes[9]! & 127)) + ((bytes[5]! & 16) !== 0 ? 10 : 0);
  let end = bytes.length;
  if (end - 128 >= start && tag(bytes, end - 128, 3) === 'TAG') end -= 128;
  for (let i = start; i + 4 < Math.min(end, start + 200_000); i++) {
    if (bytes[i] !== 0xff || (bytes[i + 1]! & 0xe0) !== 0xe0) continue;
    const version = (bytes[i + 1]! >> 3) & 3; // 3 = MPEG 1, 2 = MPEG 2, 0 = MPEG 2.5
    const layer = 4 - ((bytes[i + 1]! >> 1) & 3); // 1, 2 or 3
    const bitrateIndex = bytes[i + 2]! >> 4;
    const rateIndex = (bytes[i + 2]! >> 2) & 3;
    if (version === 1 || layer === 4 || bitrateIndex === 0 || bitrateIndex === 15 || rateIndex === 3) continue;
    const table = BITRATES[`${version === 3 ? 1 : 2}-${layer}`];
    const rate = RATES[version]?.[rateIndex];
    const kbps = table?.[bitrateIndex];
    if (!rate || !kbps) continue;
    const channels = ((bytes[i + 3]! >> 6) & 3) === 3 ? 1 : 2;
    const perFrame = layer === 1 ? 384 : layer === 3 && version !== 3 ? 576 : 1152;
    const side = version === 3 ? (channels === 1 ? 17 : 32) : channels === 1 ? 9 : 17;
    const xing = i + 4 + side;
    let frames = 0;
    let vbr = false;
    if (xing + 12 <= end && (tag(bytes, xing, 4) === 'Xing' || tag(bytes, xing, 4) === 'Info')) {
      const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      if ((dv.getUint32(xing + 4) & 1) !== 0) frames = dv.getUint32(xing + 8);
      vbr = tag(bytes, xing, 4) === 'Xing';
    } else if (i + 4 + 32 + 18 <= end && tag(bytes, i + 4 + 32, 4) === 'VBRI') {
      frames = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(i + 4 + 32 + 14);
      vbr = true;
    }
    const seconds = frames > 0 ? (frames * perFrame) / rate : ((end - i) * 8) / (kbps * 1000);
    return { format: 'MP3', seconds, sampleRate: rate, channels, bitrateKbps: kbps, vbr, loops: [], cues: [] };
  }
  return null;
}

// ---- OGG and others: loop points written in the file's tags ----

/** LOOPSTART / LOOPLENGTH (or LOOPEND) tags, as game music is usually marked in OGG and FLAC files. */
export function tagLoops(bytes: Uint8Array): LoopPoint[] {
  const head = tag(bytes, 0, Math.min(bytes.length, 160_000));
  const num = (names: string[]): number | null => {
    for (const n of names) {
      const m = new RegExp(`${n}=(\\d{1,12})`, 'i').exec(head);
      if (m) return Number(m[1]);
    }
    return null;
  };
  const start = num(['LOOPSTART', 'LOOP_START']);
  if (start === null) return [];
  const length = num(['LOOPLENGTH', 'LOOP_LENGTH']);
  const end = num(['LOOPEND', 'LOOP_END']) ?? (length !== null ? start + length : null);
  return end !== null ? [{ start, end, source: 'the LOOPSTART tags of the file' }] : [{ start, end: -1, source: 'the LOOPSTART tag of the file (it has no end: the sound loops to its end)' }];
}

// ---- measuring ----

export interface Levels {
  seconds: number;
  /** Decibels below full scale (0 is the loudest a file can hold). -Infinity for silence. */
  peakDb: number;
  rmsDb: number;
  /** The loudest half second's average level. */
  loudestDb: number;
  clipped: number;
  /** Seconds of near-silence (under -60 dB) at the start and the end. */
  leadSilence: number;
  trailSilence: number;
  /** The sound is all silence. */
  silent: boolean;
  /** One channel is much louder than the other (a sound that is almost mono in one ear). */
  lopsided: boolean;
}

const db = (x: number): number => (x <= 1e-9 ? -Infinity : 20 * Math.log10(x));

export function measure(d: Decoded): Levels {
  const n = d.channels[0]?.length ?? 0;
  const seconds = n / d.sampleRate;
  let peak = 0;
  let sum = 0;
  let clipped = 0;
  const perChannel = d.channels.map((ch) => {
    let s = 0;
    for (let i = 0; i < ch.length; i++) s += ch[i]! * ch[i]!;
    return Math.sqrt(s / Math.max(1, ch.length));
  });
  const SILENT = 0.001; // -60 dB
  let first = -1;
  let last = -1;
  for (let i = 0; i < n; i++) {
    let loud = 0;
    for (const ch of d.channels) {
      const v = Math.abs(ch[i]!);
      sum += v * v;
      if (v > peak) peak = v;
      if (v >= 0.9995) clipped++;
      if (v > loud) loud = v;
    }
    if (loud > SILENT) {
      if (first < 0) first = i;
      last = i;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n * d.channels.length));
  // the loudest half second, by summing squares over a sliding window of a quarter-second steps
  const win = Math.max(1, Math.round(d.sampleRate * 0.5));
  const step = Math.max(1, Math.round(d.sampleRate * 0.1));
  let loudest = 0;
  for (let at = 0; at < Math.max(1, n - win + step); at += step) {
    let s = 0;
    const to = Math.min(n, at + win);
    for (const ch of d.channels) for (let i = at; i < to; i++) s += ch[i]! * ch[i]!;
    loudest = Math.max(loudest, Math.sqrt(s / Math.max(1, (to - at) * d.channels.length)));
  }
  const loud = Math.max(...perChannel);
  const quiet = Math.min(...perChannel);
  return {
    seconds,
    peakDb: db(peak),
    rmsDb: db(rms),
    loudestDb: db(loudest),
    clipped,
    leadSilence: first < 0 ? seconds : first / d.sampleRate,
    trailSilence: first < 0 ? 0 : (n - 1 - last) / d.sampleRate,
    silent: first < 0,
    lopsided: d.channels.length === 2 && loud > 0.001 && quiet < loud * 0.1,
  };
}

const fmtDb = (v: number): string => (v === -Infinity ? 'silent' : `${v.toFixed(1)} dBFS`);
const fmtSec = (s: number): string => (s >= 60 ? `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}` : `${s.toFixed(s < 10 ? 2 : 1)} s`);

/** What the measurements say, in words (and what they cannot). */
export function describeLevels(path: string, info: FileInfo, lv: Levels | null, extra: { converted?: string } = {}): string {
  const facts: string[] = [];
  const sec = lv?.seconds ?? info.seconds;
  facts.push(`${path}: a sound file (${info.format})${sec !== undefined ? `, ${fmtSec(sec)}` : ''}${info.channels ? `, ${info.channels === 1 ? 'mono' : info.channels === 2 ? 'stereo' : `${info.channels} channels`}` : ''}${info.sampleRate ? `, ${info.sampleRate} Hz` : ''}${info.bits ? `, ${info.bits}-bit` : ''}${info.bitrateKbps ? `, ${info.bitrateKbps} kbps${info.vbr ? ' (variable)' : ''}` : ''}.`);
  if (extra.converted) facts.push(extra.converted);
  if (lv) {
    if (lv.silent) facts.push('It is silent: nothing in it rises above -60 dBFS.');
    else {
      facts.push(`Levels: peak ${fmtDb(lv.peakDb)}, average (RMS) ${fmtDb(lv.rmsDb)}, loudest half second ${fmtDb(lv.loudestDb)}. (0 dBFS is the loudest a file can hold; game sounds are usually between -3 and -12 at the peak.)`);
      facts.push(lv.clipped > 0 ? `${lv.clipped} sample${lv.clipped === 1 ? '' : 's'} reach the top: it is clipped, which sounds like crackling.` : 'It does not clip.');
      if (lv.leadSilence > 0.05 || lv.trailSilence > 0.05) facts.push(`Silence at the start: ${lv.leadSilence.toFixed(2)} s; at the end: ${lv.trailSilence.toFixed(2)} s (under -60 dBFS).`);
      if (lv.lopsided) facts.push('One channel is far quieter than the other.');
    }
  }
  const rate = info.sampleRate;
  if (info.loops.length > 0 && rate) {
    for (const l of info.loops) facts.push(l.end >= 0 ? `Loop point from ${(l.start / rate).toFixed(3)} s to ${(l.end / rate).toFixed(3)} s (samples ${l.start} to ${l.end}), from ${l.source}.` : `Loop starts at ${(l.start / rate).toFixed(3)} s, from ${l.source}.`);
  } else facts.push('No loop points are stored in the file (the project can still set them in the sound mix).');
  if (info.cues.length > 0 && rate) facts.push(`Cue points at: ${info.cues.slice(0, 8).map((c) => `${(c / rate).toFixed(2)} s`).join(', ')}.`);
  if (lv) facts.push('The picture is its waveform: time runs left to right, the height of the shape is how loud, the dark ends are silence.');
  facts.push('I cannot listen to sound, so I cannot tell you what it sounds like, whether it fits the scene, or whether it is good. Only the measurements and the picture above are known. If you describe it, I will take your word for it.');
  return facts.join(' ');
}

// ---- the picture ----

/** The step between time marks that gives about eight marks across. */
function niceStep(seconds: number): number {
  const steps = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300];
  return steps.find((s) => seconds / s <= 9) ?? 600;
}

export function waveformPicture(d: Decoded, loops: readonly LoopPoint[], lv: Levels, width = 900): Uint8Array {
  const lanes = d.channels.length <= 2 ? d.channels : [mixDown(d.channels)];
  const laneH = lanes.length === 1 ? 150 : 100;
  const height = 24 + lanes.length * (laneH + 6) + 22;
  const c = new Canvas(width, height, 0x14161b);
  const n = d.channels[0]?.length ?? 0;
  const left = 8;
  const w = width - 16;
  lanes.forEach((ch, li) => {
    const top = 20 + li * (laneH + 6);
    const mid = top + laneH / 2;
    c.rect(left, top, w, laneH, 0x1c2027);
    c.line(left, mid, left + w - 1, mid, 0x2c313b);
    for (let x = 0; x < w; x++) {
      const a = Math.floor((x * n) / w);
      const b = Math.max(a + 1, Math.floor(((x + 1) * n) / w));
      let lo = 0;
      let hi = 0;
      let sq = 0;
      for (let i = a; i < b; i++) {
        const v = ch[i] ?? 0;
        if (v < lo) lo = v;
        if (v > hi) hi = v;
        sq += v * v;
      }
      const rms = Math.sqrt(sq / (b - a));
      c.line(left + x, mid - hi * (laneH / 2 - 2), left + x, mid - lo * (laneH / 2 - 2), 0x4a86c8);
      c.line(left + x, mid - rms * (laneH / 2 - 2), left + x, mid + rms * (laneH / 2 - 2), 0x9cc4f0);
    }
    if (lanes.length === 2) c.text(left + 3, top + 3, li === 0 ? 'L' : 'R', 0x6f7a8c);
  });
  const bottom = 20 + lanes.length * (laneH + 6);
  // silence at each end
  const sx = (seconds: number): number => left + Math.min(w, Math.max(0, (seconds / lv.seconds) * w));
  if (!lv.silent && lv.leadSilence > 0.02) c.rect(left, 20, sx(lv.leadSilence) - left, bottom - 26, 0x000000, 0.35);
  if (!lv.silent && lv.trailSilence > 0.02) c.rect(sx(lv.seconds - lv.trailSilence), 20, left + w - sx(lv.seconds - lv.trailSilence), bottom - 26, 0x000000, 0.35);
  // time marks
  const step = niceStep(lv.seconds);
  for (let t = 0; t <= lv.seconds + 1e-6; t += step) {
    const x = sx(t);
    c.line(x, 18, x, bottom - 6, 0x3a404c);
    const label = t >= 60 ? `${Math.floor(t / 60)}:${String(Math.round(t % 60)).padStart(2, '0')}` : `${Number(t.toFixed(2))}S`;
    c.text(Math.min(x + 2, width - c.textWidth(label) - 4), bottom - 1, label, 0x8a93a3);
  }
  for (const l of loops) {
    const a = sx(l.start / d.sampleRate);
    c.line(a, 18, a, bottom - 6, 0x4cd07a);
    c.label(a + 3, 22, 'LOOP START', 0x4cd07a);
    if (l.end >= 0) {
      const b = sx(l.end / d.sampleRate);
      c.line(b, 18, b, bottom - 6, 0xe0605a);
      c.label(Math.max(left, b - c.textWidth('LOOP END') - 5), 34, 'LOOP END', 0xe0605a);
    }
  }
  c.text(8, 6, `${fmtSec(lv.seconds)}  PEAK ${fmtDb(lv.peakDb).toUpperCase()}`, shade(0x9cc4f0, 0.9));
  return c.toPng();
}

function mixDown(chs: Float32Array[]): Float32Array {
  const out = new Float32Array(chs[0]?.length ?? 0);
  for (const ch of chs) for (let i = 0; i < out.length; i++) out[i]! += (ch[i] ?? 0) / chs.length;
  return out;
}

/** Everything for a sound that has been decoded: the words and the picture. */
export function analyse(path: string, info: FileInfo, decoded: Decoded, extra: { converted?: string } = {}): { text: string; png: Uint8Array } {
  const lv = measure(decoded);
  const merged: FileInfo = { ...info, seconds: lv.seconds, sampleRate: info.sampleRate ?? decoded.sampleRate, channels: info.channels ?? decoded.channels.length };
  return { text: describeLevels(path, merged, lv, extra), png: waveformPicture(decoded, info.loops, lv) };
}
