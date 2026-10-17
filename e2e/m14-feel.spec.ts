import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createProjectViaUi, dragCells, launchEditor, pickTool } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

/** A tenth of a second of a 440 Hz tone as a 16-bit mono WAV file. */
function chime(): Uint8Array {
  const rate = 8000;
  const n = rate / 10;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 12000), 44 + i * 2);
  return buf;
}

test('M14: a sound file added in the Assets panel plays as a room\'s music, bad names are flagged, and hits feel like hits', async () => {
  test.setTimeout(150_000);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-e2e-'));
  const wav = path.join(base, 'chime.wav');
  fs.writeFileSync(wav, chime());
  const { page, app, errors } = await launchEditor(base, { TILEWRIGHT_TEST_IMPORT: wav });
  await createProjectViaUi(page, 'Feel Game', 'starter-room');

  // add the file through the Assets panel
  await tab(page, 'Assets').click();
  await expect(page.getByText('No sounds yet.')).toBeVisible();
  await page.getByTestId('sound-add').click();
  await expect(page.getByTestId('sound-chime')).toBeVisible();
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  expect(fs.existsSync(path.join(dir, 'assets', 'audio', 'chime.wav'))).toBe(true);

  // a room that asks for it as music
  await pickTool(page, 'region');
  const [w, h] = await page.evaluate(() => [window.__store!.doc!.map.width, window.__store!.doc!.map.height]);
  await dragCells(page, [0, 0], [w! - 1, h! - 1]);
  await tab(page, 'Inspector').click();
  await page.getByTestId('region-music').fill('nope');
  await page.getByTestId('region-music').press('Enter');
  await tab(page, 'Problems').click();
  await expect(page.getByText(/plays the music "nope", which is not in Assets -> Sounds/)).toBeVisible();
  await tab(page, 'Inspector').click();
  await page.getByTestId('region-music').fill('chime');
  await page.getByTestId('region-music').press('Enter');
  expect(await page.evaluate(() => window.__store!.doc!.regions[0]!.music)).toBe('chime');
  await tab(page, 'Problems').click();
  await expect(page.getByText(/plays the music/)).toHaveCount(0);
  await pickTool(page, 'select');

  // playing: the file is loaded and the room's music starts
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForFunction(() => window.__play!.session.audio.has('chime'));
  await page.waitForFunction(() => window.__play!.session.audio.currentMusic === 'chime');

  // the host side of hit feel: sparks are drawn, the screen shakes, the world holds still for a moment
  const seen = await page.evaluate(
    () =>
      new Promise<{ particles: number; shake: number; hold: number; ticksPerFrame: number }>((resolve) => {
        const play = window.__play!;
        const renderer = window.__viewport!.renderer;
        const rt = play.sim.runtime;
        rt.fx.push({ kind: 'burst', preset: 'spark', x: 8, y: 8, h: 0 });
        rt.view.impact = 8;
        rt.hitStop = 12;
        const t0 = play.sim.tick;
        const out = { particles: 0, shake: 0, hold: 0, ticksPerFrame: 0 };
        let frames = 0;
        const frame = (): void => {
          out.particles = Math.max(out.particles, renderer.particles.system.particles.length);
          out.shake = Math.max(out.shake, renderer.shake);
          out.hold = Math.max(out.hold, play.runner.holdTicks);
          if (++frames < 40) requestAnimationFrame(frame);
          else {
            out.ticksPerFrame = (play.sim.tick - t0) / frames;
            resolve(out);
          }
        };
        requestAnimationFrame(frame);
      }),
  );
  expect(seen.particles).toBeGreaterThan(0);
  expect(seen.shake).toBeGreaterThan(0);
  expect(seen.hold).toBeGreaterThan(0);

  expect(errors).toEqual([]);
  await app.close();
});
