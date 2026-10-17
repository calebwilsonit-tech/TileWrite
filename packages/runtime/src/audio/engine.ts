/** The small part of the Web Audio API the engine uses, so tests can stand in a fake and nothing needs a sound card. */
export interface AudioParamLike {
  value: number;
  setValueAtTime(v: number, t: number): unknown;
  linearRampToValueAtTime(v: number, t: number): unknown;
  cancelScheduledValues(t: number): unknown;
}
export interface GainNodeLike {
  gain: AudioParamLike;
  connect(to: unknown): unknown;
  disconnect(): void;
}
export interface SourceNodeLike {
  buffer: unknown;
  playbackRate?: { value: number };
  loop: boolean;
  onended: (() => void) | null;
  connect(to: unknown): unknown;
  disconnect(): void;
  start(when?: number): void;
  stop(when?: number): void;
}
export interface AudioContextLike {
  readonly currentTime: number;
  readonly state: string;
  readonly destination: unknown;
  createGain(): GainNodeLike;
  createBufferSource(): SourceNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
}

/** Sound file types the engine accepts (what browsers and Electron decode). */
export const AUDIO_EXTENSIONS = ['wav', 'ogg', 'mp3', 'flac', 'm4a'];
/** Most one-shot sounds playing at once; further requests are dropped rather than turning to noise. */
const MAX_VOICES = 24;
/** The same sound cannot start twice within this many seconds (a swarm of hits is one hit). */
const MIN_GAP = 0.04;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

interface Music {
  name: string;
  gain: GainNodeLike;
  source: SourceNodeLike;
}

/**
 * Plays the game's sounds and music with Web Audio. Sounds are named after their files (`assets/audio/hit.ogg` is "hit"),
 * music loops and crossfades when it changes. A request for a sound that does not exist is ignored, so a game can ask for
 * "hit" and "hurt" and only has noise where its maker added files.
 */
export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private musicBus: GainNodeLike | null = null;
  private sfxBus: GainNodeLike | null = null;
  private readonly buffers = new Map<string, unknown>();
  private readonly lastPlayed = new Map<string, number>();
  private voices = 0;
  private music: Music | null = null;
  private vol: Volumes = { master: 1, music: 1, sfx: 1 };
  /** Things that went wrong (a file that would not decode...), for the Problems panel. */
  readonly problems: string[] = [];

  /** The second argument only varies the pitch of sound effects; it is never part of the game's state. */
  constructor(
    private readonly create: () => AudioContextLike | null = defaultContext,
    private readonly random: () => number = Math.random,
  ) {}

  /** Whether this machine can play sound at all. */
  get available(): boolean {
    return this.context() !== null;
  }

  private context(): AudioContextLike | null {
    if (this.ctx) return this.ctx;
    let c: AudioContextLike | null = null;
    try {
      c = this.create();
    } catch (e) {
      this.problems.push(`Sound is not available: ${(e as Error).message}`);
    }
    if (!c) return null;
    this.ctx = c;
    this.master = c.createGain();
    this.musicBus = c.createGain();
    this.sfxBus = c.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.master.connect(c.destination);
    this.applyVolumes();
    return c;
  }

  get volumes(): Volumes {
    return { ...this.vol };
  }

  setVolumes(v: Partial<Volumes>): void {
    this.vol = { master: clamp01(v.master ?? this.vol.master), music: clamp01(v.music ?? this.vol.music), sfx: clamp01(v.sfx ?? this.vol.sfx) };
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.master || !this.musicBus || !this.sfxBus) return;
    this.master.gain.value = this.vol.master;
    this.musicBus.gain.value = this.vol.music;
    this.sfxBus.gain.value = this.vol.sfx;
  }

  /** Browsers keep sound off until the player has pressed something: call this from a key or click. */
  async unlock(): Promise<void> {
    const c = this.context();
    if (c && c.state === 'suspended') await c.resume().catch(() => undefined);
  }

  /** Decode a sound file and keep it under `name`. Returns false (and records a problem) when it cannot be played. */
  async load(name: string, bytes: Uint8Array): Promise<boolean> {
    const c = this.context();
    if (!c) return false;
    try {
      // decodeAudioData takes ownership of the buffer it is given, so give it a copy
      const copy = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
      this.buffers.set(name, await c.decodeAudioData(copy));
      return true;
    } catch (e) {
      this.problems.push(`The sound "${name}" could not be read: ${(e as Error).message || 'it may be damaged or in a format this computer cannot play'}.`);
      return false;
    }
  }

  has(name: string): boolean {
    return this.buffers.has(name);
  }

  names(): string[] {
    return [...this.buffers.keys()].sort((a, b) => a.localeCompare(b));
  }
  /** Play a sound once, a little higher or lower each time (the third argument is the most it drifts, 0.05 = 5%) so repeats do not sound mechanical. Returns whether it started. */
  /** Play a sound once, a little higher or lower each time (the third argument is the most it drifts, 0.05 = 5%) so repeats do not sound mechanical. Returns whether it started. */
  play(name: string, volume = 1, variation = 0.05): boolean {
    const c = this.ctx;
    const buffer = this.buffers.get(name);
    if (!c || !this.sfxBus || buffer === undefined || this.voices >= MAX_VOICES) return false;
    const last = this.lastPlayed.get(name);
    if (last !== undefined && c.currentTime - last < MIN_GAP) return false;
    this.lastPlayed.set(name, c.currentTime);
    const g = c.createGain();
    g.gain.value = clamp01(volume);
    g.connect(this.sfxBus);
    const s = c.createBufferSource();
    s.buffer = buffer;
    s.loop = false;
    if (s.playbackRate && variation > 0) s.playbackRate.value = 1 + (this.random() * 2 - 1) * Math.min(0.5, variation);
    s.connect(g);
    this.voices++;
    s.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      s.disconnect();
      g.disconnect();
    };
    s.start();
    return true;
  }

  /** The music that is playing (or fading in), or ''. */
  get currentMusic(): string {
    return this.music?.name ?? '';
  }

  /**
   * Change the music: the old track fades out as the new one fades in. The same track asking again changes nothing,
   * and '' fades the music out. A name with no file is ignored (the old music carries on).
   */
  playMusic(name: string, fadeSeconds = 1): boolean {
    const c = this.context();
    if (!c || !this.musicBus) return false;
    if (name === this.currentMusic) return false;
    if (name !== '' && !this.buffers.has(name)) return false;
    const now = c.currentTime;
    const fade = Math.max(0.01, fadeSeconds);
    const old = this.music;
    if (old) {
      old.gain.gain.cancelScheduledValues(now);
      old.gain.gain.setValueAtTime(old.gain.gain.value, now);
      old.gain.gain.linearRampToValueAtTime(0, now + fade);
      old.source.stop(now + fade + 0.05);
      old.source.onended = () => {
        old.source.disconnect();
        old.gain.disconnect();
      };
    }
    this.music = null;
    if (name === '') return true;
    const g = c.createGain();
    g.gain.value = 0;
    g.gain.setValueAtTime(0, now);
    g.gain.linearRampToValueAtTime(1, now + fade);
    g.connect(this.musicBus);
    const s = c.createBufferSource();
    s.buffer = this.buffers.get(name);
    s.loop = true;
    s.connect(g);
    s.start();
    this.music = { name, gain: g, source: s };
    return true;
  }

  stopAll(): void {
    this.playMusic('', 0.05);
  }

  dispose(): void {
    const c = this.ctx;
    this.ctx = null;
    this.music = null;
    this.buffers.clear();
    void c?.close().catch(() => undefined);
  }
}

function defaultContext(): AudioContextLike | null {
  const g = globalThis as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}
