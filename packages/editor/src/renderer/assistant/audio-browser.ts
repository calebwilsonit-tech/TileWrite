import type { Decoded } from './audio';

/** The window's own sound decoder, for the compressed formats (MP3, OGG, FLAC, AAC, Opus...): the samples, so they can be measured. */
export async function decodeInBrowser(bytes: Uint8Array): Promise<Decoded> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(bytes.slice().buffer);
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: Math.min(buffer.numberOfChannels, 8) }, (_v, i) => buffer.getChannelData(i).slice()),
  };
}
