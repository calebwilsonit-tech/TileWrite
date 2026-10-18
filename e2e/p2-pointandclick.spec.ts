import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { addBehaviors, addObject, loadSampleGame, look, saveSample, selectObject, setFields, setText, tab } from './sample-helpers';

const outline = (page: Page, name: string) => page.getByTestId(`ui-outline-${name}`);
const addWidget = (page: Page, type: string) => page.getByTestId(`ui-palette-${type}`).click();

/**
 * Sample 5 of Phase 2: a point-and-click adventure. Click the floor to walk, choose a verb (Look, Use, Talk), click a thing. A cat
 * talks, a painting is looked at, a drawer holds a key, a locked door opens with it. Made in the editor from the Point and click
 * starter; the playbot plays it with the verb buttons and the mouse.
 */
test('Phase 2 sample: point and click - verbs, hotspots, a conversation, an item and a locked door', async () => {
  test.setTimeout(400_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'The Locked Room', 'point-and-click');

  // ---- the key is an item; the cat has a conversation ----
  await tab(page, 'Story').click();
  await page.getByTestId('item-add').click();
  await setText(page, 'item-id-0', 'key');
  await setText(page, 'item-name-0', 'Brass key');
  await page.getByTestId('story-tab-dialogues').click();
  await setText(page, 'dialogue-new-name', 'Cat');
  await page.getByTestId('dialogue-new').click();
  await setText(page, 'dn-speaker-n1', 'Cat');
  await setText(page, 'dn-text-n1', 'Mrrp. The brass key? Look in the drawer, human.');
  await expect(page.getByTestId('dialogue-ok')).toBeVisible();

  // ---- things to click: each is an object with the Hotspot behaviour ----
  const hotspot = async (name: string, cell: [number, number], color: string, h: number, words: Record<string, string>): Promise<string> => {
    const id = await addObject(page, 'crate', cell, name);
    await look(page, { color, w: 0.7, d: 0.7, height: h });
    await addBehaviors(page, id, ['hotspot']);
    await setFields(page, 'hotspot', words);
    return id;
  };
  await hotspot('Cat', [10, 9], '#f2a65a', 0.6, { label: 'Cat', look: 'A very smug cat.', talk: 'dialogue:Cat' });
  await hotspot('Painting', [9, 2], '#7a3b8f', 1.6, { label: 'Painting', look: 'A ship on a stormy sea. The frame is crooked.', use: 'You straighten the frame. Nothing happens.' });
  await hotspot('Drawer', [4, 11], '#8a5a2b', 1.0, { label: 'Drawer', look: 'A small drawer with a brass handle.', use: '' });
  const door = await hotspot('Door', [18, 7], '#5b3a1e', 2.0, { label: 'Door', look: 'A heavy door with a keyhole.', use: '' });
  await selectObject(page, door);
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.components.hotspot).map((e) => e.name).sort())).toEqual(['Cat', 'Door', 'Drawer', 'Lamp', 'Painting']);

  // ---- what happens when the drawer and the door are used ----
  await tab(page, 'Events').click();
  const newRow = async (): Promise<string> => {
    await page.getByTestId('add-row').click();
    return page.evaluate(() => window.__store!.doc!.events.at(-1)!.id);
  };
  const used = async (r: string, who: string, verb: string): Promise<void> => {
    await page.getByTestId(`cond-type-${r}-0`).selectOption('entityEvent');
    await page.getByTestId(`param-${r}-c0-who`).selectOption({ label: who });
    await page.getByTestId(`param-${r}-c0-name`).selectOption('hotspot-used');
    await page.getByTestId(`add-condition-${r}`).selectOption('variable');
    await setText(page, `param-${r}-c1-name`, 'hotspot.verb');
    await page.getByTestId(`param-${r}-c1-op`).selectOption('=');
    await setText(page, `param-${r}-c1-value`, verb);
  };
  // the drawer: the first time, a key
  let r = await newRow();
  await used(r, 'Drawer', 'use');
  await page.getByTestId(`add-condition-${r}`).selectOption('hasItem');
  await setText(page, `param-${r}-c2-item`, 'key');
  await page.getByTestId(`cond-not-${r}-2`).click();
  await page.getByTestId(`add-action-${r}`).selectOption('giveItem');
  await setText(page, `param-${r}-a0-item`, 'key');
  await page.getByTestId(`add-action-${r}`).selectOption('message');
  await setText(page, `param-${r}-a1-text`, 'You find a small brass key at the back.');
  // the door with the key
  r = await newRow();
  await used(r, 'Door', 'use');
  await page.getByTestId(`add-condition-${r}`).selectOption('hasItem');
  await setText(page, `param-${r}-c2-item`, 'key');
  await page.getByTestId(`add-action-${r}`).selectOption('message');
  await setText(page, `param-${r}-a0-text`, 'The key turns. The door swings open - you are free!');
  await page.getByTestId(`add-action-${r}`).selectOption('setVariable');
  await setText(page, `param-${r}-a1-name`, 'escaped');
  await setText(page, `param-${r}-a1-value`, '1');
  // the door without it
  r = await newRow();
  await used(r, 'Door', 'use');
  await page.getByTestId(`add-condition-${r}`).selectOption('hasItem');
  await setText(page, `param-${r}-c2-item`, 'key');
  await page.getByTestId(`cond-not-${r}-2`).click();
  await page.getByTestId(`add-action-${r}`).selectOption('message');
  await setText(page, `param-${r}-a0-text`, 'It is locked.');

  // ---- the screen: verbs, and the name of what is under the pointer ----
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('Verbs');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-start').check();
  await addWidget(page, 'panel');
  await setText(page, 'ui-name', 'Bar');
  await page.getByTestId('ui-layout').selectOption('row');
  for (const verb of ['look', 'use', 'talk']) {
    await outline(page, 'Bar').click();
    await addWidget(page, 'button');
    await setText(page, 'ui-name', verb[0]!.toUpperCase() + verb.slice(1));
    await setText(page, 'ui-text', verb[0]!.toUpperCase() + verb.slice(1));
    await page.getByTestId('ui-on-click-add').selectOption('setVerb');
    await page.getByTestId('ui-on-click-p0-verb').selectOption(verb);
  }
  await outline(page, 'Bar').click();
  await addWidget(page, 'text');
  await setText(page, 'ui-name', 'Status');
  await setText(page, 'ui-text', '{verb} {hover.name}');
  await page.getByTestId('btn-ws-world').click();
  await tab(page, 'Problems').click();
  await expect(page.getByTestId('problem-count')).toHaveText('No problems');

  // ---- play by hand: the Use verb, click the drawer ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await expect(page.getByTestId('tw-screen-Verbs')).toContainText('Look');
  await page.getByTestId('tw-ui-Use').click();
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars.verb)).toBe('use');
  await page.screenshot({ path: shot('p2-pointandclick-play.png') });
  expect(await page.evaluate(() => window.__store!.state.runtimeError)).toBeNull();
  await page.getByTestId('btn-stop').click();

  const dir = await saveSample(page, 'point-and-click');
  expect(errors).toEqual([]);
  await app.close();

  // ---- the bot plays the adventure ----
  const { game, bot } = await loadSampleGame(dir);
  const said: string[] = [];
  game.sim.events.on('message', (e) => void said.push(String(e.text)));
  bot.wait(0.3);
  const cell = (name: string): { x: number; y: number } => {
    const e = game.sim.world.all().find((x) => x.name === name)!;
    const t = e.get<{ x: number; y: number }>('transform')!;
    return { x: Math.floor(t.x), y: Math.floor(t.y) };
  };
  expect(bot.screenText().join(' ')).toContain('Look');
  bot.hover(cell('Cat'), 3);
  expect(bot.screenText().join(' ')).toContain('Cat'); // the name under the pointer
  // look at the painting
  expect(bot.pressWidget('Look')).toBe(true);
  bot.click(cell('Painting'));
  bot.wait(4);
  expect(said.at(-1)).toBe('A ship on a stormy sea. The frame is crooked.');
  // talk to the cat
  expect(bot.pressWidget('Talk')).toBe(true);
  bot.click(cell('Cat'));
  bot.wait(4);
  bot.talkThrough();
  bot.wait(0.5);
  // the door is locked without the key
  expect(bot.pressWidget('Use')).toBe(true);
  bot.click(cell('Door'));
  bot.wait(5);
  expect(said.at(-1)).toBe('It is locked.');
  expect(game.sim.runtime.vars.escaped).toBeUndefined();
  // the drawer holds the key
  bot.click(cell('Drawer'));
  bot.wait(5);
  expect(said.at(-1)).toBe('You find a small brass key at the back.');
  expect(game.sim.runtime.vars['item:key']).toBe(1);
  // and the key opens the door
  bot.click(cell('Door'));
  bot.wait(6);
  expect(said.at(-1)).toContain('you are free');
  expect(game.sim.runtime.vars.escaped).toBe(1);
});
