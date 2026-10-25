import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { launchEditor } from './helpers';

/**
 * Round 2, item 1.1. The game part of a plugin somebody else wrote runs in the editor's own window. It must not be able to reach
 * the bridge to the computer (files, the assistant's provider keys, the hub, plugin downloads, other programs) nor the editor's
 * own handles. This plugin tries every way it can think of, the moment it starts, and writes what it found on the page.
 */
const HOSTILE = `
const sdk = require('@tilewright/plugin-sdk');
const found = [];
const note = (what) => found.push(what);
const looksLikeBridge = (v) => {
  try {
    if (v && v.fs && typeof v.fs.write === 'function') return 'fs.write';
    if (v && v.assistant && v.assistant.providerKey) return 'providerKey';
    if (v && typeof v.hubRequest === 'function') return 'hubRequest';
    if (v && v.plugins && typeof v.plugins.runProgram === 'function') return 'plugins.runProgram';
    if (v && v.plugins && typeof v.plugins.fetch === 'function') return 'plugins.fetch';
    if (v && typeof v.saveProject === 'function') return 'the editor store';
    if (v && v.host && v.manager) return 'the plugin manager';
  } catch (e) {}
  return null;
};
const roots = { window, globalThis, self, top, parent, document: document.defaultView };
for (const [rootName, root] of Object.entries(roots)) {
  let names = [];
  try { names = Object.getOwnPropertyNames(root); } catch (e) {}
  for (const name of names) {
    let v;
    try { v = root[name]; } catch (e) { continue; }
    const hit = looksLikeBridge(v);
    if (hit) note(rootName + '.' + name + ' -> ' + hit);
  }
}
for (const hook of ['__store', '__plugins', '__viewport', '__studio', '__play', '__sample']) if (window[hook] !== undefined) note('window.' + hook);
let again = 'no unlock';
try { if (window.tilewright && typeof window.tilewright.unlock === 'function') again = window.tilewright.unlock(); } catch (e) { again = 'threw'; }
if (again && again !== 'no unlock') note('unlock gave the bridge again');
try {
  if (window.tilewright && window.tilewright.fs) { window.tilewright.fs.write('C:/hostile.txt', 'x'); note('wrote a file'); }
} catch (e) {}
document.body.setAttribute('data-hostile', JSON.stringify({ found, again: again === null ? 'null' : typeof again }));
module.exports.default = sdk.definePlugin(MANIFEST, { install() {} });
`;

test('Round 2: the game part of a plugin from outside cannot reach the bridge to the computer or the editor\'s own handles', async () => {
  test.setTimeout(180_000);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-hostile-'));
  const manifest = { id: 'hostile-plugin', name: 'Hostile plugin', version: '1.0.0', description: 'Tries to get out.', author: 'Nobody', permissions: [], entry: { runtime: 'plugin.cjs' } };
  const dir = path.join(store, manifest.id, manifest.version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'plugin.cjs'), HOSTILE.replace('MANIFEST', JSON.stringify(manifest)));

  // no test handles in the page: what the plugin can see is what a real person's editor has
  const { page, app } = await launchEditor(undefined, { TILEWRIGHT_PLUGINS: store, TILEWRIGHT_TEST_HOOKS: '0' });
  // (the helper that makes a project waits for a test handle, which this page does not have)
  await page.getByTestId('btn-new-project').click();
  await page.getByTestId('project-name-input').fill('Hostile');
  await page.getByTestId('template-empty').locator('..').click();
  await page.getByTestId('btn-create-project').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('tw:project-settings')));
  await page.getByTestId('ps-tab-packs').click();
  await page.getByTestId('review-hostile-plugin').click();
  await page.getByTestId('allow-hostile-plugin').click();
  await expect(page.getByTestId('plugin-toggle-hostile-plugin')).toBeVisible();

  const raw = await page.evaluate(() => document.body.getAttribute('data-hostile'));
  expect(raw, 'the plugin did not run').not.toBeNull();
  const result = JSON.parse(raw!) as { found: string[]; again: string };
  expect(result.found).toEqual([]);
  expect(result.again).toBe('null'); // asking for the door a second time gets nothing
  await app.close();
});

test('Round 2: the main process works out which plugin asks to run a program, and refuses one that was not allowed', async () => {
  test.setTimeout(120_000);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-hostile-run-'));
  const manifest = { id: 'runner-plugin', name: 'Runner plugin', version: '1.0.0', description: 'Wants to run a program.', author: 'Nobody', permissions: ['programs'], entry: { runtime: 'plugin.cjs' } };
  const dir = path.join(store, manifest.id, manifest.version);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest));
  fs.writeFileSync(path.join(dir, 'plugin.cjs'), `module.exports.default = require('@tilewright/plugin-sdk').definePlugin(${JSON.stringify(manifest)}, { install() {} });`);
  const { page, app } = await launchEditor(undefined, { TILEWRIGHT_PLUGINS: store, TILEWRIGHT_TEST_PROGRAMS: 'allow' });
  await page.getByTestId('btn-new-project').waitFor();
  const ask = (id: string) => page.evaluate(async (i) => window.tilewright.plugins.runProgram(i, 'node', ['-e', '1']).then(() => 'ran', (e: Error) => e.message), id);
  // a name that is not a plugin on this computer, a made-up name for another plugin, and a real one that was never allowed
  expect(await ask('nobody-here')).toMatch(/installed/);
  expect(await ask('A friendly plugin')).toMatch(/installed/);
  expect(await ask('runner-plugin')).toMatch(/was not allowed to run programs/);
  // once the person has allowed it the question can be asked (tests answer it themselves)
  await page.evaluate(async () => {
    const s = await window.tilewright.settings.get();
    await window.tilewright.settings.set({ ...s, plugins: { grants: { 'runner-plugin': ['programs'] } } });
  });
  expect(await ask('runner-plugin')).toBe('ran');
  await app.close();
});

test('Round 2: no code in the page can read a picture provider\'s key; a provider asks the main process to make its request', async () => {
  test.setTimeout(120_000);
  const { page, app } = await launchEditor();
  await page.getByTestId('btn-new-project').waitFor();
  expect(await page.evaluate(() => Object.keys(window.tilewright.assistant.providerKey).sort())).toEqual(['clear', 'fetch', 'has', 'set']);
  await page.evaluate(() => window.tilewright.assistant.providerKey.set('pics', 'sk-secret-123'));
  // the key is saved, can be asked about, and is used only for a plugin that is installed and was allowed the network
  expect(await page.evaluate(() => window.tilewright.assistant.providerKey.has('pics'))).toBe(true);
  const refused = await page.evaluate(() => window.tilewright.assistant.providerKey.fetch({ provider: 'pics', plugin: 'nobody-here', url: 'https://api.pictures.example/x', headers: { Authorization: 'Bearer {{key}}' } }).then(() => 'went', (e: Error) => e.message));
  expect(refused).toMatch(/installed/);
  expect(refused).not.toContain('sk-secret-123');
  await app.close();
});
