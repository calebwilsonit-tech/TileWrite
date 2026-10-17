import { expect, test, type Locator, type Page } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { edgesOf, portsOf } from '../packages/editor/src/renderer/model/dialogue-graph';
import { launchEditor, root, shot } from './helpers';

const tab = (page: Page, name: string) => page.locator('.dv-tab').getByText(name, { exact: true });

async function centre(l: Locator): Promise<{ x: number; y: number }> {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Drag with the real mouse, one step at a time so the page sees the movement. */
async function dragTo(page: Page, from: { x: number; y: number }, to: { x: number; y: number }): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(from.x + ((to.x - from.x) * i) / 8, from.y + ((to.y - from.y) * i) / 8);
  await page.mouse.up();
}

const dialogue = (page: Page, name: string) => page.evaluate((n) => JSON.parse(JSON.stringify(window.__store!.story.dialogues.get(n))) as { start: string; nodes: Record<string, unknown>[] }, name);

test('M14: a conversation is shown as a graph, and cards can be added, moved, connected and removed with the mouse', async () => {
  test.setTimeout(120_000);
  const { page, app, errors } = await launchEditor();
  await page.getByTestId('sample-last-storytender').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await tab(page, 'Story').click();
  await page.getByTestId('story-tab-dialogues').click();
  await page.getByTestId('dialogue-view-graph').click();
  await page.getByTestId('dg-big').click(); // the panel is short: use the whole window

  // ---- the sample's own conversation: a card for every step, a line for every link ----
  const elder = JSON.parse(fs.readFileSync(path.join(root, 'templates', 'last-storytender', 'assets', 'dialogues', 'Elder.dialogue.json'), 'utf8'));
  await expect(page.locator('[data-testid^="dg-node-"]')).toHaveCount(elder.nodes.length);
  const expectedEdges = edgesOf(elder).length;
  expect(expectedEdges).toBeGreaterThan(2);
  await expect(page.locator('[data-testid^="dg-edge-"]')).toHaveCount(expectedEdges);
  await page.getByTestId('dg-fit').click();
  await page.screenshot({ path: shot('m14-dialogue-graph.png') });
  expect(portsOf(elder.nodes.find((n: { type: string }) => n.type === 'choice')).length).toBeGreaterThan(1);

  // ---- build a new one by mouse ----
  await page.getByTestId('dg-big').click(); // back to the panel, where new dialogues are made
  await page.getByTestId('dialogue-new-name').fill('Gate talk');
  await page.getByTestId('dialogue-new').click();
  await page.getByTestId('dg-big').click();
  await expect(page.locator('[data-testid^="dg-node-"]')).toHaveCount(1); // the first line
  await page.getByTestId('dg-node-n1').click({ position: { x: 90, y: 40 } });
  await page.getByTestId('dnode-add-choice').click(); // joins the selected card's free link
  await page.getByTestId('dnode-add-line').click(); // and this one joins the choice's first option
  await expect(page.locator('[data-testid^="dg-node-"]')).toHaveCount(3);
  let d = await dialogue(page, 'Gate talk');
  expect(d.nodes[0]).toMatchObject({ id: 'n1', next: 'n2' });
  expect(d.nodes[1]).toMatchObject({ id: 'n2', type: 'choice' });
  expect((d.nodes[1] as { options: { next?: string }[] }).options[0]!.next).toBe('n3');
  expect(d.nodes[2]).toMatchObject({ id: 'n3', type: 'line' });
  await page.getByTestId('dg-fit').click();

  // connect the choice's second option back to the first line, by dragging from its dot to the card
  await dragTo(page, await centre(page.getByTestId('dg-port-n2-1')), await centre(page.getByTestId('dg-node-n1')));
  d = await dialogue(page, 'Gate talk');
  expect((d.nodes[1] as { options: { next?: string }[] }).options[1]!.next).toBe('n1');
  await expect(page.locator('[data-testid^="dg-edge-"]')).toHaveCount(3); // n1 to n2, n2 to n3, n2 back to n1

  // move a card: its place is remembered in the conversation
  const before = await centre(page.getByTestId('dg-node-n3'));
  await dragTo(page, { x: before.x - 40, y: before.y }, { x: before.x - 40, y: before.y + 70 });
  d = await dialogue(page, 'Gate talk');
  expect(typeof (d.nodes[2] as { y?: number }).y).toBe('number');
  const after = await centre(page.getByTestId('dg-node-n3'));
  expect(after.y).toBeGreaterThan(before.y + 40);
  await page.screenshot({ path: shot('m14-dialogue-graph-built.png') });

  // cut a link: drag from its dot and let go over empty space
  const canvas = (await page.getByTestId('dg-canvas').boundingBox())!;
  await dragTo(page, await centre(page.getByTestId('dg-port-n2-0')), { x: canvas.x + canvas.width - 20, y: canvas.y + 20 });
  d = await dialogue(page, 'Gate talk');
  expect((d.nodes[1] as { options: { next?: string }[] }).options[0]!.next).toBeUndefined();
  await expect(page.locator('[data-testid^="dg-edge-"]')).toHaveCount(2);

  // remove a card with the button, and the list view shows the same conversation
  await page.getByTestId('dg-node-n3').click({ position: { x: 90, y: 30 } });
  await page.getByTestId('dg-delete').click();
  await expect(page.locator('[data-testid^="dg-node-"]')).toHaveCount(2);
  await page.getByTestId('dg-big').click();
  await page.getByTestId('dialogue-view-list').click();
  await expect(page.getByTestId('dnode-n1')).toBeVisible();
  await expect(page.getByTestId('dnode-n2')).toBeVisible();
  await expect(page.getByTestId('dnode-n3')).toHaveCount(0);
  expect(errors).toEqual([]);
  await app.close();
});