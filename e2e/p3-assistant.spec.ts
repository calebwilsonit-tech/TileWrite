import { expect, test, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

// a 1 x 1 PNG, and a 3 x 3 one for the pictures the person attaches
const PNG_1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGP4z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==', 'base64');

type Body = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any

const idle = (page: Page) => expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 20_000 });

async function send(page: Page, text: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(text);
  await page.getByTestId('assistant-send').click();
}

/** What the tools answered, in the last request: the words, and the kinds of block that came with them. */
function results(body: Body): { id: string; error: boolean; text: string; kinds: string[] }[] {
  const last = body.messages.at(-1);
  return (last.content as any[]).map((b) => { // eslint-disable-line @typescript-eslint/no-explicit-any
    const parts = typeof b.content === 'string' ? [{ type: 'text', text: b.content }] : (b.content as any[]); // eslint-disable-line @typescript-eslint/no-explicit-any
    return { id: b.tool_use_id, error: b.is_error === true, text: parts.map((c) => c.text ?? '').join('\n'), kinds: parts.map((c) => c.type) };
  });
}

async function setUp(name: string, extraPacks: string[] = []) {
  const mock = await MockAnthropic.start();
  const launched = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  const { page, workDir } = launched;
  await createProjectViaUi(page, name, 'empty-iso');
  const projectDir = path.join(workDir, name);
  if (extraPacks.length > 0) await page.evaluate((packs) => window.__store!.updateProjectSettings({ plugins: packs }), ['combat', 'inventory', 'story', 'ai', 'lighting', 'storytender', ...extraPacks]);
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();
  return { mock, projectDir, ...launched };
}

test('Phase 3: Claude reads the project (every kind of file, nothing outside it), sees pictures the person attaches, and is honest about sound', async () => {
  test.setTimeout(180_000);
  const { mock, page, app, projectDir, errors } = await setUp('Files');
  // a sound, a picture and a text file in the project, and a secret next to it
  fs.mkdirSync(path.join(projectDir, 'assets', 'audio'), { recursive: true });
  const wav = Buffer.alloc(44 + 16000);
  wav.write('RIFF', 0);
  wav.writeUInt32LE(36 + 16000, 4);
  wav.write('WAVEfmt ', 8);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(16000, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write('data', 36);
  wav.writeUInt32LE(16000, 40);
  fs.writeFileSync(path.join(projectDir, 'assets', 'audio', 'jump.wav'), wav);
  fs.mkdirSync(path.join(projectDir, 'assets', 'art'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'assets', 'art', 'dot.png'), PNG_1);
  fs.writeFileSync(path.join(projectDir, 'assets', 'todo.md'), '# To do\nAdd a second room.\n');
  fs.writeFileSync(path.join(path.dirname(projectDir), 'secret.txt'), 'the secret');
  // files that hold secrets inside the project: a built-in kind, and one the person added to the list in Project settings
  fs.mkdirSync(path.join(projectDir, 'keys'), { recursive: true });
  fs.mkdirSync(path.join(projectDir, 'private'), { recursive: true });
  fs.writeFileSync(path.join(projectDir, '.env'), 'API_TOKEN=hunter2');
  fs.writeFileSync(path.join(projectDir, 'keys', 'server.pem'), 'PRIVATE-KEY-BODY');
  fs.writeFileSync(path.join(projectDir, 'private', 'notes.txt'), 'my private notes');
  await page.evaluate(() => window.__store!.updateProjectSettings({ assistantDeny: ['private/**'] }));

  mock.enqueue(
    {
      content: [
        tool('f1', 'project_index', {}),
        tool('f2', 'read_project_file', { path: 'assets/todo.md' }),
        tool('f3', 'read_project_file', { path: 'assets/audio/jump.wav' }),
        tool('f4', 'read_project_file', { path: 'assets/art/dot.png' }),
        tool('f5', 'read_project_file', { path: '../secret.txt' }),
        tool('f6', 'read_project_file', { path: 'assets\\..\\..\\secret.txt' }),
        tool('f7', 'read_project_file', { path: 'C:\\Windows\\win.ini' }),
        tool('f8', 'read_project_file', { path: 'project.json:stream' }),
        tool('f9', 'read_project_file', { path: 'assets/nothing-here.json' }),
        tool('f10', 'list_project_files', { folder: 'assets' }),
        tool('f11', 'read_project_file', { path: '.env' }),
        tool('f12', 'read_project_file', { path: 'keys/server.pem' }),
        tool('f13', 'read_project_file', { path: 'private/notes.txt' }),
        tool('f14', 'list_project_files', {}),
      ],
    },
    { content: [{ type: 'text', text: 'I looked at everything I could.' }] },
  );
  await send(page, 'What is in my project?');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('I looked at everything');
  await idle(page);
  const r = results(mock.requests.at(-1)!.body);
  const by = (id: string) => r.find((x) => x.id === id)!;
  expect(by('f1').text).toContain('Files in "Files"');
  expect(by('f1').text).toContain('Sounds (I cannot listen to these): 1');
  expect(by('f1').text).toContain('assets/audio/jump.wav');
  expect(by('f2').text).toContain('Add a second room.');
  // a sound: its measurements, and a plain statement of what is not known
  expect(by('f3').text).toContain('1.00 s');
  expect(by('f3').text).toContain('8000 Hz');
  expect(by('f3').text).toContain('I cannot listen to sound');
  // a picture is returned as a picture
  expect(by('f4').kinds).toContain('image');
  // every way out of the project is refused, in words Claude can act on
  for (const id of ['f5', 'f6', 'f7', 'f8']) {
    expect(by(id).error, id).toBe(true);
    expect(by(id).text, id).not.toContain('the secret');
  }
  expect(by('f5').text).toContain('inside the project');
  expect(by('f7').text).toContain('from the project folder');
  expect(by('f8').text).toContain('colon');
  expect(by('f9').error).toBe(true);
  expect(by('f9').text).toContain('There is no file');
  expect(by('f10').text).toContain('audio/');
  // a file that may hold a secret is refused, whatever its name, and is left out of the lists; the person's own patterns count too
  for (const id of ['f11', 'f12', 'f13']) {
    expect(by(id).error, id).toBe(true);
    expect(by(id).text, id).toContain('may hold a secret');
    expect(by(id).text, id).not.toMatch(/hunter2|PRIVATE-KEY-BODY|my private notes/);
  }
  for (const id of ['f1', 'f14']) expect(by(id).text, id).not.toMatch(/\.env|server\.pem|notes\.txt/);
  // the first message of the conversation carries the list of files
  expect(mock.requests[0]!.body.messages[0].content[0].text).toContain('Files in "Files"');

  // ---- a picture the person attaches goes along with the question ----
  mock.enqueue({ content: [{ type: 'text', text: 'It is a single dot.' }] });
  await page.getByTestId('assistant-file').setInputFiles({ name: 'sketch.png', mimeType: 'image/png', buffer: PNG_1 });
  await expect(page.getByTestId('attachments')).toBeVisible();
  await send(page, 'What do you see in this sketch?');
  await expect(page.getByTestId('chat-user-images')).toBeVisible();
  await expect(page.getByTestId('attachments')).toHaveCount(0);
  await expect(page.getByTestId('chat-assistant').last()).toContainText('single dot');
  const content = mock.requests.at(-1)!.body.messages.at(-1).content as { type: string; text?: string; source?: { media_type: string; type: string } }[];
  expect(content.map((b) => b.type)).toEqual(['text', 'image', 'text']);
  expect(content[0]!.text).toContain('sketch.png');
  expect(content[1]!.source).toMatchObject({ type: 'base64', media_type: 'image/png' });
  // something that is not a picture is refused with a word
  await page.getByTestId('assistant-file').setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('hello') });
  await expect(page.locator('.notice.warn').last()).toContainText('not a picture Claude can look at');
  await page.screenshot({ path: shot('p3-assistant-files.png') });
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});

test('Phase 3: Claude draws a sprite and makes a picture with a provider; the person sees each before it is kept', async () => {
  test.setTimeout(180_000);
  const { mock, page, app, projectDir, errors } = await setUp('Pictures', ['example-assistant']);
  mock.enqueue(
    { content: [tool('d0', 'list_image_providers', {})] },
    {
      content: [
        tool('d1', 'draw_sprite', {
          name: 'gem',
          width: 4,
          height: 4,
          palette: ['#ff2244', '#ffffff'],
          rows: ['.11.', '1221', '1221', '.11.'],
        }),
      ],
    },
    { content: [{ type: 'text', text: 'I drew a little gem.' }] },
  );
  await send(page, 'Draw me a red gem.');
  const card = page.getByTestId('proposal').last();
  await expect(card).toContainText('Draw the sprite "gem"');
  await expect(card.getByTestId('proposal-images').locator('img')).toBeVisible();
  expect(fs.existsSync(path.join(projectDir, 'assets', 'sprites', 'gem.sprite.json'))).toBe(false); // not yet
  await page.screenshot({ path: shot('p3-assistant-draw.png') });
  await card.getByTestId('proposal-apply').click();
  await expect(card).toHaveAttribute('data-status', 'applied');
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'assets', 'sprites', 'gem.sprite.json'))).toBe(true);
  await idle(page);
  const providers = results(mock.requests[1]!.body)[0]!;
  expect(providers.text).toContain('example-mock-art');
  // a row of the wrong length is refused with the row number, and nothing is shown
  mock.enqueue(
    { content: [tool('d2', 'draw_sprite', { name: 'bad', width: 4, height: 2, palette: ['#ffffff'], rows: ['.11.', '1'] })] },
    { content: [{ type: 'text', text: 'Let me fix that.' }] },
  );
  await send(page, 'Draw another.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Let me fix that');
  const bad = results(mock.requests.at(-1)!.body)[0]!;
  expect(bad.error).toBe(true);
  expect(bad.text).toContain('row 2 is 1 characters long');
  // Undo this takes the sprite out again
  await card.getByTestId('proposal-undo').click();
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'assets', 'sprites', 'gem.sprite.json'))).toBe(false);

  // ---- a picture provider (the mock one): asked only after a yes, and Claude sees what it made ----
  mock.enqueue(
    { content: [tool('g1', 'generate_image', { provider: 'example-mock-art', prompt: 'a mossy stone wall', name: 'mossy', width: 32, height: 32 })] },
    { content: [{ type: 'text', text: 'The picture came out well.' }] },
  );
  await send(page, 'Make a picture of a mossy stone wall.');
  const gen = page.getByTestId('proposal').last();
  await expect(gen).toContainText('Make a picture "mossy"');
  expect(fs.existsSync(path.join(projectDir, 'assets', 'sprites', 'mossy.sprite.json'))).toBe(false); // the provider has not been asked yet
  await gen.getByTestId('proposal-apply').click();
  await expect(gen).toHaveAttribute('data-status', 'applied');
  await expect(gen.getByTestId('proposal-images').locator('img')).toBeVisible();
  await expect.poll(() => fs.existsSync(path.join(projectDir, 'assets', 'sprites', 'mossy.sprite.json'))).toBe(true);
  await expect(page.getByTestId('chat-assistant').last()).toContainText('came out well');
  const made = results(mock.requests.at(-1)!.body)[0]!;
  expect(made.text).toContain('Saved the picture as the sprite "mossy"');
  expect(made.kinds).toContain('image'); // Claude is shown the picture to judge it
  // a tool and a file reader a plugin added are used like the editor's own
  fs.writeFileSync(path.join(projectDir, 'assets', 'plan.txt'), 'Build the lighthouse first.');
  mock.enqueue(
    { content: [tool('x1', 'example-assistant__example_count', {}), tool('x2', 'read_project_file', { path: 'assets/plan.txt' })] },
    { content: [{ type: 'text', text: 'Both worked.' }] },
  );
  await send(page, 'Use the plugin tool and read the plan.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Both worked');
  expect(mock.requests.at(-2)!.body.tools.some((x: { name: string }) => x.name === 'example-assistant__example_count')).toBe(true);
  const plug = results(mock.requests.at(-1)!.body);
  expect(plug[0]!.text).toContain('The example plugin cannot see the scene');
  expect(plug[1]!.text).toContain('Build the lighthouse first.');
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});

test('Phase 3: the permission levels, a plan before big changes, rolling a run back, and the cost limit of a run', async () => {
  test.setTimeout(240_000);
  const { mock, page, app, projectDir, errors } = await setUp('Levels');
  const sceneCount = () => page.evaluate(() => window.__store!.doc!.entities.length);
  const before = await sceneCount();
  const place = (id: string, name: string) => tool(id, 'place_objects', { objects: [{ prefab: 'crate', name, x: 6.5, y: 6.5 }] });

  // ---- look only: nothing can change, and Claude is told why ----
  await page.getByTestId('assistant-permission').selectOption('look');
  mock.enqueue({ content: [place('l1', 'Crate A')] }, { content: [{ type: 'text', text: 'I am not allowed to place it.' }] });
  await send(page, 'Put a crate down.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('not allowed');
  const refused = results(mock.requests.at(-1)!.body)[0]!;
  expect(refused.error).toBe(true);
  expect(refused.text).toContain('Look only');
  await expect(page.getByTestId('proposal')).toHaveCount(0);
  expect(await sceneCount()).toBe(before);

  // ---- plan first: nothing changes until a plan is approved, then the steps go ahead without asking ----
  await page.getByTestId('assistant-new').click();
  await page.getByTestId('assistant-permission').selectOption('plan');
  mock.enqueue({ content: [place('p1', 'Crate B')] }, { content: [tool('p2', 'submit_plan', { title: 'Two crates', steps: ['Place a crate B', 'Place a crate C'], risks: ['Nothing is deleted'] })] });
  await send(page, 'Put two crates down.');
  const plan = page.getByTestId('proposal').last();
  await expect(plan).toContainText('Two crates');
  await expect(plan.getByTestId('plan-risks')).toContainText('Nothing is deleted');
  const tooEarly = results(mock.requests.at(-1)!.body);
  expect(tooEarly.length).toBe(1); // the change asked for before the plan was answered, and the plan is waiting
  expect(await sceneCount()).toBe(before);
  mock.enqueue({ content: [place('p3', 'Crate B'), place('p4', 'Crate C')] }, { content: [{ type: 'text', text: 'Both crates are down.' }] });
  await plan.getByTestId('proposal-apply').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Both crates are down');
  await idle(page);
  expect(await sceneCount()).toBe(before + 2);
  // the changes were made without asking, and say so
  await expect(page.getByTestId('proposal-auto').first()).toBeVisible();
  const planRequests = mock.requests.map((x) => x.body.messages.length);
  expect(planRequests.at(-1)).toBeGreaterThan(planRequests.at(-2)!);
  // the run can be taken back in one step
  await expect(page.getByTestId('run-card')).toContainText('2 changes made without asking');
  await page.screenshot({ path: shot('p3-assistant-run.png') });
  await page.getByTestId('run-rollback').click();
  await page.locator('.dv-tab', { hasText: 'Claude' }).click(); // (the project was opened again, so the windows are as they start)
  await expect(page.getByTestId('run-state')).toContainText('Back as it was');
  await page.waitForFunction(() => window.__store!.doc !== null);
  expect(await sceneCount()).toBe(before);
  const saved = JSON.parse(fs.readFileSync(path.join(projectDir, 'scenes', 'main.scene.json'), 'utf8')) as { entities: unknown[] };
  expect(saved.entities.length).toBe(before);

  // ---- do it, I can undo: changes go in at once ----
  await page.getByTestId('assistant-new').click();
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('assistant-permission').selectOption('auto');
  mock.enqueue({ content: [place('a1', 'Crate D')] }, { content: [{ type: 'text', text: 'Placed.' }] });
  await send(page, 'One more crate.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Placed.');
  expect(await sceneCount()).toBe(before + 1);

  // ---- even then, taking things away, changing plugins and using the network are asked about ----
  await page.getByTestId('assistant-new').click();
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('assistant-permission').selectOption('auto');
  const withD = await sceneCount();
  mock.enqueue(
    { content: [tool('d1', 'delete_objects', { targets: ['Crate D'] })] },
    { content: [{ type: 'text', text: 'Waiting for you.' }] },
  );
  await send(page, 'Take the crate away.');
  const askDelete = page.getByTestId('proposal').last();
  await expect(askDelete).toContainText('always asks before it takes something away');
  await expect(askDelete.getByTestId('proposal-auto')).toHaveCount(0);
  expect(await sceneCount()).toBe(withD); // nothing was taken away yet
  await askDelete.getByTestId('proposal-reject').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Waiting for you.');
  expect(await sceneCount()).toBe(withD);
  mock.enqueue({ content: [tool('d2', 'set_plugins', { enable: ['example-assistant'] })] }, { content: [{ type: 'text', text: 'Asked.' }] });
  await send(page, 'Turn on a plugin.');
  await expect(page.getByTestId('proposal').last()).toContainText('always asks before it changes which plugins are on');
  expect(await page.evaluate(() => window.__store!.state.project!.project.plugins ?? [])).not.toContain('example-assistant');
  await page.getByTestId('proposal').last().getByTestId('proposal-reject').click();
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Asked.');

  // ---- a run that costs more than the limit is stopped, with the tools it asked for answered ----
  await page.getByTestId('assistant-new').click();
  await page.getByTestId('assistant-permission').selectOption('ask');
  await page.locator('details.more summary').click();
  await page.getByTestId('assistant-limit').fill('1');
  const big = { input: 400_000, output: 10_000 }; // about $1.80 at list prices
  mock.enqueue({ content: [tool('c1', 'get_problems', {})], usage: big }, { content: [tool('c2', 'get_problems', {})], usage: big });
  await send(page, 'Keep checking.');
  await expect(page.locator('.notice.info, .notice.warn').last()).toContainText('limit you set');
  await expect(page.getByTestId('assistant-run-usage')).toContainText('of the $1.00 you allow');
  const last = mock.requests.at(-1)!;
  expect(last.body.messages.at(-1).role).toBe('user'); // nothing was left unanswered
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});

test('Phase 3: Claude builds with blocks and turns gravity, and both are one undo step', async () => {
  test.setTimeout(120_000);
  const { mock, page, app, errors } = await setUp('Blocks');
  await page.getByTestId('assistant-permission').selectOption('auto');
  mock.enqueue(
    {
      content: [
        tool('b1', 'place_blocks', { boxes: [{ x: 3, y: 3, z: 0, w: 4, d: 1, h: 3, tile: 2 }, { x: 3, y: 5, z: 0, w: 2, d: 2, h: 1, tile: 1, shape: 'stairs', rot: 1 }] }),
        tool('b2', 'set_gravity', { direction: '+x', blocksEditable: true, editLimit: 50 }),
      ],
    },
    { content: [{ type: 'text', text: 'Built a wall and stairs, and turned gravity.' }] },
  );
  await send(page, 'Build a wall and stairs, with gravity pulling sideways.');
  await expect(page.getByTestId('chat-assistant').last()).toContainText('Built a wall');
  const state = await page.evaluate(() => ({ gravity: window.__store!.doc!.gravity, rules: window.__store!.doc!.blockRules, wall: window.__store!.doc!.map.blockAt(4, 3, 2)?.tile ?? 0, stairs: window.__store!.doc!.map.blockAt(3, 5, 0)?.shape ?? '' }));
  expect(state.gravity).toBe('+x');
  expect(state.rules).toEqual({ runtime: true, limit: 50 });
  expect(state.wall).toBe(2);
  expect(state.stairs).toBe('stairs');
  const answers = results(mock.requests.at(-1)!.body);
  expect(answers[0]!.text).toContain('Placed blocks');
  expect(answers[1]!.text).not.toContain('Bodies collide with every block'); // a new project has that switch on, so there is nothing to warn about
  // taking the run back puts everything as it was
  await page.getByTestId('run-rollback').click();
  await page.locator('.dv-tab', { hasText: 'Claude' }).click(); // (the project was opened again, so the windows are as they start)
  await expect(page.getByTestId('run-state')).toContainText('Back as it was');
  await page.waitForFunction(() => window.__store!.doc !== null);
  const after = await page.evaluate(() => ({ gravity: window.__store!.doc!.gravity, wall: window.__store!.doc!.map.blockAt(4, 3, 2)?.tile ?? 0 }));
  expect(after).toEqual({ gravity: '-z', wall: 0 });
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
