import { expect, test, type Locator, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });
const centre = async (l: Locator): Promise<{ x: number; y: number }> => {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
};
const steps = (page: Page) => page.evaluate(() => JSON.parse(JSON.stringify(window.__store!.story.cutscenes.get('Opening')!.steps)) as Record<string, unknown>[]);

test('M14: a cutscene is shown on a timeline, steps run side by side when marked, and a block is stretched with the mouse', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Timeline Game', 'empty-iso');
  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-cutscenes').click();
  await page.getByTestId('cutscene-new-name').fill('Opening');
  await page.getByTestId('cutscene-new').click();
  await page.getByTestId('cutscene-view-timeline').click();
  await page.getByTestId('ct-big').click();

  // a fade that keeps going while the camera moves, then someone speaks, then a sound
  await page.getByTestId('cstep-add-fade').click();
  await page.getByLabel('Keep going without waiting for it to finish').check();
  await page.getByTestId('cstep-add-cameraTo').click();
  await page.getByTestId('cstep-add-say').click();
  await page.getByTestId('cstep-add-sound').click();
  await expect(page.locator('[data-testid^="ct-block-"]')).toHaveCount(4);
  const x = async (i: number) => (await page.getByTestId(`ct-block-${i}`).boundingBox())!.x;
  expect(Math.abs((await x(0)) - (await x(1)))).toBeLessThan(2); // side by side: the fade does not delay the camera
  expect(await x(2)).toBeGreaterThan((await x(1)) + 40); // the line starts after the camera move
  await expect(page.getByTestId('ct-total')).toContainText('more when the player reads or walks');
  await page.screenshot({ path: shot('m14-cutscene-timeline.png') });

  // clicking a block shows that step to edit
  await page.getByTestId('ct-block-1').click({ position: { x: 20, y: 10 } });
  await expect(page.getByTestId('cstep-1')).toBeVisible();
  await expect(page.getByTestId('cstep-0')).toHaveCount(0);

  // stretch the camera move: drag the right edge of its block to the right
  const edge = await centre(page.getByTestId('ct-edge-1'));
  await page.mouse.move(edge.x, edge.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(edge.x + (i * 100) / 8, edge.y);
  await page.mouse.up();
  const after = await steps(page);
  expect(after[1]!.type).toBe('cameraTo');
  expect(Number(after[1]!.seconds)).toBeGreaterThan(2);
  expect(Number(after[0]!.seconds)).toBe(1); // the fade was not touched
  expect(await x(2)).toBeGreaterThan((await x(1)) + 100); // and the later steps moved along

  // the list view has the same steps
  await page.getByTestId('ct-big').click();
  await page.getByTestId('cutscene-view-list').click();
  await expect(page.getByTestId('cstep-3')).toBeVisible();
  expect(errors).toEqual([]);
  await app.close();
});
