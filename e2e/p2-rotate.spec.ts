import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';

test('Phase 2: the world can be turned between the four isometric views; picking, walking and drawing follow it', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Turning Game', 'starter-room');
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(300);

  const info = () =>
    page.evaluate(() => {
      const play = window.__play!;
      const p = play.sim.world.withTag('player')[0]!;
      const t = p.get<{ x: number; y: number }>('transform')!;
      const r = window.__viewport!.renderer;
      const cam = r.camera;
      const s = r.viewToCell(cam.viewW / 2, cam.viewH / 2, 0);
      return { view: r.view, x: t.x, y: t.y, centreCell: s };
    });

  const before = await info();
  expect(before.view).toBe(0);
  await page.evaluate(() => {
    window.__store!.set({ paused: true });
    window.__play!.runner.paused = true;
  });
  for (const view of [1, 2, 3, 0]) {
    await page.evaluate((v) => {
      window.__play!.sim.runtime.view.rotation = v as 0 | 1 | 2 | 3;
      window.__play!.runner.step();
    }, view);
    await page.waitForTimeout(150);
    const now = await info();
    expect(now.view).toBe(view);
    // the camera keeps looking at the same place: the player is still near the middle of the picture
    expect(Math.abs(now.centreCell.x - Math.floor(before.x))).toBeLessThanOrEqual(3);
    expect(Math.abs(now.centreCell.y - Math.floor(before.y))).toBeLessThanOrEqual(3);
    if (view !== 0) await page.screenshot({ path: shot(`p2-view-${view}.png`) });
  }

  // walking "up the screen" goes up the screen in every view
  for (const view of [0, 1, 2, 3]) {
    const up = await page.evaluate((v) => {
      const play = window.__play!;
      play.sim.runtime.view.rotation = v as 0 | 1 | 2 | 3;
      play.runner.step();
      const r = window.__viewport!.renderer;
      const p = play.sim.world.withTag('player')[0]!;
      const at = (): { x: number; y: number } => {
        const t = p.get<{ x: number; y: number; h: number }>('transform')!;
        return r.worldToScreen(t.x, t.y, t.h);
      };
      const from = at();
      play.runner.inputSource = () => ({ move_up: 1 });
      for (let i = 0; i < 12; i++) play.runner.step();
      play.runner.inputSource = () => ({});
      const to = at();
      return { dx: to.x - from.x, dy: to.y - from.y };
    }, view);
    expect(up.dy, `view ${view}`).toBeLessThan(-5);
    expect(Math.abs(up.dx), `view ${view}`).toBeLessThan(Math.abs(up.dy) * 0.3);
  }
  expect(errors).toEqual([]);
  await app.close();
});
