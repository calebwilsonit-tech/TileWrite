import { newMixer, pickVariant, type MixerData, type MusicSettings, type SoundSettings } from './mixer';

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
export interface PannerNodeLike {
  pan: AudioParamLike;
  connect(to: unknown): unknown;
  disconnect(): void;
}
export interface SourceNodeLike {
  buffer: unknown;
  playbackRate?: { value: number };
  loop: boolean;
  /** Where a looping source jumps back to and where it ends, in seconds (Web Audio's `loopStart` and `loopEnd`). */
  loopStart?: number;
  loopEnd?: number;
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
  /** Left-right placement of a sound (not every machine has it; sounds then play from the middle). */
  createStereoPanner?(): PannerNodeLike;
  decodeAudioData(data: ArrayBuffer): Promise<unknown>;
  resume(): Promise<void>;
  close(): Promise<void>;
}

export interface Volumes {
  master: number;
  music: number;
  sfx: number;
  voice: number;
}

/** Sound file types the engine accepts (what browsers and Electron decode). */
export const AUDIO_EXTENSIONS = ['wav', 'ogg', 'mp3', 'flac', 'm4a'];
/** Most one-shot sounds playing at once; further requests are dropped rather than turning to noise. */
const MAX_VOICES = 24;

const clamp01 = (v: number): number => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0);

interface Music {
  name: string;
  gain: GainNodeLike;
  source: SourceNodeLike;
}

interface Ambient {
  name: string;
  source: SourceNodeLike;
  gain: GainNodeLike;
  panner: PannerNodeLike | null;
}

/** What a looping sound placed in the world asks for each frame (see `syncAmbient`). */
export interface AmbientRequest {
  name: string;
  /** 0 to 1, after distance. */
  gain: number;
  /** -1 (left) to 1 (right). */
  pan: number;
}

export interface PlayOptions {
  /** Left (-1) to right (1). */
  pan?: number;
}

/**
 * Plays the game's sounds and music with Web Audio. Sounds are named after their files (`assets/audio/hit.ogg` is "hit"),
 * music loops (with loop points, if the mix gives them) and crossfades when it changes. A request for a sound that does
 * not exist is ignored, so a game can ask for "hit" and "hurt" and only has noise where its maker added files.
 *
 * Four buses (master, music, sound effects, voice) carry the player's volumes times the project's levels; voices push
 * the music down while they play (ducking); the project's mix (`MixerData`) gives each sound its loudness, bus, drift,
 * cooldown and list of variants.
 */
export class AudioEngine {
  private ctx: AudioContextLike | null = null;
  private master: GainNodeLike | null = null;
  private musicBus: GainNodeLike | null = null;
  private sfxBus: GainNodeLike | null = null;
  private voiceBus: GainNodeLike | null = null;
  /** Music tracks go through this one, which is what ducking turns down. */
  private duck: GainNodeLike | null = null;
  private readonly buffers = new Map<string, unknown>();
  private readonly lastPlayed = new Map<string, number>();
  private readonly ambient = new Map<string, Ambient>();
  private voices = 0;
  private speaking = 0;
  private music: Music | null = null;
  private vol: Volumes = { master: 1, music: 1, sfx: 1, voice: 1 };
  private mix: MixerData = newMixer();
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
    this.voiceBus = c.createGain();
    this.duck = c.createGain();
    this.duck.connect(this.musicBus);
    this.musicBus.connect(this.master);
    this.sfxBus.connect(this.master);
    this.voiceBus.connect(this.master);
    this.master.connect(c.destination);
    this.applyVolumes();
    return c;
  }

  get volumes(): Volumes {
    return { ...this.vol };
  }

  setVolumes(v: Partial<Volumes>): void {
    this.vol = { master: clamp01(v.master ?? this.vol.master), music: clamp01(v.music ?? this.vol.music), sfx: clamp01(v.sfx ?? this.vol.sfx), voice: clamp01(v.voice ?? this.vol.voice) };
    this.applyVolumes();
  }

  get mixer(): MixerData {
    return this.mix;
  }

  /** Use the project's mix from now on (sounds already playing finish as they were). */
  setMixer(m: MixerData | null): void {
    this.mix = m ?? newMixer();
    this.applyVolumes();
  }

  private applyVolumes(): void {
    if (!this.master || !this.musicBus || !this.sfxBus || !this.voiceBus) return;
    const b = this.mix.buses;
    this.master.gain.value = this.vol.master * b.master;
    this.musicBus.gain.value = this.vol.music * b.music;
    this.sfxBus.gain.value = this.vol.sfx * b.sfx;
    this.voiceBus.gain.value = this.vol.voice * b.voice;
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

  /** The length of a loaded sound in seconds, if the sound card said (for placing loop points). */
  durationOf(name: string): number | null {
    const b = this.buffers.get(name) as { duration?: number } | undefined;
    return typeof b?.duration === 'number' ? b.duration : null;
  }

  /** The settings the mix gives a sound (the defaults when it has none). */
  private soundSettings(name: string): SoundSettings {
    return this.mix.sounds[name] ?? { volume: 1, bus: 'sfx', pitchVariation: 0.05, volumeVariation: 0, cooldown: 0.04, variants: [] };
  }

  private ramp(g: GainNodeLike, to: number, seconds: number): void {
    const c = this.ctx;
    if (!c) return;
    const now = c.currentTime;
    g.gain.cancelScheduledValues(now);
    g.gain.setValueAtTime(g.gain.value, now);
    g.gain.linearRampToValueAtTime(to, now + Math.max(0.01, seconds));
  }

  /**
   * Play a sound once. `variation` is the most the pitch drifts (0.05 = 5 percent); without it the sound's own setting in
   * the mix is used. The mix may also change the loudness and the bus, pick one of several variants, and limit how often the
   * sound can repeat. Returns whether it started.
   */
  play(name: string, volume = 1, variation?: number, opts: PlayOptions = {}): boolean {
    const c = this.ctx;
    if (!c || !this.sfxBus || !this.voiceBus || this.voices >= MAX_VOICES) return false;
    const settings = this.soundSettings(name);
    const last = this.lastPlayed.get(name);
    if (last !== undefined && c.currentTime - last < settings.cooldown) return false;
    let chosen = pickVariant(this.mix, name, this.random);
    if (!this.buffers.has(chosen)) chosen = name;
    const buffer = this.buffers.get(chosen);
    if (buffer === undefined) return false;
    this.lastPlayed.set(name, c.currentTime);
    const voice = settings.bus === 'voice';
    const g = c.createGain();
    const drop = settings.volumeVariation > 0 ? 1 - this.random() * settings.volumeVariation : 1;
    g.gain.value = Math.max(0, Math.min(2, volume * settings.volume * drop));
    g.connect(voice ? this.voiceBus : this.sfxBus);
    let tail: GainNodeLike | PannerNodeLike = g;
    let panner: PannerNodeLike | null = null;
    if (opts.pan !== undefined && c.createStereoPanner) {
      panner = c.createStereoPanner();
      panner.pan.value = Math.max(-1, Math.min(1, opts.pan));
      panner.connect(g);
      tail = panner;
    }
    const s = c.createBufferSource();
    s.buffer = buffer;
    s.loop = false;
    const drift = variation ?? settings.pitchVariation;
    if (s.playbackRate && drift > 0) s.playbackRate.value = 1 + (this.random() * 2 - 1) * Math.min(0.5, drift);
    s.connect(tail);
    this.voices++;
    if (voice) this.startSpeaking();
    s.onended = () => {
      this.voices = Math.max(0, this.voices - 1);
      if (voice) this.stopSpeaking();
      s.disconnect();
      panner?.disconnect();
      g.disconnect();
    };
    s.start();
    return true;
  }

  private startSpeaking(): void {
    this.speaking++;
    const d = this.mix.ducking;
    if (this.speaking === 1 && d.enabled && this.duck) this.ramp(this.duck, 1 - d.amount, d.attack);
  }

  private stopSpeaking(): void {
    this.speaking = Math.max(0, this.speaking - 1);
    if (this.speaking === 0 && this.duck) this.ramp(this.duck, 1, this.mix.ducking.release);
  }

  /** How many voice-bus sounds are playing now (the music is ducked while this is above zero). */
  get voicesSpeaking(): number {
    return this.speaking;
  }

  /** The music that is playing (or fading in), or ''. */
  get currentMusic(): string {
    return this.music?.name ?? '';
  }

  private musicSettings(name: string): MusicSettings {
    return this.mix.music[name] ?? { volume: 1, loopStart: 0, loopEnd: 0, fade: 1 };
  }

  /**
   * Change the music: the old track fades out as the new one fades in (the time is the track's own setting in the mix,
   * unless given). The same track asking again changes nothing, and '' fades the music out. A name with no file is
   * ignored (the old music carries on).
   */
  playMusic(name: string, fadeSeconds?: number): boolean {
    const c = this.context();
    if (!c || !this.duck) return false;
    if (name === this.currentMusic) return false;
    if (name !== '' && !this.buffers.has(name)) return false;
    const now = c.currentTime;
    const settings = this.musicSettings(name);
    const fade = Math.max(0.01, fadeSeconds ?? (name === '' && this.music ? this.musicSettings(this.music.name).fade : settings.fade));
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
    g.gain.linearRampToValueAtTime(settings.volume, now + fade);
    g.connect(this.duck);
    const s = c.createBufferSource();
    s.buffer = this.buffers.get(name);
    s.loop = true;
    if (settings.loopEnd > settings.loopStart) {
      s.loopStart = settings.loopStart;
      s.loopEnd = settings.loopEnd;
    } else if (settings.loopStart > 0) s.loopStart = settings.loopStart;
    s.connect(g);
    s.start();
    this.music = { name, gain: g, source: s };
    return true;
  }

  /**
   * Keep the looping sounds placed in the world (a waterfall, a campfire) matched to what is asked for now: a new key
   * starts a loop, a key that is gone fades its loop out, and the volume and pan of the rest follow the request.
   */
  syncAmbient(active: ReadonlyMap<string, AmbientRequest>): void {
    const c = this.ctx;
    if (!c || !this.sfxBus) return;
    for (const [key, a] of [...this.ambient]) if (!active.has(key) || active.get(key)!.name !== a.name) this.stopAmbient(key);
    for (const [key, req] of active) {
      let a = this.ambient.get(key);
      if (!a) {
        const buffer = this.buffers.get(req.name);
        if (buffer === undefined) continue;
        const g = c.createGain();
        g.gain.value = 0;
        g.connect(this.sfxBus);
        let panner: PannerNodeLike | null = null;
        if (c.createStereoPanner) {
          panner = c.createStereoPanner();
          panner.connect(g);
        }
        const s = c.createBufferSource();
        s.buffer = buffer;
        s.loop = true;
        s.connect(panner ?? g);
        s.start();
        a = { name: req.name, source: s, gain: g, panner };
        this.ambient.set(key, a);
      }
      const level = Math.max(0, Math.min(2, req.gain * this.soundSettings(req.name).volume));
      this.ramp(a.gain, level, 0.08);
      if (a.panner) a.panner.pan.value = Math.max(-1, Math.min(1, req.pan));
    }
  }

  private stopAmbient(key: string): void {
    const a = this.ambient.get(key);
    const c = this.ctx;
    if (!a || !c) return;
    this.ramp(a.gain, 0, 0.2);
    a.source.stop(c.currentTime + 0.25);
    a.source.onended = () => {
      a.source.disconnect();
      a.panner?.disconnect();
      a.gain.disconnect();
    };
    this.ambient.delete(key);
  }

  /** The keys of the looping sounds playing in the world now. */
  get ambientKeys(): string[] {
    return [...this.ambient.keys()];
  }

  stopAll(): void {
    this.playMusic('', 0.05);
    this.syncAmbient(new Map());
  }

  dispose(): void {
    const c = this.ctx;
    this.ctx = null;
    this.music = null;
    this.ambient.clear();
    this.buffers.clear();
    void c?.close().catch(() => undefined);
  }
}

function defaultContext(): AudioContextLike | null {
  const g = globalThis as unknown as { AudioContext?: new () => AudioContextLike; webkitAudioContext?: new () => AudioContextLike };
  const Ctor = g.AudioContext ?? g.webkitAudioContext;
  return Ctor ? new Ctor() : null;
}
