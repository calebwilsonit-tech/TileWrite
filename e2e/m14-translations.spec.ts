import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchEditor, root, screenLayer, ui } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

type Snapshot = Record<string, number>;
async function play(page: Page, snapshot: Snapshot, ticks: number): Promise<void> {
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

/** The first line the elder says in the sample game, read from the sample's own file. */
const elder = JSON.parse(fs.readFileSync(path.join(root, 'packages', 'plugins', 'storytender', 'samples', 'last-storytender', 'assets', 'dialogues', 'Elder.dialogue.json'), 'utf8')) as { nodes: { type: string; text?: string }[] };
const FIRST = elder.nodes.find((n) => n.type === 'line')!.text!;

test('M14: add a language, translate a conversation and the menus, see them in the game, and switch language in Settings', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  const dir = await page.evaluate(() => window.__store!.state.project!.dir);

  // ---- add a language and translate two lines ----
  await tab(page, 'Story').click();
  await page.getByTestId('btn-translations').click();
  await expect(page.getByTestId('translations-dialog')).toBeVisible();
  await expect(page.getByTestId('tr-progress')).toHaveCount(0); // no language yet
  await page.getByTestId('tr-new-code').fill('NOT OK');
  await page.getByTestId('tr-add').click(); // refused with a message, nothing added
  await expect(page.getByTestId('tr-language')).toBeDisabled();
  await page.getByTestId('tr-new-code').fill('fr');
  await page.getByTestId('tr-new-name').fill('Français');
  await page.getByTestId('tr-add').click();
  await expect(page.getByTestId('tr-progress')).toContainText('0 of');
  await expect(page.getByTestId('tr-table')).toContainText(FIRST); // the sample's conversation was found
  await expect(page.getByTestId('tr-table')).toContainText('Resume'); // and the game menus
  await page.getByLabel(`Translation of: ${FIRST}`).fill('Voulez-vous les réparer ?');
  await page.getByLabel('Translation of: Resume').fill('Reprendre');
  await page.getByLabel('Translation of: Settings').fill('Réglages');
  await expect(page.getByTestId('tr-progress')).toContainText('3 of');
  await page.getByTestId('tr-only-missing').check();
  await expect(page.getByLabel('Translation of: Resume')).toHaveCount(0); // translated lines are hidden by the filter
  await page.getByTestId('tr-only-missing').uncheck();
  await page.screenshot({ path: path.join(root, 'screenshots', 'm14-translations.png') });
  await page.getByTestId('tr-save').click();
  const file = path.join(dir, 'assets', 'localization', 'fr.strings.json');
  await expect.poll(() => fs.existsSync(file) && (JSON.parse(fs.readFileSync(file, 'utf8')) as { strings: Record<string, string> }).strings.Resume === 'Reprendre').toBe(true);
  expect(JSON.parse(fs.readFileSync(file, 'utf8')).strings[FIRST]).toBe('Voulez-vous les réparer ?');
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // ---- the project check says the language is unfinished ----
  await tab(page, 'Problems').click();
  await page.getByTestId('check-project').click();
  await expect(page.getByTestId('project-check')).toContainText('The language Français is missing');

  // ---- in the game ----
  await page.evaluate(() => localStorage.setItem('tilewright.settings', JSON.stringify({ language: 'fr' })));
  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-dialogues').click();
  await page.getByTestId('dialogue-test').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-dialogue-text')).toHaveText('Voulez-vous les réparer ?');
  // finish the conversation, then open the pause menu
  for (let i = 0; i < 6; i++) {
    await play(page, { interact: 1 }, 1);
    await play(page, {}, 1);
    if (await page.evaluate(() => window.__play!.sim.runtime.dialogue === null)) break;
  }
  await play(page, { pause: 1 }, 1);
  await expect(ui(page, 'Resume')).toContainText('Reprendre');
  await ui(page, 'Settings').click();
  await expect(screenLayer(page, 'Settings')).toContainText('Réglages');
  await expect(ui(page, 'Language choice').locator('option:checked')).toHaveText('Français');
  await page.screenshot({ path: path.join(root, 'screenshots', 'm14-translations-menu.png') });
  await ui(page, 'Language choice').locator('select').selectOption({ label: 'Default' }); // Français -> the original text
  await expect(screenLayer(page, 'Settings')).toContainText('Settings');
  await expect(ui(page, 'Language choice').locator('option:checked')).toHaveText('Default');
  await ui(page, 'Language choice').locator('select').selectOption({ label: 'Français' }); // and back
  await expect(screenLayer(page, 'Settings')).toContainText('Réglages');
  expect(errors).toEqual([]);
  await app.close();
});
