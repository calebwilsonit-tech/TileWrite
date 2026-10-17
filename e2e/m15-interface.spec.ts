import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function press(page: Page, snapshot: Record<string, number>, ticks: number): Promise<void> {
  await page.evaluate(
    ({ snapshot, ticks }) => {
      window.__store!.set({ paused: true });
      const r = window.__play!.runner;
      r.paused = true;
      r.inputSource = () => snapshot;
      for (let i = 0; i < ticks; i++) r.step();
    },
    { snapshot, ticks },
  );
  await page.waitForTimeout(60);
}

test('M15: project settings turn on a title screen (New game, Continue); controls and the interface are edited and used by the game', async () => {
  test.setTimeout(240_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Front Door', 'starter-room');
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);
  await page.evaluate(() => localStorage.removeItem('tilewright.settings'));

  // ---- project settings: title screen ----
  await page.getByTestId('btn-project-settings').click();
  await expect(page.getByTestId('ps-name')).toHaveValue('Front Door');
  await page.getByTestId('ps-title-enabled').check();
  await page.getByTestId('ps-subtitle').fill('A [i]quiet[/i] tale');
  await page.getByTestId('ps-subtitle').press('Enter');
  await page.getByTestId('ps-save').click();
  await expect(page.getByTestId('ps-saved')).toBeVisible();
  expect(JSON.parse(fs.readFileSync(path.join(dir, 'project.json'), 'utf8')).title).toEqual({ enabled: true, subtitle: 'A [i]quiet[/i] tale' });

  // ---- controls: a new action of our own, a changed key ----
  await page.getByTestId('ps-tab-controls').click();
  await page.getByTestId('ctl-new-id').fill('dash');
  await page.getByTestId('ctl-new-id').press('Enter');
  await page.getByTestId('ctl-new-label').fill('Quick dash');
  await page.getByTestId('ctl-new-label').press('Enter');
  await page.getByTestId('ctl-add').click();
  await expect(page.getByTestId('ctl-custom-dash')).toBeVisible();
  await expect(page.getByTestId('ctl-problems')).toContainText('has no key or button yet');
  await page.getByTestId('ctl-change-dash').click();
  await page.keyboard.press('KeyZ');
  await expect(page.getByTestId('ctl-keys-dash')).toHaveText('Z');
  await expect(page.getByTestId('ctl-problems')).toHaveCount(0);
  await page.getByTestId('ctl-change-interact').click();
  await page.keyboard.press('KeyF');
  await expect(page.getByTestId('ctl-keys-interact')).toContainText('F');
  await expect.poll(() => page.evaluate(() => window.__store!.input.overrides.interact?.[0])).toBe('key:KeyF');
  await page.keyboard.press('Escape');
  await page.getByText('Done').click();

  // ---- interface: drag the hearts to the bottom right, add a counter, change the theme ----
  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-interface').click();
  await page.getByTestId('ui-big').click();
  await page.getByTestId('ui-res').selectOption('phone');
  await page.getByTestId('ui-res').selectOption('hd');
  const hearts = page.getByTestId('ui-widget-hearts');
  const stage = await page.getByTestId('ui-stage').boundingBox();
  const box = (await hearts.boundingBox())!;
  await page.mouse.move(box.x + 6, box.y + 6);
  await page.mouse.down();
  await page.mouse.move(stage!.x + stage!.width * 0.7, stage!.y + stage!.height * 0.8, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => page.evaluate(() => window.__store!.uiLayout.widgets.find((w) => w.id === 'hearts')!.anchor)).toBe('br');
  await page.screenshot({ path: shot('m15-interface-editor.png') });

  await page.getByTestId('ui-add-counter').click();
  await page.getByTestId('ui-label').fill('Coins');
  await page.getByTestId('ui-label').press('Enter');
  await page.getByTestId('ui-variable').fill('coins');
  await page.getByTestId('ui-variable').press('Enter');
  await page.getByTestId('ui-theme-font').selectOption('mono');
  await page.getByTestId('ui-theme-accent').fill('#00ff88');
  await page.getByTestId('ui-theme-radius').fill('2');
  await page.getByTestId('ui-theme-radius').press('Enter');
  await expect.poll(() => fs.existsSync(path.join(dir, 'assets/ui.json'))).toBe(true);
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(dir, 'assets/ui.json'), 'utf8')).theme.font).toBe('mono');
  await expect.poll(() => JSON.parse(fs.readFileSync(path.join(dir, 'assets/input.json'), 'utf8')).actions[0]?.id).toBe('dash');

  await page.getByTestId('ui-big').click();

  // ---- play: the title screen comes first ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-game-title')).toHaveText('Front Door');
  await expect(page.locator('.tw-subtitle i, .tw-subtitle span').first()).toHaveText('quiet');
  expect(await page.evaluate(() => window.__play!.sim.runtime.menuOpen)).toBe(true);
  await expect(page.getByTestId('tw-row-continue')).toHaveCount(0); // nothing saved yet
  await page.screenshot({ path: shot('m15-title-screen.png') });
  // the pause key cannot dismiss the front door
  await press(page, { pause: 1 }, 1);
  await expect(page.getByTestId('tw-game-title')).toBeVisible();
  await page.getByTestId('tw-row-new-game').click();
  await expect(page.getByTestId('tw-menu')).toHaveCount(0);
  expect(await page.evaluate(() => window.__play!.sim.runtime.menuOpen)).toBe(false);

  // the theme and layout reached the game
  const ui = await page.evaluate(() => {
    const root = document.querySelector('[data-testid="tw-ui"]') as HTMLElement;
    const hearts = document.querySelector('[data-testid="tw-hearts"]') as HTMLElement;
    return { accent: root.style.getPropertyValue('--tw-accent'), font: root.style.getPropertyValue('--tw-font'), right: hearts.style.right, bottom: hearts.style.bottom, parent: hearts.parentElement === root };
  });
  expect(ui.accent).toBe('#00ff88');
  expect(ui.font).toContain('Consolas');
  expect(ui.parent).toBe(true);
  expect(ui.right).not.toBe('');
  expect(ui.bottom).not.toBe('');
  await page.evaluate(() => (window.__play!.sim.runtime.vars['coins'] = 7));
  await press(page, {}, 2);
  await expect(page.getByTestId('tw-widget-counter1')).toContainText('Coins');
  await expect(page.getByTestId('tw-widget-counter1')).toContainText('7');

  // the game's own controls: the new action, the changed key
  const bindings = await page.evaluate(() => window.__play!.session.inputMap.bindings);
  expect(bindings.dash).toEqual(['key:KeyZ']);
  expect(bindings.interact?.[0]).toBe('key:KeyF');
  await press(page, { pause: 1 }, 1);
  await page.getByTestId('tw-row-settings').click();
  await page.getByTestId('tw-row-set-controls').click();
  await expect(page.getByTestId('tw-row-bind-dash')).toContainText('Quick dash');
  await expect(page.getByTestId('tw-row-bind-dash')).toContainText('Z');
  await page.screenshot({ path: shot('m15-controls-screen.png') });

  // save to a slot, leave, play again: Continue is offered and loads the save
  await press(page, {}, 1);
  await press(page, { pause: 1 }, 1);
  await press(page, {}, 1);
  await press(page, { pause: 1 }, 1);
  await press(page, {}, 1);
  await page.getByTestId('tw-row-save').click();
  await page.getByTestId('tw-row-slot-slot1').click();
  await page.getByTestId('btn-stop').click();
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-row-continue')).toBeVisible();
  await page.getByTestId('tw-row-continue').click();
  await expect(page.getByTestId('tw-menu')).toHaveCount(0);
  await expect.poll(() => page.evaluate(() => window.__play!.sim.runtime.vars['coins'])).toBe(7);
  expect(errors).toEqual([]);
  await app.close();
});
