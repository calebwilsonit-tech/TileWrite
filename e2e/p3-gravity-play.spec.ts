import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { bodyBox, gravityFrame } from '@tilewright/runtime';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { SAMPLES_DIR } from './sample-helpers';
import { blocksView, FADE_OFF, FADE_ON, viewOverlap } from '../packages/runtime/src/render/occlusion';

/**
 * Phase 3, step 4.3, in the real window: the gravity room played in the editor. Gravity is turned with the number keys (rows of
 * Quick Actions), the camera follows, and the stone ceiling's blocks are faded exactly where the sight rule says they stand between the
 * camera and the player: not the blocks next to the line of sight, not the ones far away.
 */
async function openRoom(page: Page, workDir: string): Promise<void> {
  await createProjectViaUi(page, 'Scratch', 'empty');
  const copy = path.join(workDir, 'gravity-room-copy');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(SAMPLES_DIR, 'gravity-room'), copy, { recursive: true });
  await page.evaluate(() => window.__store!.closeProject());
  await page.evaluate((d) => window.tilewright.recent.add(d, 'gravity-room-copy'), copy);
  await page.evaluate((d) => window.__store!.openRecent(d), copy);
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
}

interface Seen {
  g: string;
  state: string;
  box: { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number };
}

const seen = (page: Page): Promise<Seen> =>
  page.evaluate(() => {
    const p = window.__play!.sim.world.withTag('player')[0]!;
    const t = p.get('transform') as { x: number; y: number; h: number };
    const b = p.get('body') as { g?: string; state: string; radius: number; height: number };
    return { g: b.g ?? '-z', state: b.state, feet: { x: t.x, y: t.y, h: t.h }, radius: b.radius, height: b.height } as never;
  }).then((r) => {
    const raw = r as unknown as { g: string; state: string; feet: { x: number; y: number; h: number }; radius: number; height: number };
    return { g: raw.g, state: raw.state, box: bodyBox(gravityFrame(raw.g as never), raw.feet, raw.radius, raw.height) };
  });

/** The ceiling's blocks (level 5) that are faded in the picture, and the ones the rule says should be. */
async function ceilingFades(page: Page, box: Seen['box']): Promise<{ faded: string[]; expected: string[]; unsure: string[] }> {
  const alphas = await page.evaluate(() => {
    const out: Record<string, number | null> = {};
    for (let x = 0; x < 14; x++) for (let y = 0; y < 14; y++) out[`${x},${y}`] = window.__viewport!.renderer.tileAlpha(x, y, 5) ?? null;
    return out;
  });
  const body = { id: 0, minX: box.x0, maxX: box.x1, minY: box.y0, maxY: box.y1, minZ: box.z0, maxZ: box.z1 };
  const faded: string[] = [];
  const expected: string[] = [];
  const unsure: string[] = [];
  for (const [key, a] of Object.entries(alphas)) {
    const [x, y] = key.split(',').map(Number) as [number, number];
    const block = { id: 1, minX: x, maxX: x + 1, minY: y, maxY: y + 1, minZ: 5, maxZ: 6 };
    if (a !== null && a < 0.6) faded.push(key);
    if (blocksView(body, block)) expected.push(key);
    const o = viewOverlap(body, block);
    if (o > FADE_OFF - 0.02 && o < FADE_ON + 0.02) unsure.push(key); // at the edge of the rule: either is fine
  }
  return { faded, expected, unsure };
}

test('Phase 3: playing the gravity room, the ceiling fades only over the player, on the floor, on a wall and on the ceiling', async () => {
  test.setTimeout(240_000);
  const { page, app, workDir, errors } = await launchEditor();
  await openRoom(page, workDir);
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.waitForTimeout(2500); // landed, the camera has settled, the fades have run their course

  for (const [label, key, g, wait] of [
    ['on the floor', null, '-z', 0],
    ['on the west wall', 'Digit2', '-x', 2500],
    ['on the ceiling', 'Digit3', '+z', 3000],
    ['back on the floor', 'Digit1', '-z', 3000],
    ['on the south wall', 'Digit4', '+y', 3000],
  ] as const) {
    if (key) {
      await page.keyboard.press(key);
      await page.waitForTimeout(wait);
    }
    const now = await seen(page);
    expect(now.g, label).toBe(g);
    expect(now.state, label).toBe('ground');
    const { faded, expected, unsure } = await ceilingFades(page, now.box);
    const skip = new Set(unsure);
    expect(faded.filter((k) => !skip.has(k)).sort(), `${label}: the blocks that faded`).toEqual(expected.filter((k) => !skip.has(k)).sort());
    if (label === 'on the floor' || label === 'back on the floor') expect(faded.length, label).toBeGreaterThan(0); // the ceiling is over the player
    if (label === 'on the floor') await page.screenshot({ path: shot('p3-gravity-play-floor.png') });
    if (label === 'on the west wall') await page.screenshot({ path: shot('p3-gravity-play-wall.png') });
    if (label === 'on the ceiling') await page.screenshot({ path: shot('p3-gravity-play-ceiling.png') });
  }

  // the Gravity overlay: an arrow, the contact, the box and the line to the camera
  await page.getByTestId('btn-stop').click();
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  expect(errors).toEqual([]);
  await app.close();
});
