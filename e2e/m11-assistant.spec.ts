import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';

const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
}

const idle = (page: Page) => expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 20_000 });

function toolResults(body: Record<string, any>): { id: string; error: boolean; text: string }[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const last = body.messages.at(-1);
  return (last.content as any[]).map((b) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: b.tool_use_id,
    error: b.is_error === true,
    text: typeof b.content === 'string' ? b.content : b.content.map((c: any) => c.text ?? `[${c.type}]`).join('\n'), // eslint-disable-line @typescript-eslint/no-explicit-any
  }));
}

function allFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}

test('M11: ask Claude to explain a broken event sheet, fix it with an approved change, build a plate-and-gate room, and handle errors, with the API mocked', async () => {
  test.setTimeout(240_000);
  const mock = await MockAnthropic.start();
  const { app, page, base, workDir, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Claude Game', 'empty-iso');
  const projectDir = path.join(workDir, 'Claude Game');

  // ---- a deliberately broken event sheet, made with the Events panel ----
  await page.locator('.dv-tab', { hasText: 'Events' }).click();
  await page.getByTestId('add-row').click();
  const rowId = await page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  await page.getByTestId(`add-action-${rowId}`).selectOption('spawn');
  await expect(page.getByTestId('event-problems')).toContainText('no prefab is chosen');

  // ---- no key yet: asking explains what to do and keeps the question ----
  await page.getByTestId('events-explain').click();
  await expect(page.getByTestId('assistant-panel')).toBeVisible();
  await expect(page.getByTestId('key-box')).toBeVisible();
  await expect(page.getByTestId('assistant-input')).toHaveValue(/no prefab is chosen/);
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('assistant-error')).toContainText('Add your Anthropic API key');
  expect(mock.requests.length).toBe(0);

  // project notes, saved in the project
  await page.getByTestId('notes-box').locator('summary').click();
  await page.getByTestId('notes-text').fill('No puzzle may be bypassable.');
  await page.getByTestId('notes-save').click();
  await expect.poll(() => (fs.existsSync(path.join(projectDir, 'project-notes.md')) ? fs.readFileSync(path.join(projectDir, 'project-notes.md'), 'utf8') : '')).toContain('No puzzle may be bypassable.');

  // the key goes to the keychain, not to files
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();
  await expect(page.getByTestId('key-box')).toHaveCount(0);
  const keyFile = path.join(base, 'userdata', 'assistant-key.bin');
  await expect.poll(() => fs.existsSync(keyFile)).toBe(true);
  expect(fs.readFileSync(keyFile).includes(Buffer.from(KEY))).toBe(false); // encrypted
  expect(JSON.stringify(await page.evaluate(() => window.tilewright.settings.get()))).not.toContain('TESTKEY');
  expect(await page.evaluate(() => Object.keys(window.tilewright.assistant))).not.toContain('getKey');

  // ---- (a) explain the broken sheet ----
  mock.enqueue(
    { content: [{ type: 'thinking', thinking: 'Let me look at the sheet first.', signature: 'sig-explain' }, { type: 'text', text: 'Let me look.' }, tool('t1', 'get_event_sheet', {}), tool('t2', 'get_problems', {})] },
    { content: [{ type: 'text', text: 'The row says "spawn" but no prefab is chosen, so it has nothing to create. Pick a prefab in the row, or remove the action.' }] },
  );
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('no prefab is chosen, so it has nothing to create');
  await idle(page);
  expect(await page.getByTestId('chat-tool').allTextContents()).toEqual(expect.arrayContaining([expect.stringContaining('Read the event sheet'), expect.stringContaining('Read the problem list')]));
  await expect(page.getByTestId('assistant-usage')).toContainText('tokens in');

  const [r1, r2] = mock.requests;
  expect(r1!.headers['x-api-key']).toBe(KEY);
  expect(r1!.body.model).toBe('claude-opus-5-5');
  expect(r1!.body.stream).toBe(true);
  expect(r1!.body.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
  expect(r1!.body.output_config.effort).toBe('high');
  expect(r1!.body.cache_control).toEqual({ type: 'ephemeral' });
  expect(r1!.body.fallbacks).toBe('default'); // the refusal fallback is on by default
  expect(String(r1!.headers['anthropic-beta'])).toContain('server-side-fallback-2026-07-01');
  expect(r1!.body.tools.length).toBeGreaterThanOrEqual(25);
  expect(r1!.body.tools.every((t: { eager_input_streaming?: boolean }) => t.eager_input_streaming === true)).toBe(true);
  expect(String(r1!.body.system)).toContain('Tilewright');
  const first = r1!.body.messages[0].content;
  expect(first[0].text).toContain('Project: "Claude Game".');
  expect(first[0].text).toContain('No puzzle may be bypassable.');
  expect(first[1].text).toMatch(/^Mode: Explain\./);
  expect(first[1].text).toContain('no prefab is chosen');
  // the second request is the first plus Claude's reply (thinking passed back unchanged) and both results together
  expect(r2!.body.messages[0]).toEqual(r1!.body.messages[0]);
  expect(r2!.body.messages[1].content[0]).toMatchObject({ type: 'thinking', thinking: 'Let me look at the sheet first.', signature: 'sig-explain' });
  const res1 = toolResults(r2!.body);
  expect(res1.map((r) => r.id)).toEqual(['t1', 't2']);
  expect(res1[0]!.text).toContain('no prefab is chosen');
  expect(JSON.stringify(r2!.body.tools)).toBe(JSON.stringify(r1!.body.tools));
  expect(r2!.body.system).toBe(r1!.body.system);
  await page.screenshot({ path: shot('m11-explain.png') });

  // ---- (b) fix it: Claude proposes, nothing changes until Apply, and it is one undo step ----
  const fixedRows = [{ comment: 'Say hello at the start', conditions: [{ type: 'start' }], actions: [{ type: 'setVariable', params: { name: 'ready' } }] }];
  mock.enqueue({ content: [tool('t3', 'set_event_sheet', { rows: fixedRows })] }, { content: [{ type: 'text', text: 'I replaced the broken row with one that sets "ready" when the game starts.' }] });
  await page.locator('.dv-tab', { hasText: 'Events' }).click();
  await page.getByTestId('events-fix').click(); // with a key, the question is sent straight away
  const card = page.getByTestId('proposal').last();
  await expect(card).toContainText('Change the event sheet');
  await expect(page.getByTestId('proposal-diff')).toContainText('Event sheet');
  expect(await page.evaluate(() => window.__store!.doc!.events.at(-1)!.actions[0]!.type)).toBe('spawn'); // not applied yet
  await page.screenshot({ path: shot('m11-proposal.png') });
  await page.getByTestId('proposal-apply').click();
  await expect(card).toHaveAttribute('data-status', 'applied');
  expect(await page.evaluate(() => window.__store!.doc!.events.map((e) => e.actions.map((a) => a.type)))).toEqual([['setVariable']]);
  await expect(page.getByTestId('chat-assistant').last()).toContainText('I replaced the broken row');
  await idle(page);
  expect(toolResults(mock.requests.at(-1)!.body)[0]!.text).toContain('Applied.');
  await page.getByTestId('btn-undo').click(); // one undo step brings the broken sheet back...
  expect(await page.evaluate(() => window.__store!.doc!.events.at(-1)!.actions[0]!.type)).toBe('spawn');
  await page.getByTestId('btn-redo').click();
  expect(await page.evaluate(() => window.__store!.doc!.events.at(-1)!.actions[0]!.type)).toBe('setVariable');
  await page.locator('.dv-tab', { hasText: 'Events' }).click();
  await expect(page.getByTestId('event-problems')).toHaveCount(0);

  // ---- (c) build a plate-and-gate room from one sentence ----
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('assistant-new').click();
  await expect(page.getByTestId('chat-empty')).toBeVisible();
  const wall = { tile: 5, height: 3 };
  mock.enqueue(
    { content: [tool('b1', 'scene_summary', {}), tool('b2', 'list_prefabs', {}), tool('b3', 'get_tiles', { x: 10, y: 10, w: 14, h: 12 })] },
    {
      content: [
        { type: 'text', text: 'I will build a corridor with a crate and a plate, a wall with a gate, an exit behind it, and wire the plate to the gate.' },
        tool('b4', 'paint_tiles', {
          rects: [
            { x: 12, y: 13, w: 9, h: 1, ...wall },
            { x: 12, y: 15, w: 9, h: 1, ...wall },
            { x: 20, y: 14, w: 1, h: 1, ...wall },
            { x: 24, y: 0, w: 1, h: 16, ...wall },
            { x: 24, y: 17, w: 1, h: 15, ...wall },
          ],
        }),
        tool('b5', 'place_objects', {
          objects: [
            { prefab: 'crate', x: 14.5, y: 14.5 },
            { prefab: 'plate', x: 19.5, y: 14.5, name: 'Plate A' },
            { prefab: 'gate', x: 24.5, y: 16.5, name: 'Gate A' },
            { prefab: 'goal', x: 27.5, y: 16.5 },
          ],
        }),
        tool('b6', 'connect_wires', { wires: [{ from: 'Plate A', output: 'active', to: 'Gate A', input: 'open' }] }),
      ],
    },
    { content: [tool('b7', 'get_problems', {}), tool('b8', 'run_puzzle_check', { deep: true }), tool('b9', 'run_playbot', { mode: 'solve_to_goal' })] },
    { content: [{ type: 'text', text: 'The room is built. The checks found nothing wrong and the playbot reached the exit by pushing the crate onto the plate.' }] },
  );
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('mode-build').click();
  await send(page, 'Make a room where a crate on a plate opens a gate to the exit.');
  await expect(page.getByTestId('proposal').first()).toContainText('Paint');
  const sceneBefore = await page.evaluate(() => window.__store!.doc!.entities.length);
  expect(sceneBefore).toBe(1); // only the player: later changes wait for the earlier ones
  expect(await page.getByTestId('proposal').count()).toBe(1);
  await page.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('proposal').nth(1)).toContainText('Place 4 objects');
  expect(await page.evaluate(() => window.__store!.doc!.entities.length)).toBe(1);
  await page.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('proposal').nth(2)).toContainText('Wire');
  await page.screenshot({ path: shot('m11-build-proposal.png') });
  await page.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('The room is built', { timeout: 30_000 });
  await idle(page);

  const built = await page.evaluate(() => {
    const d = window.__store!.doc!;
    return { names: d.entities.map((e) => e.name).sort(), wires: d.wires.length, wall: d.map.getHeight(12, 13), gap: d.map.getHeight(24, 16) };
  });
  expect(built.names).toEqual(['Crate', 'Gate A', 'Exit', 'Plate A', 'Player'].sort());
  expect(built.wires).toBe(1);
  expect(built.wall).toBe(3);
  expect(built.gap).toBe(0);
  const checks = toolResults(mock.requests.at(-1)!.body);
  expect(checks.map((c) => c.id)).toEqual(['b7', 'b8', 'b9']);
  expect(JSON.parse(checks[1]!.text).issues).toEqual([]); // no bypass, nothing unreachable, no stuck crate
  expect(JSON.parse(checks[2]!.text).reachedGoal).toBe(true);
  expect(await page.evaluate(() => window.__store!.doc!.history.labels.slice(0, 3))).toEqual(['Claude: connect 1 wire', 'Claude: place 4 objects (4)', 'Claude: paint 50 cells']);
  const screenshotCall = toolResults(mock.requests.find((r) => r.body.messages.at(-1)?.content?.[0]?.tool_use_id === 'b1')!.body);
  expect(screenshotCall[2]!.text).toContain('"tiles"');
  await page.screenshot({ path: shot('m11-built.png') });

  // ---- rejecting, undoing, and a screenshot ----
  mock.enqueue(
    { content: [tool('c1', 'update_objects', { updates: [{ target: 'Gate A', name: 'Big gate' }] })] },
    { content: [tool('c2', 'delete_objects', { targets: ['Crate'] }), tool('c3', 'screenshot', {})] },
    { content: [{ type: 'text', text: 'Understood, I will leave the crate where it is.' }] },
  );
  await send(page, 'Rename the gate, then remove the crate.');
  await expect(page.getByTestId('proposal').last()).toContainText('Change 1 object');
  await page.getByTestId('proposal-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.some((e) => e.name === 'Big gate'))).toBe(true);
  await page.getByTestId('proposal-undo').last().click();
  await expect.poll(() => page.evaluate(() => window.__store!.doc!.entities.some((e) => e.name === 'Gate A'))).toBe(true);
  await expect(page.getByTestId('proposal').last()).toContainText('Delete');
  await page.getByTestId('proposal-reject').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('leave the crate');
  await idle(page);
  expect(await page.evaluate(() => window.__store!.doc!.entities.some((e) => e.name === 'Crate'))).toBe(true);
  const rejected = toolResults(mock.requests.at(-1)!.body);
  expect(rejected.find((r) => r.id === 'c2')!.text).toContain('rejected');
  expect(rejected.find((r) => r.id === 'c3')!.text).toMatch(/\[image\]|viewport/);

  // a mistake in a tool call is explained to Claude, and nothing changes
  mock.enqueue({ content: [tool('d1', 'place_objects', { objects: [{ prefab: 'dragon', x: 15.5, y: 15.5 }] }), tool('d2', 'connect_wires', { wires: [{ from: 'Plate A', output: 'nonsense', to: 'Gate A', input: 'open' }] })] }, { content: [{ type: 'text', text: 'Those did not work; I will stop here.' }] });
  await send(page, 'Add a dragon.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('I will stop here');
  const bad = toolResults(mock.requests.at(-1)!.body);
  expect(bad.every((b) => b.error)).toBe(true);
  expect(bad[0]!.text).toContain('There is no prefab "dragon"');
  expect(bad[1]!.text).toContain('cannot send "nonsense"');
  await expect(page.getByTestId('proposal')).toHaveCount(5); // the two bad calls never became proposals

  // ---- errors are explained, and Retry works ----
  mock.rejectFallbacks = true; // the API refuses the fallback beta: the editor carries on without it
  mock.enqueue({ content: [{ type: 'text', text: 'Fine without the fallback.' }] });
  const before = mock.requests.length;
  await send(page, 'Say something.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Fine without the fallback.');
  expect(mock.requests.slice(before).map((r) => [r.status, Boolean(r.body.fallbacks)])).toEqual([[400, true], [200, false]]);

  mock.enqueue({ status: 429 }, { status: 429 }, { status: 429 });
  await send(page, 'And again.');
  await expect(page.getByTestId('assistant-error')).toContainText('too many requests', { timeout: 30_000 });
  mock.enqueue({ content: [{ type: 'text', text: 'Back again.' }] });
  await page.getByTestId('assistant-retry').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Back again.');
  await expect(page.getByTestId('assistant-error')).toHaveCount(0);
  await idle(page);

  mock.enqueue({ status: 401, message: `invalid x-api-key ${KEY}` });
  await send(page, 'One more.');
  await expect(page.getByTestId('assistant-error')).toContainText('did not accept the API key');
  expect(await page.getByTestId('assistant-error').textContent()).not.toContain('TESTKEY');
  await expect(page.getByTestId('assistant-retry')).toHaveCount(0);

  mock.enqueue({ stop: 'refusal', content: [] });
  await send(page, 'Another.');
  await expect(page.getByText('Claude declined this request')).toBeVisible();
  expect(await page.getByTestId('assistant-usage').textContent()).toContain('about');

  // the rest of the editor is untouched by all this
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- the key never reaches a project file or the settings file ----
  await page.keyboard.press('Control+s');
  await expect.poll(() => fs.readFileSync(path.join(projectDir, 'scenes', 'main.scene.json'), 'utf8').includes('Plate A')).toBe(true);
  for (const f of allFiles(projectDir)) expect(fs.readFileSync(f).includes(Buffer.from('TESTKEY'))).toBe(false);
  for (const f of allFiles(path.join(base, 'userdata')).filter((x) => !x.endsWith('assistant-key.bin'))) {
    try {
      expect(fs.readFileSync(f).includes(Buffer.from('TESTKEY'))).toBe(false);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EBUSY' && (e as NodeJS.ErrnoException).code !== 'EPERM') throw e; // browser files that are locked while it runs
    }
  }
  expect(errors).toEqual([]);
  await app.close();

  // ---- the key is still there next time ----
  const again = await launchEditor(base, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await again.page.getByTestId('recent-item').first().click();
  await again.page.getByTestId('editor-shell').waitFor();
  await again.page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await expect(again.page.getByTestId('key-saved')).toBeVisible();
  await again.page.getByTestId('key-remove').click();
  await expect(again.page.getByTestId('key-box')).toBeVisible();
  expect(fs.existsSync(keyFile)).toBe(false);
  await again.app.close();
  await mock.close();
});
