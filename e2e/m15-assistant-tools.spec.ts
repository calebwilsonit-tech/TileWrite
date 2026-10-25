import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });
const idle = (page: Page) => expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 20_000 });

test('M15: Claude writes minigames, skins, a world map and the sound mix, edits single event rows and makes a prefab, as approved changes (the API is mocked)', async () => {
  test.setTimeout(240_000);
  const mock = await MockAnthropic.start();
  const { app, page, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Tool Game', 'starter-room');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();
  const crate = await page.evaluate(() => window.__store!.doc!.entities.find((e) => !e.tags.includes('player'))!.name);

  mock.enqueue(
    {
      content: [
        { type: 'text', text: 'I will add a small minigame, a skin, a map and turn the music down a little.' },
        tool('m1', 'write_minigames', { minigames: [{ name: 'Duel', kind: 'timing', rounds: 2, title: 'Quick draw' }, { name: 'Cards', kind: 'pairs', pairs: 3 }] }),
        tool('m2', 'write_skins', { skins: [{ id: 'crimson', name: 'Crimson', color: 0xcc2222 }] }),
        tool('m3', 'write_world_map', { title: 'The Realm', nodes: [{ id: 'home', label: 'Home', scene: 'scenes/main.scene.json', x: 300, y: 300, icon: 'town', unlock: { kind: 'always' } }, { id: 'nowhere', label: 'Nowhere', scene: 'scenes/gone.scene.json', x: 700, y: 200 }], links: [{ a: 'home', b: 'nowhere' }] }),
        tool('m4', 'write_mixer', { buses: { music: 0.6 }, ducking: { amount: 0.5 }, sounds: { hit: { volume: 0.7 } } }),
        tool('m5', 'create_prefab', { object: crate, name: 'Test Prefab' }),
        tool('m6', 'edit_event_rows', { operations: [{ op: 'add', row: { comment: 'Greet', conditions: [{ type: 'start' }], actions: [{ type: 'message', params: { text: 'Welcome!' } }] } }] }),
        tool('m7', 'write_ui_layout', { theme: { font: 'sans', accent: '#00ff88' }, widgets: [{ id: 'coins', kind: 'counter', anchor: 'tr', x: 12, y: 12, label: 'Coins', variable: 'coins' }] }),
        tool('m8', 'write_controls', { overrides: { interact: ['key:KeyF'] }, actions: [{ id: 'dash', label: 'Dash', bindings: ['key:KeyZ'] }] }),
        tool('m9', 'set_project_settings', { name: 'Tool Game Deluxe', titleScreen: true, subtitle: 'A tale' }),
      ],
    },
    { content: [{ type: 'text', text: 'All set.' }] },
  );
  await page.getByTestId('assistant-input').fill('Add a minigame, a skin, a map, quieter music, a prefab and a greeting.');
  await page.getByTestId('assistant-send').click();

  // each is a card; nothing happens until it is approved
  await expect(page.getByTestId('proposal').first()).toContainText('minigames');
  expect(await page.evaluate(() => (window.__store!.dataList('minigames') as { name: string; kind: string }[]).length)).toBe(0);
  await page.getByTestId('proposal-apply').click();
  expect(await page.evaluate(() => (window.__store!.dataList('minigames') as { name: string; kind: string }[]).map((m) => `${m.name}:${m.kind}`))).toEqual(['Duel:timing', 'Cards:pairs']);

  await expect(page.getByTestId('proposal').nth(1)).toContainText('skins');
  await page.getByTestId('proposal-apply').click();
  expect(await page.evaluate(() => window.__store!.skins.map((s) => s.id))).toEqual(['crimson']);

  // the map has a place whose scene does not exist: the card says so before it is approved
  await expect(page.getByTestId('proposal').nth(2)).toContainText('world map');
  await expect(page.getByTestId('proposal').nth(2)).toContainText('which is not part of this project');
  await page.getByTestId('proposal-apply').click();
  expect(await page.evaluate(() => window.__store!.worldMap!.nodes.map((n) => n.id))).toEqual(['home', 'nowhere']);

  await expect(page.getByTestId('proposal').nth(3)).toContainText('mix');
  await page.getByTestId('proposal-apply').click();
  expect(await page.evaluate(() => ({ music: window.__studio!.mixer.buses.music, duck: window.__studio!.mixer.ducking.amount, hit: window.__studio!.mixer.sounds.hit?.volume }))).toEqual({ music: 0.6, duck: 0.5, hit: 0.7 });
  // (a setting for a sound that has no file is reported as a warning on the card)
  await expect(page.getByTestId('proposal').nth(3)).toContainText('no such sound file');

  await expect(page.getByTestId('proposal').nth(4)).toContainText('Test Prefab');
  await page.getByTestId('proposal-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.prefabNames)).toContain('Test Prefab');

  await expect(page.getByTestId('proposal').nth(5)).toContainText('Add a row');
  await page.getByTestId('proposal-apply').click();
  expect(await page.evaluate(() => window.__store!.doc!.events.map((r) => r.comment).filter((c) => c === 'Greet'))).toEqual(['Greet']);
  // the screen layout, the controls and the project settings
  await expect(page.getByTestId('proposal').nth(6)).toContainText('screen layout');
  await page.getByTestId('proposal-apply').click();
  expect(await page.evaluate(() => ({ font: window.__store!.uiLayout.theme.font, ids: window.__store!.uiLayout.widgets.map((w) => w.id) }))).toEqual({ font: 'sans', ids: ['coins', 'hearts', 'lightbar', 'slots', 'bosses', 'toasts'] });
  await expect(page.getByTestId('proposal').nth(7)).toContainText('controls');
  await page.getByTestId('proposal-apply').click();
  expect(await page.evaluate(() => ({ keys: window.__store!.input.overrides.interact, dash: window.__store!.input.actions.map((a) => a.id) }))).toEqual({ keys: ['key:KeyF'], dash: ['dash'] });
  await expect(page.getByTestId('proposal').nth(8)).toContainText('project settings');
  await page.getByTestId('proposal-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.title?.enabled)).toBe(true);
  expect(await page.evaluate(() => window.__store!.state.project!.project.name)).toBe('Tool Game Deluxe');
  await idle(page);

  // all of it is one history: the row edit, then the prefab, then the story changes, undone newest first
  const labels = await page.evaluate(() => window.__store!.doc!.history.labels);
  expect(labels[0]).toBe('Claude: edit event rows');
  expect(labels).toContain('Claude: change the minigames');
  expect(labels).toContain('Claude: change the world map');
  await page.getByTestId('btn-undo').click(); // the event row
  expect(await page.evaluate(() => window.__store!.doc!.events.length)).toBe(1);
  await page.getByTestId('btn-undo').click(); // the prefab
  await page.getByTestId('btn-undo').click(); // the world map: it was the last story change
  expect(await page.evaluate(() => window.__store!.worldMap)).toBeNull();
  expect(await page.evaluate(() => window.__store!.skins.length)).toBe(1);
  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
