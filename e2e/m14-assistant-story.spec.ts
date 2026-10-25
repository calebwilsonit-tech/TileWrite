import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

const idle = (page: Page) => expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 20_000 });

function toolResults(body: Record<string, any>): { id: string; error: boolean; text: string }[] { // eslint-disable-line @typescript-eslint/no-explicit-any
  const last = body.messages.at(-1);
  return (last.content as any[]).map((b) => ({ // eslint-disable-line @typescript-eslint/no-explicit-any
    id: b.tool_use_id,
    error: b.is_error === true,
    text: typeof b.content === 'string' ? b.content : b.content.map((c: any) => c.text ?? `[${c.type}]`).join('\n'), // eslint-disable-line @typescript-eslint/no-explicit-any
  }));
}

test('M14: Claude writes a conversation, items, regions and a translation as approved changes (the API is mocked)', async () => {
  test.setTimeout(240_000);
  const mock = await MockAnthropic.start();
  const { app, page, workDir, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Story Game', 'starter-room');
  const projectDir = path.join(workDir, 'Story Game');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();

  const dialogue = {
    name: 'Gatekeeper',
    start: 'hi',
    nodes: [
      { id: 'hi', type: 'line', speaker: 'Gatekeeper', text: 'Halt! Have you a pass?', next: 'ask' },
      { id: 'ask', type: 'choice', speaker: 'Gatekeeper', prompt: 'Well?', options: [{ text: 'Here it is.', next: 'ok', if: { kind: 'item', item: 'pass', atLeast: 1 } }, { text: 'No.', next: 'no' }] },
      { id: 'ok', type: 'set', variable: 'passed', value: 1, next: 'bye' },
      { id: 'no', type: 'line', speaker: 'Gatekeeper', text: 'Then you shall not pass.' },
      { id: 'bye', type: 'line', speaker: 'Gatekeeper', text: 'Go on through.' },
    ],
  };
  mock.enqueue(
    { content: [{ type: 'text', text: 'Let me see what the story has so far.' }, tool('s1', 'story_overview', {})] },
    {
      content: [
        { type: 'text', text: 'I will add a pass item, a gatekeeper conversation that checks for it, and a room for the gate.' },
        tool('s2', 'write_items', { items: [{ id: 'pass', name: 'Gate pass', description: 'Lets you through the gate.', color: 0xffd34a }] }),
        tool('s3', 'write_dialogue', dialogue),
        tool('s4', 'set_regions', { regions: [{ name: 'Gate yard', x: 2, y: 2, w: 10, h: 10, cameraBounds: true, music: 'yard-theme' }] }),
      ],
    },
    { content: [tool('s5', 'get_translations', { language: 'fr' })] },
    {
      content: [
        tool('s6', 'write_translation', { language: 'fr', name: 'Français', strings: { 'Halt! Have you a pass?': 'Halte ! Avez-vous un laissez-passer ?', 'Here it is.': 'Le voici.', 'Not a line from this game': 'ignored' } }),
      ],
    },
    { content: [{ type: 'text', text: 'Done: the gatekeeper talks, the pass exists, the yard is a room, and the first line is in French.' }] },
  );
  await page.getByTestId('assistant-input').fill('Add a gatekeeper who wants a pass, a room for the gate, and start a French translation.');
  await page.getByTestId('assistant-send').click();

  // the reading call sees the (still empty) story
  await expect(page.getByTestId('proposal').first()).toContainText('item');
  expect(toolResults(mock.requests[1]!.body)[0]!.text).toMatch(/"items": \{\s+"records": \[\]/);

  // nothing is written until each card is approved
  expect(fs.existsSync(path.join(projectDir, 'assets', 'items.json'))).toBe(false);
  await page.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('proposal').nth(1)).toContainText('Gatekeeper');
  await expect(page.getByTestId('proposal-diff').last()).toContainText('Halt! Have you a pass?');
  expect(await page.evaluate(() => (window.__store!.dataList('items') as { id: string; name: string }[]).map((i) => i.id))).toEqual(['pass']);
  await page.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('proposal').nth(2)).toContainText('region');
  expect(await page.evaluate(() => [...window.__store!.story.dialogues.keys()])).toEqual(['Gatekeeper']);
  expect(await page.evaluate(() => window.__store!.story.dialogues.get('Gatekeeper')!.nodes.length)).toBe(5);
  await page.getByTestId('proposal-apply').click();
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'assets', 'items.json')) && fs.existsSync(path.join(projectDir, 'assets', 'dialogues', 'Gatekeeper.dialogue.json'))).toBe(true);
  expect(await page.evaluate(() => window.__store!.doc!.regions.map((r) => [r.name, r.w, r.music, r.cameraBounds]))).toEqual([['Gate yard', 10, 'yard-theme', true]]);

  // Claude asks what is left to translate, then translates two lines; the line that is not from this game is ignored
  await expect(page.getByTestId('proposal').nth(3)).toContainText('Français');
  const overview = toolResults(mock.requests[2]!.body)[0]!;
  expect(overview.error).toBe(false);
  const translations = toolResults(mock.requests[3]!.body)[0]!;
  expect(translations.text).toContain('There is no language');
  expect(translations.text).toContain('Halt! Have you a pass?');
  await expect(page.getByTestId('proposal').nth(3)).toContainText('not text from this game');
  await page.getByTestId('proposal-apply').click();
  const frFile = path.join(projectDir, 'assets', 'localization', 'fr.strings.json');
  await expect.poll(() => fs.existsSync(frFile)).toBe(true);
  const fr = JSON.parse(fs.readFileSync(frFile, 'utf8')) as { name: string; strings: Record<string, string> };
  expect(fr.name).toBe('Français');
  expect(fr.strings).toEqual({ 'Halt! Have you a pass?': 'Halte ! Avez-vous un laissez-passer ?', 'Here it is.': 'Le voici.' });
  await expect(page.getByTestId('chat-assistant').last()).toContainText('the first line is in French');
  await idle(page);

  // the whole region change was one undo step, and a bad request is explained so Claude can correct it
  await page.getByTestId('btn-undo').click();
  expect(await page.evaluate(() => window.__store!.doc!.regions.length)).toBe(0);
  mock.enqueue(
    { content: [tool('x1', 'write_dialogue', { name: 'Broken', start: 'nowhere', nodes: [{ id: 'a', type: 'end' }] })] },
    { content: [{ type: 'text', text: 'Sorry, the start step must exist.' }] },
  );
  await page.getByTestId('assistant-input').fill('Make a broken conversation.');
  await page.getByTestId('assistant-send').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('start step must exist');
  const bad = toolResults(mock.requests.at(-1)!.body)[0]!;
  expect(bad.error).toBe(true);
  expect(bad.text).toContain('"start" is "nowhere"');
  expect(await page.evaluate(() => [...window.__store!.story.dialogues.keys()])).toEqual(['Gatekeeper']);
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
