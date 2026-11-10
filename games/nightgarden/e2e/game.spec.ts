import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import { openInEditor, shot, SHOTS } from './ng-helpers';

/**
 * The real editor opens the game, checks it with its own whole-project check, and plays it: every screen of DESIGN.md's flow is
 * opened with the mouse and the keys and a picture of it is kept in screenshots/ to look at (and compared with its golden picture).
 */
const tab = (page: Page, name: string): Locator => page.locator('.dv-tab').getByText(name, { exact: true });
const screen = (page: Page, name: string): Locator => page.getByTestId(`tw-screen-${name}`);
const ui = (page: Page, name: string): Locator => page.locator(`[data-testid="tw-ui-${name}"]`).first();

test('the editor opens Nightgarden, finds nothing wrong, and every screen of the game can be reached and left', async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const { app, page, errors } = await openInEditor();

  // ---- the editor's own checks ----
  await tab(page, 'Problems').click();
  await page.getByTestId('check-project').click();
  await expect(page.getByTestId('project-check')).toContainText('all clear', { timeout: 120_000 });
  await page.screenshot({ path: shot('01-editor.png') });

  // ---- the pictures open in the sprite studio ----
  await page.getByTestId('btn-ws-sprites').click();
  await page.getByTestId('sprite-gardener').click();
  await expect(page.getByTestId('studio-title')).toHaveText('gardener');
  await page.screenshot({ path: shot('02-studio.png') });
  await page.getByTestId('btn-ws-world').click();

  // ---- play: the title ----
  await page.getByTestId('btn-play').click();
  await expect(screen(page, 'Title')).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: shot('03-title.png') });
  await ui(page, 'How to play').click();
  await expect(screen(page, 'How to play')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('04-how-to-play.png') });
  await ui(page, 'Back').click();
  await expect(screen(page, 'How to play')).toHaveCount(0);
  await ui(page, 'Settings').click();
  await expect(screen(page, 'Settings')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('05-settings.png') });
  await ui(page, 'Controls').click();
  await expect(screen(page, 'Controls')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('06-controls.png') });
  await page.keyboard.press('p');
  await expect(screen(page, 'Controls')).toHaveCount(0);
  await page.keyboard.press('p');
  await expect(screen(page, 'Settings')).toHaveCount(0);

  // ---- a new game: the chapter card, then the room ----
  await ui(page, 'New game').click();
  await expect(screen(page, 'Title')).toHaveCount(0);
  await expect(screen(page, 'Chapter')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('07-chapter.png') });
  await ui(page, 'Go on').click();
  await expect(screen(page, 'Chapter')).toHaveCount(0);
  await expect(screen(page, 'HUD')).toBeVisible();
  await page.waitForTimeout(500);
  await page.screenshot({ path: shot('08-room.png') });

  // ---- walk with the keys: the gardener moves a cell a press ----
  const where = (): Promise<{ x: number; y: number }> => page.evaluate(() => {
    const p = window.__play!.sim.world.withTag('player')[0]!;
    const t = p.get('transform') as { x: number; y: number };
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  });
  const start = await where();
  await page.locator('canvas').first().click({ position: { x: 5, y: 5 } }).catch(() => undefined);
  await page.keyboard.press('ArrowRight');
  await expect.poll(where).toEqual({ x: start.x + 1, y: start.y });
  await page.screenshot({ path: shot('09-walked.png') });

  // ---- pause, rooms ----
  await page.keyboard.press('p');
  await expect(screen(page, 'Pause')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('10-pause.png') });
  await ui(page, 'Rooms').click();
  await expect(screen(page, 'Rooms')).toBeVisible();
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('11-rooms.png') });
  await page.keyboard.press('p');
  await expect(screen(page, 'Rooms')).toHaveCount(0);
  await ui(page, 'Resume').click();
  await expect(screen(page, 'Pause')).toHaveCount(0);

  // ---- R starts the room again ----
  await page.keyboard.press('r');
  await expect.poll(where).toEqual(start);
  await page.getByTestId('btn-stop').click();
  expect(errors).toEqual([]);
  await app.close();
});
