import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clickCell, createProjectViaUi, launchEditor, pickTool } from './helpers';

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

test('M15: the Mixer sets levels, ducking, sound settings and loop points; a Sound Source is heard in the running game', async () => {
  test.setTimeout(150_000);
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-e2e-'));
  const wav = path.join(base, 'chime.wav');
  fs.writeFileSync(wav, chime());
  const { page, app, errors } = await launchEditor(base, { TILEWRIGHT_TEST_IMPORT: wav });
  await createProjectViaUi(page, 'Mix Game', 'starter-room');
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);

  await tab(page, 'Assets').click();
  await page.getByTestId('sound-add').click();
  await expect(page.getByTestId('sound-chime')).toBeVisible();

  // ---- the mixer panel ----
  await tab(page, 'Mixer').click();
  await expect(page.getByTestId('mixer-panel')).toBeVisible();
  await page.getByTestId('mixer-bus-music').fill('0.5');
  await page.getByTestId('mixer-duck-amount').fill('0.8');
  await page.getByTestId('mixer-sound-chime').locator('summary').click();
  await page.getByTestId('mixer-volume-chime').fill('0.5');
  await page.getByTestId('mixer-bus-chime').selectOption('voice');
  await page.getByTestId('mixer-loop-start-chime').fill('0.02');
  await page.getByTestId('mixer-loop-start-chime').press('Enter');
  await page.getByTestId('mixer-loop-end-chime').fill('0.08');
  await page.getByTestId('mixer-loop-end-chime').press('Enter');
  await page.getByTestId('mixer-variants-chime').fill('chime, ghost');
  await page.getByTestId('mixer-variants-chime').press('Enter');
  const mix = await page.evaluate(() => JSON.parse(JSON.stringify(window.__studio!.mixer)));
  expect(mix.buses.music).toBe(0.5);
  expect(mix.ducking.amount).toBe(0.8);
  expect(mix.sounds.chime).toMatchObject({ volume: 0.5, bus: 'voice', variants: ['chime', 'ghost'] });
  expect(mix.music.chime).toMatchObject({ loopStart: 0.02, loopEnd: 0.08 });
  // the mix is warned about in plain English
  await expect(page.getByTestId('mixer-panel')).toContainText('picks from "ghost"');
  await expect(page.getByTestId('mixer-panel')).toContainText('lists itself');

  // ---- saved to the project, only what was changed ----
  const file = path.join(dir, 'assets', 'audio', 'mixer.json');
  await expect.poll(() => fs.existsSync(file), { timeout: 5000 }).toBe(true);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  expect(saved.buses.music).toBe(0.5);
  expect(Object.keys(saved.sounds)).toEqual(['chime']);

  // ---- a Sound Source object, placed with the Place tool ----
  await pickTool(page, 'place');
  await page.getByTestId('opt-prefab').selectOption('soundsource');
  const player = await page.evaluate(() => {
    const e = window.__store!.doc!.entities.find((x) => x.tags.includes('player'))!;
    const t = e.components.transform as { x: number; y: number };
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  });
  await clickCell(page, player.x + 2, player.y);
  const sourceId = await page.evaluate(() => window.__store!.doc!.entities.find((e) => e.components.soundSource)!.id);
  await tab(page, 'Problems').click();
  await expect(page.getByText(/is a Sound Source with no sound chosen/)).toBeVisible();
  await page.evaluate(
    (id) =>
      window.__store!.doc!.updateEntities([id], 'Choose the sound', (e) => {
        Object.assign(e.components.soundSource as object, { sound: 'chime', near: 3, far: 12 });
      }),
    sourceId,
  );
  await expect(page.getByText(/is a Sound Source with no sound chosen/)).toHaveCount(0);

  // ---- playing: the mix is the engine's, a live change reaches it, the source loops ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined && window.__play.session.audio.has('chime'));
  await page.waitForFunction(() => window.__play!.session.audio.ambientKeys.length === 1, undefined, { timeout: 15_000 });
  expect(await page.evaluate(() => window.__play!.session.audio.mixer.sounds.chime!.bus)).toBe('voice');
  await tab(page, 'Mixer').click();
  await page.getByTestId('mixer-bus-master').fill('0.4');
  expect(await page.evaluate(() => window.__play!.session.audio.mixer.buses.master)).toBeCloseTo(0.4);
  expect(errors).toEqual([]);
  await app.close();
});
