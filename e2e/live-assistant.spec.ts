import { expect, test } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';

/**
 * The one test that talks to the real Anthropic API. It is skipped unless you provide a key:
 *
 *   $env:ANTHROPIC_API_KEY = 'sk-ant-...'; npm run test:live
 *
 * It costs a few cents. It checks that the key is accepted, a reply streams in, and a read-only tool call works.
 */
const key = process.env.ANTHROPIC_API_KEY;

test.skip(!key, 'set ANTHROPIC_API_KEY to run the live assistant test');

test('live: Claude answers a question about the open scene using the editor tools', async () => {
  test.setTimeout(180_000);
  const { app, page } = await launchEditor();
  await createProjectViaUi(page, 'Live Game', 'starter-room');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(key!);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();
  await page.getByTestId('assistant-model').selectOption({ index: 1 }); // a cheaper model is enough for this
  await page.getByTestId('assistant-effort').selectOption('low');
  await page.getByTestId('assistant-input').fill('How many objects are in this scene, and what are they called? Look at the scene before you answer.');
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('chat-tool').first()).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 120_000 });
  await expect(page.getByTestId('assistant-error')).toHaveCount(0);
  const reply = await page.getByTestId('chat-assistant').last().textContent();
  expect(reply).toMatch(/crate/i);
  await expect(page.getByTestId('assistant-usage')).toContainText('tokens in');
  await app.close();
});
