import { describe, expect, it } from 'vitest';
import { describeAudio, describeUnreadable, extOf, fileKind, formatProjectIndex, looksLikeText, pngSize, sniffImage } from './readers';

const wav = (seconds: number, rate = 8000, channels = 1, bits = 16): Uint8Array => {
  const dataBytes = Math.round(seconds * rate * channels * (bits / 8));
  const b = new Uint8Array(44 + dataBytes);
  const dv = new DataView(b.buffer);
  const put = (o: number, s: string): void => [...s].forEach((c, i) => (b[o + i] = c.charCodeAt(0)));
  put(0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  put(8, 'WAVE');
  put(12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, rate, true);
  dv.setUint32(28, rate * channels * (bits / 8), true);
  dv.setUint16(32, channels * (bits / 8), true);
  dv.setUint16(34, bits, true);
  put(36, 'data');
  dv.setUint32(40, dataBytes, true);
  return b;
};

describe('kinds of file', () => {
  it('are told by the name, in any case', () => {
    expect(fileKind('assets/screens.json')).toBe('text');
    expect(fileKind('assets/sprites/hero.sprite.json')).toBe('text');
    expect(fileKind('scripts/a.TS')).toBe('text');
    expect(fileKind('art/photo.JPG')).toBe('image');
    expect(fileKind('audio/boom.wav')).toBe('audio');
    expect(fileKind('audio/theme.OGG')).toBe('audio');
    expect(fileKind('fonts/x.woff2')).toBe('font');
    expect(fileKind('packs/tree.twpack')).toBe('archive');
    expect(fileKind('README')).toBe('binary');
    expect(extOf('a.b/c')).toBe('');
    expect(extOf('a/b.c.d')).toBe('.d');
  });

  it('a picture is known by its first bytes, not by what the name says', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 16, 0, 0, 0, 8]);
    expect(sniffImage(png)).toBe('image/png');
    expect(pngSize(png)).toEqual({ width: 16, height: 8 });
    expect(sniffImage(new Uint8Array([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(new TextEncoder().encode('GIF89a....'))).toBe('image/gif');
    expect(sniffImage(new TextEncoder().encode('{"not":"a picture"}'))).toBeNull();
    expect(pngSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('text is told from binary by what is in it', () => {
    expect(looksLikeText(new TextEncoder().encode('hello\nworld\t1'))).toBe(true);
    expect(looksLikeText(new Uint8Array([0x89, 0x50, 0, 0, 1, 2, 3]))).toBe(false);
    expect(looksLikeText(new Uint8Array())).toBe(true);
  });
});

describe('what can be said about a sound', () => {
  it('a wav file: how long, how many channels, and that nothing is known of how it sounds', () => {
    const text = describeAudio('audio/jump.wav', wav(1.5, 8000, 2, 16));
    expect(text).toContain('audio/jump.wav');
    expect(text).toContain('1.50 seconds');
    expect(text).toContain('stereo');
    expect(text).toContain('8000 Hz');
    expect(text).toContain('16-bit');
    expect(text).toContain('I cannot listen to sound');
  });

  it('a file that only says it is a sound gets its size and the same honest line, never a description of the sound', () => {
    const text = describeAudio('audio/theme.mp3', new Uint8Array(2048));
    expect(text).toContain('2.0 KB');
    expect(text).toContain('I cannot listen to sound');
    expect(text).not.toMatch(/b(soft|loud|happy|calm|bright|warm|dramatic)b/i);
    expect(describeAudio('a.wav', new Uint8Array(10))).toContain('I cannot listen to sound');
  });

  it('what cannot be read at all is said so', () => {
    expect(describeUnreadable('fonts/a.ttf', 'font', 5000)).toContain('a font file');
    expect(describeUnreadable('x.bin', 'binary', 10)).toContain('cannot read its contents');
  });
});

describe('the index of a project', () => {
  const files = [
    'project.json',
    'scenes/b.scene.json',
    'scenes/a.scene.json',
    'assets/sprites/hero.sprite.json',
    'assets/screens.json',
    'assets/audio/jump.wav',
    'assets/art/bg.png',
    'scripts/ai.ts',
    'assets/localization/fr.strings.json',
    'project-notes.md',
    'weird.dat',
  ].map((path) => ({ path, size: 100 }));

  it('groups the files, sorted, and says what Claude cannot do with sounds', () => {
    const text = formatProjectIndex('Demo', files);
    expect(text.indexOf('scenes/a.scene.json')).toBeLessThan(text.indexOf('scenes/b.scene.json'));
    expect(text).toContain('Scenes: 2');
    expect(text).toContain('Sprites (pictures made in the sprite studio): 1');
    expect(text).toContain('Sounds (I cannot listen to these): 1');
    expect(text).toContain('Pictures (PNG, JPG...): 1');
    expect(text).toContain('Translations: 1');
    expect(text).toContain('Other files: 2'); // project.json and weird.dat
  });

  it('is the same text for the same project, however the files came', () => {
    expect(formatProjectIndex('Demo', [...files].reverse())).toBe(formatProjectIndex('Demo', files));
  });

  it('cuts a long group short and says how many more there are', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ path: `assets/sprites/s${String(i).padStart(2, '0')}.sprite.json` }));
    const text = formatProjectIndex('Big', many, { perGroup: 5 });
    expect(text).toContain('Sprites (pictures made in the sprite studio): 40');
    expect(text).toContain('and 35 more');
    expect(text).not.toContain('s39');
  });
});
