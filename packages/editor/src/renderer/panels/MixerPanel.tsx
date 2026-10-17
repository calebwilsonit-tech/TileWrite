import { useState } from 'react';
import { BUS_NAMES, checkMixer, defaultMusic, defaultSound, type BusName, type MixerData, type MusicSettings, type SoundSettings } from '@tilewright/runtime';
import { studio, useStudio } from '../studio/store';
import type { SoundFile } from '../studio/audio';
import { CheckField, NumberField, SelectField, TextField } from './fields';

const BUS_LABELS: Record<BusName, string> = {
  master: 'Master (everything)',
  music: 'Music',
  sfx: 'Sound effects',
  voice: 'Voice',
};

function Slider({ label, value, min, max, step = 0.05, onChange, testId }: { label: string; value: number; min: number; max: number; step?: number; onChange(v: number): void; testId: string }) {
  return (
    <label className="opt">
      <span>{label}</span>
      <input data-testid={testId} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <output>{Math.round(value * 100)}%</output>
    </label>
  );
}

/** One sound: how loud, on which bus, how much it drifts, what it picks from, and (as music) where it loops. */
function SoundRow({ file, mix }: { file: SoundFile; mix: MixerData }) {
  const [musicPlaying, setMusicPlaying] = useState(false);
  const s: SoundSettings = mix.sounds[file.name] ?? defaultSound();
  const m: MusicSettings = mix.music[file.name] ?? defaultMusic();
  const others = studio.sounds.filter((x) => x.name !== file.name).map((x) => x.name);
  const setSound = (patch: Partial<SoundSettings>): void => studio.setMixer({ ...mix, sounds: { ...mix.sounds, [file.name]: { ...s, ...patch } } });
  const setMusic = (patch: Partial<MusicSettings>): void => studio.setMixer({ ...mix, music: { ...mix.music, [file.name]: { ...m, ...patch } } });
  const length = studio.soundLength(file.name);
  return (
    <details className="mixer-sound" data-testid={`mixer-sound-${file.name}`}>
      <summary>
        <span>{file.name}</span>
        <button
          aria-label={`Play ${file.name}`}
          title="Listen to it with these settings"
          onClick={(e) => {
            e.preventDefault();
            void studio.previewSound(file);
          }}
        >
          ▶
        </button>
        <button
          aria-label={`Play ${file.name} as music`}
          data-testid={`mixer-music-play-${file.name}`}
          title="Listen to it as looping music with its loop points (press again to stop)"
          onClick={(e) => {
            e.preventDefault();
            void studio.previewMusic(file).then(setMusicPlaying);
          }}
        >
          {musicPlaying ? '■ music' : '♫ music'}
        </button>
      </summary>
      <fieldset>
        <legend>As a sound</legend>
        <Slider testId={`mixer-volume-${file.name}`} label="Loudness" value={s.volume} min={0} max={2} onChange={(v) => setSound({ volume: v })} />
        <SelectField<'sfx' | 'voice'> label="Plays on" testId={`mixer-bus-${file.name}`} value={s.bus} options={[{ value: 'sfx', label: 'sound effects' }, { value: 'voice', label: 'voice (the music gets quieter)' }]} onChange={(v) => setSound({ bus: v })} />
        <NumberField label="Pitch drift (0.05 = 5 percent)" min={0} max={0.5} step={0.01} value={s.pitchVariation} onCommit={(v) => setSound({ pitchVariation: v })} />
        <NumberField label="Loudness drift (0.2 = up to 20 percent quieter)" min={0} max={0.9} step={0.05} value={s.volumeVariation} onCommit={(v) => setSound({ volumeVariation: v })} />
        <NumberField label="Seconds before it can play again" min={0} max={5} step={0.01} value={s.cooldown} onCommit={(v) => setSound({ cooldown: v })} />
        <TextField
          label="Also picks from (sound names, comma separated)"
          testId={`mixer-variants-${file.name}`}
          value={s.variants.join(', ')}
          placeholder={others.slice(0, 3).join(', ')}
          suggestions={others}
          onCommit={(v) => setSound({ variants: v.split(',').map((x) => x.trim()).filter(Boolean) })}
        />
      </fieldset>
      <fieldset>
        <legend>As music</legend>
        <Slider testId={`mixer-music-volume-${file.name}`} label="Loudness" value={m.volume} min={0} max={1} onChange={(v) => setMusic({ volume: v })} />
        <NumberField label={`Loop starts at (seconds${length ? `, the file is ${length.toFixed(1)}s` : ''})`} testId={`mixer-loop-start-${file.name}`} min={0} step={0.1} value={m.loopStart} onCommit={(v) => setMusic({ loopStart: v })} />
        <NumberField label="Loop ends at (seconds, 0 = the end)" testId={`mixer-loop-end-${file.name}`} min={0} step={0.1} value={m.loopEnd} onCommit={(v) => setMusic({ loopEnd: v })} />
        <NumberField label="Fade in and out (seconds)" min={0.05} max={30} step={0.1} value={m.fade} onCommit={(v) => setMusic({ fade: v })} />
      </fieldset>
    </details>
  );
}

/** The project's mix: bus levels, ducking, and every sound's settings. Changes are heard at once, also in a running game. */
export function MixerPanel() {
  useStudio((s) => s.assetsVersion);
  const mix = studio.mixer;
  const sounds = studio.sounds;
  const problems = checkMixer(mix, new Set(sounds.map((s) => s.name)));
  return (
    <div className="mixer" data-testid="mixer-panel">
      <p className="hint">The mix of the whole game. The player&apos;s own volumes in Settings multiply with these levels. Changes are saved as you make them (assets/audio/mixer.json) and heard at once in a game that is running.</p>
      <fieldset>
        <legend>Levels</legend>
        {BUS_NAMES.map((b) => (
          <Slider key={b} testId={`mixer-bus-${b}`} label={BUS_LABELS[b]} value={mix.buses[b]} min={0} max={1.5} onChange={(v) => studio.setMixer({ ...mix, buses: { ...mix.buses, [b]: v } })} />
        ))}
      </fieldset>
      <fieldset>
        <legend>Ducking: the music gets quieter while a voice plays</legend>
        <CheckField label="On" testId="mixer-duck" value={mix.ducking.enabled} onChange={(v) => studio.setMixer({ ...mix, ducking: { ...mix.ducking, enabled: v } })} />
        <Slider testId="mixer-duck-amount" label="How much quieter" value={mix.ducking.amount} min={0} max={1} onChange={(v) => studio.setMixer({ ...mix, ducking: { ...mix.ducking, amount: v } })} />
        <NumberField label="Seconds to get quiet" min={0.01} max={5} step={0.05} value={mix.ducking.attack} onCommit={(v) => studio.setMixer({ ...mix, ducking: { ...mix.ducking, attack: v } })} />
        <NumberField label="Seconds to come back" min={0.01} max={10} step={0.05} value={mix.ducking.release} onCommit={(v) => studio.setMixer({ ...mix, ducking: { ...mix.ducking, release: v } })} />
      </fieldset>
      <h3>Sounds and music</h3>
      {sounds.length === 0 && <p className="hint">No sounds yet. Add files in Assets, under Sounds and music.</p>}
      {sounds.map((s) => (
        <SoundRow key={s.file} file={s} mix={mix} />
      ))}
      {problems.map((p) => (
        <p key={p} className="hint warn">
          {p}
        </p>
      ))}
    </div>
  );
}
