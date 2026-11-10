import { it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { encodePng } from '@tilewright/runtime';
import { tilePatch } from '../../../packages/editor/src/renderer/tilestudio/make-tile';
import { rasterize, rgbaOf, type Picture } from './draw';
import { ISO, TILES, clipTile } from './tiles';
import { PICTURES } from './pictures';

const OUT = path.join(__dirname, 'preview');

/** Put pictures side by side on one sheet. */
function sheet(items: { width: number; height: number; data: Uint8ClampedArray }[], gap = 8, back = [38, 42, 66]): { width: number; height: number; data: Uint8ClampedArray } {
  const width = items.reduce((s, i) => s + i.width + gap, gap);
  const height = Math.max(...items.map((i) => i.height)) + gap * 2;
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) data.set([back[0]!, back[1]!, back[2]!, 255], i * 4);
  let x0 = gap;
  for (const it of items) {
    for (let y = 0; y < it.height; y++) {
      for (let x = 0; x < it.width; x++) {
        const s = (y * it.width + x) * 4;
        if (it.data[s + 3] === 0) continue;
        data.set(it.data.subarray(s, s + 4), ((y + gap) * width + x0 + x) * 4);
      }
    }
    x0 += it.width + gap;
  }
  return { width, height, data };
}

it('previews of the art', () => {
  fs.mkdirSync(OUT, { recursive: true });
  const only = process.env.NG_ONLY;
  const tiles = TILES.map((t) => {
    const img = rgbaOf(t, clipTile(rasterize(t)[0]!));
    return tilePatch(img, ISO, 3, 3, 2);
  });
  if (!only) {
    const s = sheet(tiles);
    fs.writeFileSync(path.join(OUT, 'tiles.png'), encodePng(s.width, s.height, s.data));
  }
  const groups = new Map<string, Picture[]>();
  for (const p of PICTURES) {
    const g = p.name.split('_')[0]!;
    if (only && !only.split(',').includes(g)) continue;
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(p);
  }
  for (const [g, list] of groups) {
    const items = list.flatMap((p) => rasterize(p).map((cel) => rgbaOf(p, cel, 6)));
    const s = sheet(items, 12);
    fs.writeFileSync(path.join(OUT, `${g}.png`), encodePng(s.width, s.height, s.data));
  }
});
