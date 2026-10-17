import { expect, test, type Page } from '@playwright/test';
import { clickCell, createProjectViaUi, dragCells, launchEditor, pickTool, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

/** Which sides of a cell's top face have a rim (0 when it shows a plain tile). */
const rimAt = (page: Page, x: number, y: number) =>
  page.evaluate(
    ([cx, cy]) => {
      const s = window.__store!;
      const id = s.doc!.map.getTile(cx!, cy!);
      const t = s.state.project!.project.tileset.find((d) => d.id === id);
      return { id, group: t?.group ?? null, sides: t?.rim?.sides ?? 0, corners: t?.rim?.corners ?? 0 };
    },
    [x, y],
  );

test('M14: edges and shores appear by themselves, the rules can be edited, and layers can be hidden and locked', async () => {
  test.setTimeout(150_000);
  const { page, app, errors } = await launchEditor();
  await createProjectViaUi(page, 'Shore Game', 'empty-iso');

  // ---- make shore variants for water, with the dialog ----
  await tab(page, 'Tiles').click();
  await page.getByTestId('btn-autotile').click();
  await expect(page.getByTestId('autotile-dialog')).toBeVisible();
  await page.getByTestId('at-base').selectOption({ label: 'water' });
  await expect(page.getByTestId('at-variants')).toContainText('No variants yet');
  await page.getByTestId('at-gen-edges').click();
  await expect(page.getByTestId('at-variants').locator('span')).toHaveCount(30);
  await expect(page.getByTestId('at-rules').locator('> li')).toHaveCount(30);
  await expect(page.getByTestId('at-problems')).toHaveCount(0);

  // a rule is edited by clicking the squares around the tile
  await expect(page.getByTestId('at-cell-0-0')).toHaveAttribute('title', /north: something else/);
  await page.getByTestId('at-cell-0-0').click();
  await expect(page.getByTestId('at-cell-0-0')).toHaveAttribute('title', /north: lower ground/);
  for (let i = 0; i < 3; i++) await page.getByTestId('at-cell-0-0').click(); // L -> H -> any -> same tile
  await expect(page.getByTestId('at-cell-0-0')).toHaveAttribute('title', /north: same tile/);
  await page.getByTestId('at-cell-0-0').click();
  await expect(page.getByTestId('at-cell-0-0')).toHaveAttribute('title', /north: something else/);
  // a rule that can never apply is explained
  await page.getByTestId('at-add-rule').click();
  await page.getByTestId('at-add-rule').click();
  await expect(page.getByTestId('at-problems')).toContainText('can never apply');
  await page.screenshot({ path: shot('m14-autotile-dialog.png') });
  await page.getByRole('button', { name: 'Delete rule' }).last().click();
  await page.getByRole('button', { name: 'Delete rule' }).last().click();
  await expect(page.getByTestId('at-problems')).toHaveCount(0);
  await page.getByTestId('at-apply').click();
  await expect.poll(() => page.evaluate(() => window.__store!.state.project!.project.autotile.length)).toBe(30);
  await page.getByRole('button', { name: 'Close', exact: true }).click();

  // ---- paint a lake: its shore draws itself ----
  await page.getByTestId('tile-water').click();
  await pickTool(page, 'rect');
  await dragCells(page, [10, 10], [14, 13]);
  expect(await rimAt(page, 10, 10)).toMatchObject({ group: 4, sides: 1 | 8 }); // north + west
  expect(await rimAt(page, 14, 13)).toMatchObject({ group: 4, sides: 2 | 4 }); // east + south
  expect(await rimAt(page, 12, 10)).toMatchObject({ group: 4, sides: 1 });
  expect(await rimAt(page, 12, 12)).toMatchObject({ id: 4, group: null, sides: 0 }); // the middle is plain water
  await page.evaluate(() => window.__store!.select([]));
  await page.evaluate(() => window.__viewport!.frameMap());
  await page.waitForTimeout(300);
  await page.screenshot({ path: shot('m14-autotile-lake.png') });

  // digging out a cell changes the cells around it, and one undo puts everything back
  await page.getByTestId('tile-grass').click();
  await pickTool(page, 'paint');
  await clickCell(page, 12, 11);
  expect((await rimAt(page, 12, 10)).sides).toBe(1 | 4); // north + south now
  await page.keyboard.press('Control+z');
  expect((await rimAt(page, 12, 10)).sides).toBe(1);
  await page.keyboard.press('Control+z');
  expect(await rimAt(page, 10, 10)).toMatchObject({ id: 1 }); // the whole lake is one undo step
  await page.keyboard.press('Control+y');
  expect(await rimAt(page, 10, 10)).toMatchObject({ group: 4 });

  // ---- layers: lock and hide walls ----
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-brick').click();
  await pickTool(page, 'rect');
  await dragCells(page, [3, 3], [6, 3]);
  expect(await rimAt(page, 4, 3)).toMatchObject({ id: 5 });
  await tab(page, 'Layers').click();
  await page.getByTestId('lock-walls').click();
  await expect(page.getByTestId('lock-walls')).toBeChecked();
  await tab(page, 'Tiles').click();
  await page.getByTestId('tile-grass').click();
  await dragCells(page, [3, 3], [6, 3]);
  expect(await rimAt(page, 4, 3)).toMatchObject({ id: 5 }); // the locked wall stayed
  await page.getByTestId('tile-brick').click();
  await dragCells(page, [3, 5], [6, 5]);
  expect(await rimAt(page, 4, 5)).toMatchObject({ id: 1 }); // and no new wall could be painted
  await tab(page, 'Layers').click();
  await page.getByTestId('lock-walls').click();
  await page.getByTestId('vis-walls').click();
  expect(await page.evaluate(() => window.__viewport!.renderer.wallsVisible)).toBe(false);
  await page.getByTestId('vis-walls').click();
  expect(await page.evaluate(() => window.__viewport!.renderer.wallsVisible)).toBe(true);

  // ---- layers: decoration objects ----
  await page.evaluate(() => {
    window.__store!.setOptions({ prefab: 'flowers' });
    window.__store!.set({ tool: 'place' });
  });
  await clickCell(page, 8, 6);
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.tags.includes('decoration')).length)).toBe(1);
  await page.getByTestId('lock-decoration').click();
  await clickCell(page, 20, 6);
  expect(await page.evaluate(() => window.__store!.doc!.entities.filter((e) => e.tags.includes('decoration')).length)).toBe(1); // placing is refused while locked
  await pickTool(page, 'select');
  const at = await page.evaluate(() => window.__viewport!.entityToClient(window.__store!.doc!.entities.find((e) => e.tags.includes('decoration'))!.id));
  await page.mouse.click(at!.x, at!.y);
  expect(await page.evaluate(() => window.__store!.state.selection.length)).toBe(0); // and it cannot be picked
  await page.getByTestId('lock-decoration').click();
  await page.mouse.click(at!.x, at!.y);
  expect(await page.evaluate(() => window.__store!.state.selection.length)).toBe(1);
  await page.screenshot({ path: shot('m14-layers.png') });

  expect(errors).toEqual([]);
  await app.close();
});
