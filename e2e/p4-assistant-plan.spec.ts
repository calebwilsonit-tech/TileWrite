import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

/**
 * Round 2, section 7.8: an approved plan is carried out step by step. The person sees the steps ticked off, can ask Claude to stop
 * when the step it is on is done, and can put the project back to the start of any step (not only to before the whole run).
 */

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
}
function results(body: Body): { id: string; error: boolean; text: string }[] {
  const last = body.messages.at(-1);
  return (last.content as any[]).map((b) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content as any[]); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { id: b.tool_use_id, error: b.is_error === true, text: parts.map((c) => c.text ?? '').join('\n') };
  });
}

test('Round 2 section 7.8: the steps of a plan are ticked off, the person can stop between steps, and the project goes back to the start of a step', async () => {
  test.setTimeout(240_000);
  const mock = await MockAnthropic.start();
  const { page, app, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Steps', 'empty-iso');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();
  const names = () => page.evaluate(() => window.__store!.doc!.entities.map((e) => e.name));
  const before = (await names()).length;
  await page.getByTestId('assistant-permission').selectOption('plan');

  mock.enqueue({ content: [tool('p1', 'submit_plan', { title: 'A crate, then gone', steps: ['Place a crate', 'Take it away again', 'Place a second crate'] })] });
  await send(page, 'Do the three things.');
  const plan = page.getByTestId('proposal').last();
  await expect(plan).toContainText('A crate, then gone');
  // the steps appear once the plan is approved
  mock.enqueue(
    { content: [tool('s1', 'plan_step', { step: 1, status: 'start' }), tool('c1', 'place_objects', { objects: [{ prefab: 'crate', name: 'Crate A', x: 6.5, y: 6.5 }] })] },
    { content: [tool('s2', 'plan_step', { step: 1, status: 'done' }), tool('s3', 'plan_step', { step: 2, status: 'start' }), tool('d1', 'delete_objects', { targets: ['Crate A'] })] },
    { content: [tool('s4', 'plan_step', { step: 2, status: 'done' }), tool('s5', 'plan_step', { step: 3, status: 'start' })] },
    { content: [{ type: 'text', text: 'Stopped after the second step.' }] },
  );
  await plan.getByTestId('proposal-apply').click();
  // taking something away is asked about even though the plan is approved: while it waits, the person asks to stop after this step
  const del = page.getByTestId('proposal').last();
  await expect(del).toContainText('always asks before it takes something away');
  await expect(page.getByTestId('plan-step-1')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('plan-step-2')).toHaveAttribute('data-status', 'doing');
  expect(await names()).toContain('Crate A');
  await page.getByTestId('plan-stop').click();
  await expect(page.getByTestId('plan-stopping')).toBeVisible();
  await del.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Stopped after the second step.');
  expect(await names()).not.toContain('Crate A');
  // Claude was told to stop, and the third step was not begun
  const last = results(mock.requests.at(-1)!.body);
  expect(last.find((r) => r.id === 's4')!.text).toContain('The user stopped the plan between steps');
  expect(last.find((r) => r.id === 's5')!.error).toBe(true);
  await expect(page.getByTestId('plan-step-1')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('plan-step-2')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('plan-step-3')).toHaveAttribute('data-status', 'pending');
  await expect(page.getByTestId('plan-paused')).toBeVisible();
  // nothing more can be changed while it is held
  expect((await names()).length).toBe(before);

  // roll back to the start of step 2: the crate that step took away is there again, and steps 2 and 3 are not done
  await page.getByTestId('plan-rollback-2').click();
  await page.locator('.dv-tab', { hasText: 'Claude' }).click(); // (the project was opened again)
  await page.waitForFunction(() => window.__store!.doc !== null);
  expect(await names()).toContain('Crate A');
  await expect(page.getByTestId('plan-step-1')).toHaveAttribute('data-status', 'done');
  await expect(page.getByTestId('plan-step-2')).toHaveAttribute('data-status', 'undone');
  await expect(page.locator('.notice.info').last()).toContainText('Back to the start of step 2');

  // going on tells Claude what happened, and lets the plan run again from step 2
  mock.enqueue(
    { content: [tool('s6', 'plan_step', { step: 2, status: 'start' }), tool('c2', 'place_objects', { objects: [{ prefab: 'crate', name: 'Crate B', x: 8.5, y: 8.5 }] })] },
    { content: [tool('s7', 'plan_step', { step: 2, status: 'done' })] },
    { content: [{ type: 'text', text: 'Carried on.' }] },
  );
  await page.getByTestId('plan-continue').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Carried on.');
  const asked = mock.requests.find((r) => JSON.stringify(r.body.messages.at(-1)).includes('rolled the project back to the start of step 2'));
  expect(asked).toBeTruthy();
  expect(JSON.stringify(asked!.body.messages.at(-1))).toContain('Go on with the plan from step 2');
  expect(await names()).toContain('Crate B');
  await expect(page.getByTestId('plan-step-2')).toHaveAttribute('data-status', 'done');
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
