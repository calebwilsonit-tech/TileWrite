import { describe, expect, it } from 'vitest';
import { AudioEngine, type AudioContextLike } from '@tilewright/runtime';
import { UserError } from '../project/io';
import type { AssetFs } from './assets';
import { MAX_AUDIO_BYTES, deleteSound, importSound, listSounds, loadSounds, soundNameProblem } from './audio';

function memFs(): AssetFs & { files: Map<string, Uint8Array | string> } {
  const files = new Map<string, Uint8Array | string>();
  return {
    files,
    async read(f) {
      const v = files.get(f);
      if (typeof v !== 'string') throw new Error('missing');
      return v;
    },
    async write(f, t) {
      files.set(f, t);
    },
    async readBinary(f) {
      const v = files.get(f);
      if (!(v instanceof Uint8Array)) throw new Error('missing');
      return v;
    },
    async writeBinary(f, b) {
      files.set(f, b);
    },
    async exists(f) {
      return files.has(f);
    },
    async remove(f) {
      files.delete(f);
    },
    async list(dir) {
      const prefix = dir.endsWith('/') ? dir : `${dir}/`;
      const names = [...files.keys()].filter((k) => k.startsWith(prefix) && !k.slice(prefix.length).includes('/')).map((k) => k.slice(prefix.length));
      if (names.length === 0) throw new Error('no such folder');
      return names.map((name) => ({ name, dir: false }));
    },
  };
}

const bytes = (n = 4): Uint8Array => new Uint8Array(n).fill(7);

describe('sound files', () => {
  it('lists nothing when there is no audio folder yet', async () => {
    expect(await listSounds(memFs(), '/p')).toEqual([]);
  });

  it('imports a sound under its file name and lists it', async () => {
    const fs = memFs();
    const added = await importSound(fs, '/p', { name: 'Sword Hit!.OGG', bytes: bytes() });
    expect(added).toEqual({ name: 'Sword Hit', file: 'Sword Hit.ogg' });
    expect(fs.files.has('/p/assets/audio/Sword Hit.ogg')).toBe(true);
    expect(await listSounds(fs, '/p')).toEqual([added]);
  });

  it('says plainly why a file cannot be added', async () => {
    const fs = memFs();
    await expect(importSound(fs, '/p', { name: 'x.txt', bytes: bytes() })).rejects.toThrow(UserError);
    await expect(importSound(fs, '/p', { name: 'x.wav', bytes: new Uint8Array(0) })).rejects.toThrow(/empty/);
    await expect(importSound(fs, '/p', { name: 'x.wav', bytes: new Uint8Array(MAX_AUDIO_BYTES + 1) })).rejects.toThrow(/MB/);
    await importSound(fs, '/p', { name: 'boom.wav', bytes: bytes() });
    await expect(importSound(fs, '/p', { name: 'boom.ogg', bytes: bytes() })).rejects.toThrow(/already exists/);
  });

  it('checks sound names', () => {
    expect(soundNameProblem('')).toMatch(/name/);
    expect(soundNameProblem('a/b')).toMatch(/letters/);
    expect(soundNameProblem('Hit', ['hit'])).toMatch(/already/);
    expect(soundNameProblem('hit')).toBeNull();
  });

  it('deletes a sound', async () => {
    const fs = memFs();
    const a = await importSound(fs, '/p', { name: 'a.wav', bytes: bytes() });
    await importSound(fs, '/p', { name: 'b.wav', bytes: bytes() });
    await deleteSound(fs, '/p', a.file);
    expect((await listSounds(fs, '/p')).map((s) => s.name)).toEqual(['b']);
  });

  it('loads every sound into the engine and reports files that will not play', async () => {
    const fs = memFs();
    await importSound(fs, '/p', { name: 'good.wav', bytes: bytes(8) });
    await importSound(fs, '/p', { name: 'bad.wav', bytes: bytes(2) });
    const ctx = {
      currentTime: 0,
      state: 'running',
      destination: {},
      createGain: () => ({ gain: { value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, cancelScheduledValues() {} }, connect() {}, disconnect() {} }),
      createBufferSource: () => ({ buffer: null, loop: false, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }),
      async decodeAudioData(d: ArrayBuffer) {
        if (d.byteLength < 4) throw new Error('not audio');
        return {};
      },
      async resume() {},
      async close() {},
    } as unknown as AudioContextLike;
    const engine = new AudioEngine(() => ctx);
    const problems = await loadSounds(fs, '/p', engine);
    expect(engine.names()).toEqual(['good']);
    expect(problems.join(' ')).toContain('"bad"');
  });
});
