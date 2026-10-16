import { _electron as electron, expect, test, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const shot = (name: string): string => path.join(root, 'screenshots', name);

type Snapshot = Record<string, number>;

// Grid-axis moves expressed as the WASD keys a player would press (screen space):
const GRID_PLUS_X: Snapshot = { move_right: 1, move_down: 1 }; // screen down-right
const GRID_MINUS_X: Snapshot = { move_left: 1, move_up: 1 };
const GRID_MINUS_Y: Snapshot = { move_right: 1, move_up: 1 }; // screen up-right
const GRID_PLUS_Y: Snapshot = { move_left: 1, move_down: 1 };

/** Feed `snapshot` as the player's held actions for `ticks` simulation ticks (same path as real keys). */
async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      const r = window.__sample!.runner;
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
}

const player = (page: Page) =>
  page.evaluate(() => {
    const s = window.__sample!;
    const e = s.sim.world.withTag('player')[0]!;
    const t = e.get<{ x: number; y: number; h: number }>('transform')!;
    const b = e.get<{ state: string }>('body')!;
    const st = (s as unknown as { state: { falls: number; lastLanding: number } }).state;
    return { x: t.x, y: t.y, h: t.h, state: b.state, falls: st.falls, lastLanding: st.lastLanding };
  });

test('M2: bridge, stairs, ledge drop, pit respawn and wall fade, played through the real input path', async () => {
  const app = await electron.launch({ args: [path.join(root, 'packages', 'editor')] });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.getByTestId('open-sample-m2').click();
  await page.waitForFunction(() => window.__sample !== undefined);
  await page.waitForTimeout(300);
  await play(page, {}, 5);
  await page.screenshot({ path: shot('m2-start.png') });

  // 1. cross the river on the bridge: up the ramp, along the deck at level 1, down the other ramp
  await play(page, GRID_PLUS_X, 60);
  const onRamp = await player(page);
  expect(onRamp.x).toBeGreaterThan(8);
  expect(onRamp.h).toBeGreaterThan(0.9); // on the deck (level 1)
  await page.screenshot({ path: shot('m2-bridge.png') });
  await play(page, GRID_PLUS_X, 90);
  const across = await player(page);
  expect(across.x).toBeGreaterThan(12);
  expect(across.h).toBeCloseTo(0, 5);
  expect(across.falls).toBe(0);

  // 2. walk up to the stairs row and climb both flights onto the level-2 platform
  await play(page, GRID_PLUS_Y, 30); // south to y = 14.5, below the stairs
  await play(page, GRID_PLUS_X, 60); // east to x = 18.5, in line with the stairs
  await play(page, GRID_MINUS_Y, 75); // north up both flights onto the platform (y = 9.5)
  const platform = await player(page);
  expect(platform.y).toBeLessThan(10);
  expect(platform.h).toBeCloseTo(2, 5);
  await page.screenshot({ path: shot('m2-platform.png') });

  // 3. walk off the platform's east edge: drop two levels and report the landing
  await play(page, GRID_PLUS_X, 120);
  const dropped = await player(page);
  expect(dropped.h).toBeCloseTo(0, 5);
  expect(dropped.lastLanding).toBeCloseTo(2, 0);
  expect(dropped.state).toBe('ground');

  // 4. the wall in front of the player fades; away from it, it is solid again
  await page.evaluate(() => {
    const s = window.__sample as unknown as { sim: { world: { withTag(t: string): { get<T>(n: string): T | undefined }[] } } };
    const t = s.sim.world.withTag('player')[0]!.get<{ x: number; y: number; h: number }>('transform')!;
    // directly behind the wall cell (16,18) as the camera sees it
    t.x = 15.5;
    t.y = 16.7;
    t.h = 0;
  });
  await play(page, {}, 40);
  const faded = await page.evaluate(() => window.__sample!.renderer.tileAlpha(16, 18));
  expect(faded).toBeLessThan(0.5);
  await page.screenshot({ path: shot('m2-fade.png') });
  await page.evaluate(() => {
    const s = window.__sample as unknown as { sim: { world: { withTag(t: string): { get<T>(n: string): T | undefined }[] } } };
    const t = s.sim.world.withTag('player')[0]!.get<{ x: number; y: number; h: number }>('transform')!;
    t.x = 5.5;
    t.y = 12.5;
  });
  await play(page, {}, 60);
  const solid = await page.evaluate(() => window.__sample!.renderer.tileAlpha(16, 18));
  expect(solid).toBeGreaterThan(0.95);

  // 5. walk into the pit field: fall, then respawn at the spawn point
  await page.evaluate(() => {
    const s = window.__sample as unknown as { sim: { world: { withTag(t: string): { get<T>(n: string): T | undefined }[] } } };
    const t = s.sim.world.withTag('player')[0]!.get<{ x: number; y: number; h: number }>('transform')!;
    t.x = 3.5;
    t.y = 8.5;
  });
  await play(page, GRID_MINUS_Y, 140);
  const respawned = await player(page);
  expect(respawned.falls).toBe(1);
  expect(respawned.state).toBe('ground');
  expect(respawned.h).toBeCloseTo(0, 5);

  expect(errors).toEqual([]);
  await app.close();
});
