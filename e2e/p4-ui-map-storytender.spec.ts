import { expect, test, type Page } from '@playwright/test';
import { createProjectViaUi, launchEditor, shot } from './helpers';
import { ASPECTS, add, fakePad, fitGame, noBrowserControls, outline, padTap, setText } from './ui-helpers';

/**
 * Add-on, section 1 (maps), example (a), built in the UI designer only: the Last Storytender's parchment map. Regions are discovered
 * (fog that lifts when a condition holds), checkpoints are lit lamps or dark ones, "you are here" is a marker of its own, posts too
 * close to where the player stands are left out, choosing a lit lamp travels there; and all of it is moved with a gamepad.
 */
async function sceneNamed(page: Page, name: string): Promise<void> {
  await page.getByTestId('btn-new-scene').click();
  await page.getByTestId('new-scene-name').fill(name);
  await page.getByTestId('new-scene-ok').click();
  await page.waitForTimeout(300);
}

test('Add-on: the Last Storytender parchment map: discovered regions, lit checkpoints, you are here, travel with a pad, close posts hidden', async () => {
  test.setTimeout(480_000);
  const { page, errors } = await launchEditor();
  await createProjectViaUi(page, 'Parchment', 'empty');
  for (const n of ['Hollow', 'Tower', 'Mine']) await sceneNamed(page, n);
  await page.getByTestId('btn-ws-ui').click();

  // ---- the pieces: a lit lamp, a dark lamp, a "you are here" mark; each shows a ring when it is the highlighted one ----
  await page.getByTestId('ui-new-screen-name').fill('Parts');
  await page.getByTestId('ui-new-screen').click();
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Lit lamp');
  await setText(page, 'ui-w', '16');
  await setText(page, 'ui-h', '16');
  await page.getByTestId('ui-layout').selectOption('free');
  await page.getByTestId('ui-st-normal-fill').fill('#f5c542');
  await setText(page, 'ui-st-normal-radius', '16');
  await page.getByTestId('ui-st-normal-border').fill('#6b4e0a');
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Ring');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '30');
  await setText(page, 'ui-h', '30');
  await setText(page, 'ui-visible', '{marker.highlight} = 1');
  await page.getByTestId('ui-st-normal-fill-theme').selectOption('transparent');
  await page.getByTestId('ui-st-normal-border').fill('#b8452d');
  await setText(page, 'ui-st-normal-borderWidth', '3');
  await setText(page, 'ui-st-normal-radius', '30');
  // the dark lamp and the "you are here" mark are copies with their own colour
  await outline(page, 'Lit lamp').click();
  await page.getByTestId('ui-duplicate').click();
  await outline(page, 'Lit lamp 2').click();
  await setText(page, 'ui-name', 'Dark lamp');
  await page.getByTestId('ui-st-normal-fill').fill('#8a8f98');
  await outline(page, 'Lit lamp').click();
  await page.getByTestId('ui-duplicate').click();
  await outline(page, 'Lit lamp 2').click();
  await setText(page, 'ui-name', 'Here lamp');
  await page.getByTestId('ui-st-normal-fill').fill('#3b6fd0');
  await add(page, 'text');
  await setText(page, 'ui-name', 'You are here');
  await setText(page, 'ui-text', 'You are here');
  await page.getByTestId('ui-anchor-b').click();
  await setText(page, 'ui-y', '30');
  for (const name of ['Lit lamp', 'Dark lamp', 'Here lamp']) {
    await outline(page, name).first().click();
    await page.getByTestId('ui-prefab-name').fill(name);
    await page.getByTestId('ui-prefab-make').click();
    await expect(page.getByTestId(`ui-prefab-${name}`)).toBeVisible();
  }

  // ---- the map screen: parchment page, the map, a list of places beside it ----
  await page.getByTestId('ui-new-screen-name').fill('Parchment map');
  await page.getByTestId('ui-new-screen').click();
  await page.getByTestId('ui-screen-modal').check();
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Page');
  await page.getByTestId('ui-anchor-c').click();
  await setText(page, 'ui-w', '940');
  await setText(page, 'ui-h', '540');
  await page.getByTestId('ui-layout').selectOption('row');
  await setText(page, 'ui-padding', '16');
  await page.getByTestId('ui-st-normal-fill').fill('#e8d9b5');
  await page.getByTestId('ui-st-normal-border').fill('#8a6a3a');
  await add(page, 'map');
  await setText(page, 'ui-name', 'World');
  await setText(page, 'ui-w', '660');
  await setText(page, 'ui-h', '500');
  await page.getByTestId('ui-st-normal-fill').fill('#efe2c2');
  await page.getByTestId('ui-st-normal-border').fill('#8a6a3a');
  await page.getByTestId('ui-map-source').selectOption('none');
  await setText(page, 'ui-map-width', '1000');
  await setText(page, 'ui-map-height', '600');
  await page.getByTestId('ui-map-projection').selectOption('picture');
  await setText(page, 'ui-map-cell', '1');
  await page.getByTestId('ui-map-start').selectOption('here');
  await setText(page, 'ui-map-bind', 'wm');

  // layers: no terrain (there is no scene to draw); the roads, three regions that are fog until they are found, and the markers on top
  await page.getByTestId('ui-map-layer-0-delete').click();
  await page.getByTestId('ui-map-layer-new-kind').selectOption('paths');
  await page.getByTestId('ui-map-layer-add').click();
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('ui-map-layer-new-kind').selectOption('fog');
    await page.getByTestId('ui-map-layer-add').click();
  }
  for (let i = 0; i < 4; i++) await page.getByTestId(`ui-map-layer-${i}`).getByRole('button', { name: 'Move forward' }).click(); // the markers layer goes to the front
  const regions: [string, string, string][] = [
    ['1', '{found_hollow} = 1', '0,0,430,300'],
    ['2', '{found_peaks} = 1', '570,0,430,300'],
    ['3', '{found_shore} = 1', '0,300,1000,300'],
  ];
  for (const [i, cond, area] of regions) {
    await page.getByTestId(`ui-map-layer-${i}-toggle`).click();
    await page.getByTestId(`ui-map-layer-${i}-reveal`).selectOption('variable');
    await setText(page, `ui-map-layer-${i}-condition`, cond);
    await setText(page, `ui-map-layer-${i}-area`, area);
    await page.getByTestId(`ui-map-layer-${i}-colour`).fill('#7a6038');
    await page.getByTestId(`ui-map-layer-${i}-colour`).press('Enter');
    await page.getByTestId(`ui-map-layer-${i}-toggle`).click();
  }
  // the markers: the places of the world map; their look by state; the close ones are left out; undiscovered ones are not drawn
  await page.getByTestId('ui-map-marker-0-toggle').click();
  await setText(page, 'ui-map-marker-0-id', 'posts');
  await page.getByTestId('ui-map-marker-0-from').selectOption('places');
  await page.getByTestId('ui-map-marker-0-prefab').selectOption('Lit lamp');
  await setText(page, 'ui-map-marker-0-state', '{place.state}');
  for (const [state, prefab] of [['here', 'Here lamp'], ['locked', 'Dark lamp']] as const) {
    await setText(page, 'ui-map-marker-0-newstate', state);
    await page.getByTestId('ui-map-marker-0-newstate-add').click();
    await page.getByTestId(`ui-map-marker-0-state-${state}`).selectOption(prefab);
  }
  await setText(page, 'ui-map-marker-0-show', '{marker.revealed} = 1 && {place.state} = here || {marker.revealed} = 1 && {place.distance} >= 70');
  // choosing a post: travel there, and close the map
  await page.getByTestId('ui-map-on-choose-add').selectOption('travelToPlace');
  await setText(page, 'ui-map-on-choose-p0-place', '{place.id}');
  await page.getByTestId('ui-map-on-choose-add').selectOption('uiScreen');
  await page.getByTestId('ui-map-on-choose-p1-op').selectOption('close');
  await page.getByTestId('ui-map-on-choose-p1-screen').selectOption('Parchment map');

  // the places, as a list beside the map: the row of the highlighted post is marked, and pointing at a row highlights its post
  await outline(page, 'Page').click();
  await add(page, 'list');
  await setText(page, 'ui-name', 'Places');
  await setText(page, 'ui-w', '220');
  await setText(page, 'ui-h', '440');
  await page.getByTestId('ui-source').selectOption('places');
  await add(page, 'panel');
  await setText(page, 'ui-name', 'Place row');
  await page.getByTestId('ui-layout').selectOption('row');
  await page.getByTestId('ui-wmode').selectOption('fill');
  await page.getByTestId('ui-hmode').selectOption('auto');
  await add(page, 'text');
  await setText(page, 'ui-name', 'Mark');
  await setText(page, 'ui-text', '▶');
  await setText(page, 'ui-visible', '{wm.marker} = posts:{place.id}');
  await outline(page, 'Place row').click();
  await add(page, 'text');
  await setText(page, 'ui-name', 'Place name');
  await setText(page, 'ui-text', '{place.name}');
  await outline(page, 'Place row').click();
  await page.getByTestId('ui-on-hover-add').selectOption('mapHighlight');
  await page.getByTestId('ui-on-hover-p0-map').fill('World');
  await page.getByTestId('ui-on-hover-p0-map').press('Enter');
  await page.getByTestId('ui-on-hover-p0-how').selectOption('marker');
  await page.getByTestId('ui-on-hover-p0-marker').fill('posts:{place.id}');
  await page.getByTestId('ui-on-hover-p0-marker').press('Enter');
  await page.getByTestId('ui-on-click-add').selectOption('mapChoose');
  await page.getByTestId('ui-on-click-p0-map').fill('World');
  await page.getByTestId('ui-on-click-p0-map').press('Enter');
  await page.getByTestId('ui-on-click-p0-marker').fill('posts:{place.id}');
  await page.getByTestId('ui-on-click-p0-marker').press('Enter');
  const doc = await page.evaluate(() => window.__store!.uiDoc);
  const world = doc.screens.find((s) => s.name === 'Parchment map')!.root.children[0]!.children[0]!;
  expect(world.map!.layers.map((l) => l.kind)).toEqual(['paths', 'fog', 'fog', 'fog', 'markers']);
  expect(world.map!.markers[0]).toMatchObject({ id: 'posts', from: 'places', prefab: 'Lit lamp', statePrefabs: { here: 'Here lamp', locked: 'Dark lamp' } });
  expect(world.map!.on.choose.map((a) => a.type)).toEqual(['travelToPlace', 'uiScreen']);
  await expect(page.getByTestId('ui-problems')).toContainText('No problems');

  // ---- play: a world with places, lit and dark; the hub is where the player is ----
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  const scenes = await page.evaluate(() => window.__store!.getState().project!.project.scenes);
  const playing = await page.evaluate(() => window.__play!.sim.runtime.scene);
  const others = scenes.filter((s: string) => s !== playing); // the places other than the one the player is in
  await page.evaluate(
    ([hollow, tower, mine]) => {
      const here = window.__play!.sim.runtime.scene;
      const node = (id: string, label: string, scene: string, x: number, y: number, unlock: object = { kind: 'always' }) => ({ id, label, scene, x, y, icon: 'town', unlock, spawn: '', hidden: false });
      window.__play!.sim.assets.worldMap = {
        schemaVersion: 1,
        title: 'The Realm',
        nodes: [node('hub', 'Hearthwick', here, 480, 320), node('camp', 'The Camp', 'scenes/camp.scene.json', 505, 345), node('cave', 'Mossback Cave', hollow, 220, 160), node('tower', 'Grey Tower', tower, 800, 130), node('mine', 'Old Mine', mine, 820, 470, { kind: 'variable', name: 'mine', atLeast: 1 })],
        links: [{ a: 'hub', b: 'cave' }, { a: 'hub', b: 'tower' }, { a: 'hub', b: 'mine' }, { a: 'hub', b: 'camp' }],
      } as never;
      Object.assign(window.__play!.sim.runtime.vars, { found_hollow: 1, found_peaks: 0, found_shore: 1 });
      (window as unknown as { __travel: string[] }).__travel = [];
      window.__play!.sim.events.on('travel-place-request', (e) => (window as unknown as { __travel: string[] }).__travel.push(String(e.place)));
    },
    [others[0]!, others[1]!, others[2]!] as [string, string, string],
  );
  await page.evaluate(() => window.__play!.sim.runtime.ui.stack.push('Parchment map'));
  await fakePad(page);
  await expect(page.getByTestId('tw-ui-World')).toBeVisible();
  await page.waitForTimeout(700);
  const lamps = async (): Promise<Record<string, number>> =>
    page.evaluate(() => {
      const out: Record<string, number> = {};
      for (const e of document.querySelectorAll('[data-testid="tw-ui-World"] .tw-part')) {
        const n = (e as HTMLElement).dataset.name ?? '';
        if (/lamp/i.test(n)) out[n] = (out[n] ?? 0) + 1;
      }
      return out;
    });
  // the Camp is too close to the hub (36 units) to be worth a journey: not drawn; the Tower is in a region nobody found: not drawn
  expect(await lamps()).toEqual({ 'Here lamp': 1, 'Lit lamp': 1, 'Dark lamp': 1 });
  await expect(page.locator('[data-testid="tw-ui-Place name"]')).toHaveCount(4); // the list beside it still has every place the player can go
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['wm.marker'])).toBe('posts:hub'); // it starts on "you are here"
  await page.screenshot({ path: shot('p4-storytender-map.png') });

  // the pad: right goes to the post that lies that way, left to the one on the left; A travels
  await padTap(page, 15);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['wm.marker'])).toBe('posts:mine');
  await padTap(page, 14);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['wm.marker'])).toBe('posts:hub');
  await padTap(page, 14);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['wm.marker'])).toBe('posts:cave');
  await expect(page.locator('[data-testid="tw-ui-Mark"]:visible')).toHaveCount(1);
  await page.screenshot({ path: shot('p4-storytender-map-cave.png') });
  // finding the region of the tower lifts its fog: its post appears, and can be reached
  await page.evaluate(() => (window.__play!.sim.runtime.vars.found_peaks = 1));
  await page.waitForTimeout(500);
  expect(await lamps()).toEqual({ 'Here lamp': 1, 'Lit lamp': 2, 'Dark lamp': 1 });
  await page.screenshot({ path: shot('p4-storytender-map-found.png') });
  // pointing at a row of the list highlights its post; the pad's A chooses the highlighted one
  await page.locator('[data-testid="tw-ui-Place row"]', { hasText: 'Grey Tower' }).hover();
  await page.waitForTimeout(250);
  expect(await page.evaluate(() => window.__play!.sim.runtime.vars['wm.marker'])).toBe('posts:tower');
  await padTap(page, 0);
  await page.waitForTimeout(400);
  expect(await page.evaluate(() => (window as unknown as { __travel: string[] }).__travel)).toEqual(['tower']);

  // the map is the same widget at every shape of screen
  for (const shape of ASPECTS) {
    await page.evaluate(() => {
      const sim = window.__play!.sim;
      if (!sim.runtime.ui.stack.includes('Parchment map')) sim.runtime.ui.stack.push('Parchment map');
    });
    await fitGame(page, shape.w, shape.h);
    await page.waitForTimeout(400);
    const inside = await page.evaluate(() => {
      const map = document.querySelector('[data-testid="tw-ui-World"]')!.getBoundingClientRect();
      const ui = document.querySelector('[data-testid="tw-ui"]')!.getBoundingClientRect();
      return map.width > 100 && map.left >= ui.left - 1 && map.right <= ui.right + 1 && map.top >= ui.top - 1 && map.bottom <= ui.bottom + 1;
    });
    expect(inside, `${shape.id}: the map is inside the screen`).toBe(true);
    await page.screenshot({ path: shot(`p4-storytender-map-${shape.id.replace(':', 'x')}.png`) });
  }
  await noBrowserControls(page);
  expect(errors.filter((e) => !/scene|travel|enter/i.test(e))).toEqual([]);
});
