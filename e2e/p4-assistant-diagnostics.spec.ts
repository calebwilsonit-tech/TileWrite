import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

/**
 * Round 2, section 7.9: Claude can read the Console, measure where the time goes, check the whole project the way Export does, and
 * run the project's saved playthroughs (its tests).
 */

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function results(body: Body): { id: string; error: boolean; text: string }[] {
  const last = body.messages.at(-1);
  return (last.content as any[]).map((b) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content as any[]); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { id: b.tool_use_id, error: b.is_error === true, text: parts.map((c) => c.text ?? '').join('\n') };
  });
}
async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
}

test('Round 2 section 7.9: the Console, the profiler, the whole-project check and the saved playthroughs are tools', async () => {
  test.setTimeout(180_000);
  const mock = await MockAnthropic.start();
  const { page, app, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Diag', 'empty-iso');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();
  // something for the Console to say
  await page.evaluate(() => window.__store!.notify('warn', 'The gate has nothing to open.'));

  mock.enqueue(
    {
      content: [
        tool('c1', 'read_console', { level: 'warn' }),
        tool('p1', 'profile_game', { seconds: 2 }),
        tool('k1', 'run_project_checks', {}),
        tool('t1', 'run_playthroughs', {}),
      ],
    },
    { content: [{ type: 'text', text: 'Looked everywhere.' }] },
  );
  await send(page, 'Is anything wrong, or slow?');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Looked everywhere');
  const r = results(mock.requests.at(-1)!.body);
  const by = (id: string) => r.find((x) => x.id === id)!;
  expect(by('c1').text).toContain('The gate has nothing to open.');
  expect(by('c1').text).toContain('[warn]');
  expect(by('p1').error).toBe(false);
  expect(by('p1').text).toContain('Ran the open scene for');
  expect(by('p1').text).toMatch(/A game step took \d+\.\d+ ms on average/);
  expect(by('k1').error).toBe(false);
  expect(by('k1').text).toMatch(/no problems|errors/);
  expect(by('t1').text).toContain('no saved playthroughs');
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
