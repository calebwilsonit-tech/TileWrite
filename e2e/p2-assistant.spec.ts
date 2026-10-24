import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor } from './helpers';
import { MockAnthropic, type MockBlock } from './mock-anthropic';

const KEY = 'sk-ant-api03-TESTKEY-0123456789abcdef';
const tool = (id: string, name: string, input: unknown): MockBlock => ({ type: 'tool_use', id, name, input });

/** Ask, then approve every change Claude proposes, one by one (later ones wait for earlier ones), until the reply is finished. */
async function askAndApprove(page: Page, sentence: string): Promise<void> {
  await page.getByTestId('assistant-input').fill(sentence);
  await page.getByTestId('assistant-send').click();
  for (let i = 0; i < 80; i++) {
    const pending = page.locator('[data-testid="proposal"][data-status="pending"]');
    if ((await pending.count()) > 0) {
      await pending.first().getByTestId('proposal-apply').click();
      await page.waitForTimeout(150);
    } else if ((await page.getByTestId('assistant-working').count()) === 0) break;
    else await page.waitForTimeout(150);
  }
  await expect(page.getByTestId('assistant-working')).toHaveCount(0, { timeout: 20_000 });
  expect(await page.locator('[data-testid="proposal"][data-status="failed"]').count()).toBe(0);
}

/** Play the room for a moment: it must start and run without the engine reporting a problem. */
async function playBriefly(page: Page, ms = 1500): Promise<void> {
  await page.getByTestId('btn-play').click();
  await page.waitForTimeout(ms);
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();
}

const entity = (page: Page, name: string) => page.evaluate((n) => window.__store!.doc!.entities.filter((e) => e.name === n).map((e) => ({ tags: e.tags, components: Object.keys(e.components) })), name);

test('Phase 2: Claude builds a small room in four different genres from one sentence each (API mocked)', async () => {
  test.setTimeout(300_000);
  const mock = await MockAnthropic.start();
  const { app, page, errors } = await launchEditor(undefined, { TILEWRIGHT_ASSISTANT_BASE_URL: mock.url });
  await createProjectViaUi(page, 'Genre One', 'empty');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  await page.getByTestId('key-input').fill(KEY);
  await page.getByTestId('key-save').click();
  await expect(page.getByTestId('key-saved')).toBeVisible();

  // the system prompt teaches the genres; the project starts with no packs
  // ---------- 1. tactics ----------
  const unit = (prefab: string, name: string, x: number, y: number) => ({ prefab, x, y, name });
  mock.enqueue(
    { content: [tool('a1', 'list_plugins', {}), tool('a2', 'list_prefabs', {})] },
    {
      content: [
        { type: 'text', text: 'A tactics room needs turns, combat and the grid cursor.' },
        tool('a3', 'set_plugins', { enable: ['turns', 'controls', 'combat'] }),
        tool('a4', 'place_objects', { objects: [unit('crate', 'Knight', 3.5, 8.5), unit('crate', 'Orc', 9.5, 3.5), unit('crate', 'Controls', 0.5, 0.5)] }),
        tool('a5', 'update_objects', {
          updates: [
            { target: 'Knight', add_behaviors: ['turnTaker', 'gridMover', 'health'], settings: { turnTaker: { team: 'blue', initiative: 9, attackRange: 1, attackDamage: 4 } }, tags: ['unit'] },
            { target: 'Orc', add_behaviors: ['turnTaker', 'gridMover', 'health', 'unitAi'], settings: { turnTaker: { team: 'red', attackRange: 1, attackDamage: 2 } }, tags: ['unit'] },
            { target: 'Controls', add_behaviors: ['gridCursor'], settings: { gridCursor: { team: 'blue' } } },
          ],
        }),
        tool('a6', 'set_event_sheet', { rows: [{ comment: 'Begin the battle', conditions: [{ type: 'start' }], actions: [{ type: 'startBattle' }], once: true }] }),
      ],
    },
    { content: [tool('a7', 'get_problems', {})] },
    { content: [{ type: 'text', text: 'The battle room is ready: a knight and an orc take turns, and you move the knight by clicking.' }] },
  );
  await askAndApprove(page, 'Make a tiny tactics battle: one knight of mine against one orc, turn by turn.');
  expect(await page.evaluate(() => window.__store!.state.project!.project.plugins)).toEqual(expect.arrayContaining(['turns', 'controls', 'combat']));
  expect((await entity(page, 'Knight'))[0]!.components).toEqual(expect.arrayContaining(['turnTaker', 'gridMover', 'health']));
  expect((await entity(page, 'Orc'))[0]!.components).toContain('unitAi');
  expect(await page.evaluate(() => window.__store!.doc!.events.map((e) => e.actions.map((a) => a.type)))).toEqual([['startBattle']]);
  const afterA = mock.requests.at(-1)!;
  expect(JSON.stringify(afterA.body.messages.at(-1))).toContain('a7'); // the problem check was returned to Claude
  expect(String(mock.requests[0]!.body.system)).toContain('tactics = "combat", "turns", "controls"');
  await playBriefly(page);

  // ---------- 2. town builder ----------
  await page.evaluate(() => window.__store!.closeProject());
  await createProjectViaUi(page, 'Genre Two', 'empty');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  mock.enqueue(
    {
      content: [
        tool('b1', 'set_plugins', { enable: ['controls', 'sim'] }),
        tool('b2', 'write_table', {
          name: 'Buildings',
          columns: [{ id: 'name', type: 'text' }, { id: 'prefab', type: 'prefab' }, { id: 'w', type: 'number' }, { id: 'd', type: 'number' }, { id: 'cost', type: 'number' }],
          rows: [{ id: 'hut', name: 'Hut', prefab: 'Hut', w: 2, d: 2, cost: 20 }],
        }),
        tool('b3', 'set_variables', { variables: [{ name: 'gold', value: 60 }] }),
        tool('b4', 'place_objects', { objects: [unit('crate', 'Camera', 8.5, 8.5)] }),
        tool('b5', 'update_objects', { updates: [{ target: 'Camera', add_behaviors: ['cameraRig', 'builder'] }] }),
      ],
    },
    { content: [{ type: 'text', text: 'Ready: pick the Hut and click to build it for 20 gold.' }] },
  );
  await askAndApprove(page, 'A tiny town builder: I start with 60 gold and can place huts that cost 20.');
  expect(await page.evaluate(() => window.__store!.tables.map((t) => [t.name, t.rows.length]))).toEqual([['Buildings', 1]]);
  expect(await page.evaluate(() => window.__store!.doc!.variables)).toEqual([{ name: 'gold', value: 60 }]);
  expect((await entity(page, 'Camera'))[0]!.components).toEqual(expect.arrayContaining(['cameraRig', 'builder']));
  await playBriefly(page);

  // ---------- 3. roguelike: a generated dungeon from a seed ----------
  await page.evaluate(() => window.__store!.closeProject());
  await createProjectViaUi(page, 'Genre Three', 'empty');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  mock.enqueue(
    {
      content: [
        tool('c1', 'set_plugins', { enable: ['turns', 'controls', 'combat'] }),
        tool('c2', 'generate_map', { kind: 'dungeon', width: 40, height: 30, seed: 7, lockSeed: true }),
        tool('c3', 'place_objects', { objects: [unit('crate', 'Hero', 3.5, 3.5)] }),
        tool('c4', 'update_objects', { updates: [{ target: 'Hero', add_behaviors: ['turnTaker', 'gridMover', 'health'], settings: { turnTaker: { team: 'blue' } } }] }),
      ],
    },
    { content: [{ type: 'text', text: 'A seeded dungeon with a hero is ready.' }] },
  );
  await askAndApprove(page, 'A small roguelike dungeon from seed 7 with a hero.');
  const dungeon = await page.evaluate(() => ({ w: window.__store!.doc!.map.width, h: window.__store!.doc!.map.height, gen: window.__store!.doc!.generator }));
  expect(dungeon).toMatchObject({ w: 40, h: 30, gen: expect.objectContaining({ kind: 'dungeon', seed: 7 }) });
  await playBriefly(page);

  // ---------- 4. point and click ----------
  await page.evaluate(() => window.__store!.closeProject());
  await createProjectViaUi(page, 'Genre Four', 'empty');
  await page.locator('.dv-tab', { hasText: 'Claude' }).click();
  mock.enqueue(
    {
      content: [
        tool('d1', 'set_plugins', { enable: ['controls', 'story'] }),
        tool('d2', 'place_objects', { objects: [unit('crate', 'Hero', 4.5, 8.5), unit('crate', 'Lamp', 12.5, 8.5)] }),
        tool('d3', 'update_objects', {
          updates: [
            { target: 'Hero', add_behaviors: ['clickToMove'], tags: ['player'] },
            { target: 'Lamp', add_behaviors: ['hotspot'], settings: { hotspot: { label: 'Old lamp', look: 'It flickers.', use: 'You pull the chain.' } } },
          ],
        }),
        tool('d4', 'set_variables', { variables: [{ name: 'verb', value: 'look' }] }),
      ],
    },
    { content: [{ type: 'text', text: 'Click the floor to walk; with the verb Look chosen, click the lamp.' }] },
  );
  await askAndApprove(page, 'A point-and-click room: click to walk, and look at a lamp.');
  expect((await entity(page, 'Lamp'))[0]!.components).toContain('hotspot');
  expect((await entity(page, 'Hero'))[0]!.components).toContain('clickToMove');
  await playBriefly(page);

  expect(errors).toEqual([]);
  await app.close();
  await mock.close();
});
