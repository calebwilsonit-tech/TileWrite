import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { clickCell, createProjectViaUi, launchEditor, shot } from './helpers';
import { addObject } from './sample-helpers';

/** A plugin as a person would get it: a folder with a manifest, a game part and an editor part. */
function writePlugin(dir: string, version: string, extra: { permissions?: string[]; label?: string } = {}): void {
  fs.mkdirSync(dir, { recursive: true });
  const manifest = {
    id: 'hello-plugin',
    name: 'Hello plugin',
    version,
    description: 'Says hello from a panel and adds a button.',
    author: 'A. Friend',
    permissions: extra.permissions ?? ['project.read'],
    entry: { runtime: 'plugin.cjs', editor: 'editor.cjs' },
    changelog: 'CHANGELOG.md',
  };
  fs.writeFileSync(path.join(dir, 'plugin.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(dir, 'CHANGELOG.md'), `${version}: made the greeting nicer.\n`);
  fs.writeFileSync(
    path.join(dir, 'plugin.cjs'),
    `const sdk = require('@tilewright/plugin-sdk');
module.exports.default = sdk.definePlugin(${JSON.stringify(manifest)}, {
  install(api) {
    api.inputAction('hello_wave', { label: 'Wave hello', bindings: ['key:KeyH'] });
    api.condition({ id: 'helloIsNice', label: 'Hello is nice', category: 'Hello', params: [], describe: () => 'hello is nice', test: () => true });
  },
});
`,
  );
  fs.writeFileSync(
    path.join(dir, 'editor.cjs'),
    `Tilewright.editor.panel({
  id: 'greeting',
  title: 'Greeting',
  mount(el, host) {
    var out = document.createElement('p');
    out.setAttribute('data-testid', 'hello-out');
    out.textContent = '${extra.label ?? 'Hello!'}';
    var button = document.createElement('button');
    button.setAttribute('data-testid', 'hello-read');
    button.textContent = 'Read the project';
    button.addEventListener('click', function () {
      host.readFile('project.json').then(
        function (t) { out.textContent = 'read ' + t.length + ' characters'; },
        function (e) { out.textContent = 'denied: ' + e.message; }
      );
    });
    el.appendChild(out);
    el.appendChild(button);
  }
});
`,
  );
}

test('plugins: the examples appear where they belong in the editor', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Examples', 'empty');
  const ids = ['example-panel', 'example-tool', 'example-prefab', 'example-validator', 'example-behavior', 'example-input', 'example-events', 'example-component', 'example-inspector', 'example-block', 'example-widget', 'example-screen'];
  await page.evaluate((list) => window.__store!.updateProjectSettings({ plugins: list }), ids);

  // the settings list them with what they need
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('tw:project-settings')));
  await page.getByTestId('ps-tab-packs').click();
  await expect(page.getByTestId('pack-example-panel')).toBeVisible();
  await expect(page.getByTestId('pack-toggle-example-panel')).toBeChecked();
  await page.getByTestId('ps-tab-game').click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // a panel in the dock
  await page.getByRole('tab', { name: 'Object count' }).click();
  await expect(page.getByTestId('plugin-panel-example-object-count')).toContainText(/\d+ objects in the scene/);

  // a tool in the Tools panel, used on the map
  await page.getByTestId('plugin-tool-example-probe').click();
  await clickCell(page, 6, 6);
  await expect(page.getByText(/Cell 6, 6/).first()).toBeVisible();

  // a prefab in the Place tool, a behaviour in the Inspector's Add menu, a button in the controls
  await page.getByTestId('tool-place').click();
  await expect(page.locator('option[value="example-beacon"]')).toHaveCount(1);
  const id = await addObject(page, 'crate', [5, 5], 'Crate');
  await page.evaluate((i) => window.__store!.select([i]), id);
  await expect(page.getByTestId('add-behavior').locator('option[value="exampleSpinner"]')).toHaveCount(1);
  expect(await page.evaluate(() => Object.keys(window.__plugins!.host.inputActions()))).toContain('example_wave');

  // a component with an inspector of the plugin's own, a kind of block, and a widget and a screen in the UI designer
  await page.getByTestId('add-component').selectOption('exampleScore');
  await page.getByTestId('add-component-ok').click();
  await expect(page.getByTestId('plugin-inspector-exampleScore').locator('input')).toHaveValue('0');
  await page.getByTestId('plugin-inspector-exampleScore').locator('input').fill('7');
  await page.getByTestId('plugin-inspector-exampleScore').locator('input').press('Tab');
  await expect.poll(() => page.evaluate((i) => (window.__store!.doc!.getEntity(i)!.components.exampleScore as { points: number }).points, id)).toBe(7);
  await page.getByTestId('blocktype-add-example-ice').click();
  await expect(page.getByTestId('tile-Ice')).toBeVisible();
  await page.getByTestId('btn-ws-ui').click();
  await page.getByTestId('ui-new-screen-name').fill('Hud');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-plugin-widget-example-clock').click();
  expect(await page.evaluate(() => JSON.stringify(window.__store!.uiDoc))).toContain('"type":"plugin"');
  await page.getByTestId('ui-plugin-screen-credits-customize').click();
  expect(await page.evaluate(() => window.__store!.uiDoc.screens.map((s) => s.name))).toEqual(['Hud', 'Credits']);
  await page.getByTestId('btn-ws-world').click();

  // a check in the Problems panel
  await page.evaluate((i) => window.__store!.doc!.updateEntities([i], 'Rename', (e) => void (e.name = 'TODO door')), id);
  await page.getByRole('tab', { name: 'Problems' }).click();
  await expect(page.getByText('"TODO door" is still a to-do.')).toBeVisible();

  // switched off, it all goes
  await page.evaluate(() => window.__store!.updateProjectSettings({ plugins: [] }));
  await expect(page.getByTestId('plugin-tool-example-probe')).toHaveCount(0);
  await expect(page.getByRole('tab', { name: 'Object count' })).toHaveCount(0);
  await page.screenshot({ path: shot('p3-plugins-examples.png') });
  expect(errors).toEqual([]);
  await app.close();
});

test('plugins: one from a folder must be allowed first, runs its editor part in a sandbox, and is held to its permissions', async () => {
  test.setTimeout(180_000);
  const store = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-plugins-'));
  const src = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-plugin-src-'));
  writePlugin(src, '1.0.0');
  const { page, app, errors } = await launchEditor(undefined, { TILEWRIGHT_PLUGINS: store });
  await createProjectViaUi(page, 'Hello', 'empty');

  // install it from the folder: it is in the list, and it cannot run yet
  await page.evaluate(async (dir) => {
    await window.tilewright.plugins.installFolder(dir);
    await window.__plugins!.manager.refresh();
  }, src);
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('tw:project-settings')));
  await page.getByTestId('ps-tab-packs').click();
  await expect(page.getByTestId('installed-hello-plugin')).toContainText('You have not allowed this plugin to run yet.');
  expect(await page.evaluate(() => window.__plugins!.host.known.has('hello-plugin'))).toBe(false);

  // the person reads what it wants, and says yes (it asked for one permission)
  await page.getByTestId('review-hello-plugin').click();
  await expect(page.getByTestId('approve-hello-plugin')).toContainText('A. Friend');
  await expect(page.getByTestId('perm-hello-plugin-project.read')).toBeVisible();
  await page.getByTestId('allow-hello-plugin').click();
  await expect(page.getByTestId('plugin-toggle-hello-plugin')).toBeVisible();
  expect(await page.evaluate(() => window.__plugins!.host.known.has('hello-plugin'))).toBe(true);

  // switch it on in the project: what it adds appears, its panel is drawn from the sandbox
  await page.getByTestId('plugin-toggle-hello-plugin').click();
  await expect.poll(() => page.evaluate(() => Object.keys(window.__plugins!.host.inputActions()))).toContain('hello_wave');
  await page.getByTestId('ps-tab-game').click();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('tab', { name: 'Greeting' }).click();
  await expect(page.getByTestId('hello-out')).toHaveText('Hello!');
  await page.getByTestId('hello-read').click();
  await expect(page.getByTestId('hello-out')).toContainText(/read \d+ characters/);
  await page.screenshot({ path: shot('p3-plugins-hello.png') });

  // taking the permission away is honoured: the next call is refused with a plain sentence
  await page.evaluate(() => window.__plugins!.host.grant('hello-plugin', []));
  await page.getByTestId('hello-read').click();
  await expect(page.getByTestId('hello-out')).toContainText(/denied: .*project\.read/);

  // an update with different code needs a new yes; going back to the old version is one click
  writePlugin(src, '1.1.0', { label: 'Hello again!' });
  await page.evaluate(async (dir) => {
    await window.tilewright.plugins.installFolder(dir);
    await window.__plugins!.manager.refresh();
  }, src);
  const states = await page.evaluate(() => window.__plugins!.manager.installed.map((p) => `${p.version}:${p.state}`).sort());
  expect(states).toEqual(['1.0.0:ready', '1.1.0:needs-approval']);
  expect(await page.evaluate(() => window.__plugins!.manager.chosen('hello-plugin')?.version)).toBe('1.1.0');
  await page.evaluate(() => window.__plugins!.manager.pin('hello-plugin', '1.0.0'));
  expect(await page.evaluate(() => window.__plugins!.host.known.get('hello-plugin')?.manifest.version)).toBe('1.0.0');

  // taking it off the computer: the project still lists it, and says it is missing
  await page.evaluate(() => window.__plugins!.manager.remove('hello-plugin'));
  await page.evaluate(() => document.dispatchEvent(new CustomEvent('tw:project-settings')));
  await page.getByTestId('ps-tab-packs').click();
  await expect(page.getByTestId('plugins-missing')).toContainText('"hello-plugin"');
  expect(errors).toEqual([]);
  await app.close();
});
