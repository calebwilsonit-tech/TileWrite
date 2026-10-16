/**
 * Run-length encoding for palette-index images, as text: "12x0 3x5 1x7 ..." (count x value).
 * Long runs of transparent pixels collapse to a few characters.
 */
export function encodeRle(cel: ArrayLike<number>): string {
  const parts: string[] = [];
  let i = 0;
  while (i < cel.length) {
    const v = cel[i]!;
    let n = 1;
    while (i + n < cel.length && cel[i + n] === v) n++;
    parts.push(`${n}x${v}`);
    i += n;
  }
  return parts.join(' ');
}

/** Inverse of encodeRle; throws a readable error for damaged data. */
export function decodeRle(text: string, length: number): Uint8Array {
  const out = new Uint8Array(length);
  if (text.trim() === '') return out;
  let pos = 0;
  for (const run of text.trim().split(/\s+/)) {
    const m = /^(\d+)x(\d+)$/.exec(run);
    if (!m) throw new Error(`damaged pixel data near "${run}"`);
    const n = Number(m[1]);
    const v = Number(m[2]);
    if (v > 255) throw new Error(`pixel colour ${v} is out of range`);
    if (pos + n > length) throw new Error('pixel data is longer than the sprite');
    out.fill(v, pos, pos + n);
    pos += n;
  }
  if (pos !== length) throw new Error(`pixel data is shorter than the sprite (${pos} of ${length} pixels)`);
  return out;
}
