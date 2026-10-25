import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor } from './helpers';
import { Recorder, runScript, runTitleScript, type Seen } from './menus-scenario';
import { compareRecordings, readRecording, sortOut } from '../compat/menus/compare.mjs';

const OLD = path.resolve(import.meta.dirname, '..', 'compat', 'menus');

/** Without MENUS_OUT (the usual run) what was seen is compared with the recording of the older build, and every difference must be one that is meant. */
function mustMatchTheOlderBuild(seen: Seen[], file: string): void {
  const { explained, unexplained } = sortOut(compareRecordings(readRecording(path.join(OLD, file)), seen as never));
  expect(unexplained, `differences from the menus before they became screens that nobody explained (add them to compat/menus/intended.json with a reason, or fix them):\n${unexplained.map((d) => `  ${d.step}: ${d.note}`).join('\n')}`).toEqual([]);
  expect(explained.length, 'the explained differences should still be there (if one went away, take its entry out of intended.json)').toBeGreaterThan(0);
}

/**
 * Round 2, item 3.2. Plays `menus-scenario.ts` in this build of the editor and writes what it saw to the file named by
 * MENUS_OUT (the same spec is run in a worktree of `4cd481c`, where the menus were drawn by the game itself).
 * Without MENUS_OUT it only checks that the script runs.
 */
test('record what the game\'s own menus show and do', async () => {
  test.setTimeout(300_000);
  const { page, app } = await launchEditor();
  await createProjectViaUi(page, 'Menus', 'action-adventure');
  // some things to show: two items (one can be used), a world map of two places, two lit lanterns
  await page.evaluate(() => {
    const s = window.__store!;
    s.setItems([
      { id: 'potion', name: 'Potion', description: 'A small potion.', color: 0xcc3333, max: 9, use: { heal: 2, setVariable: '', setValue: 1, consume: true, message: 'You feel better.' } },
      { id: 'key', name: 'Brass key', description: 'Opens something.', color: 0xddaa33, max: 0 },
    ] as never);
    s.setWorldMap({
      schemaVersion: 1,
      title: 'The Road',
      links: [{ a: 'hub', b: 'cave' }],
      nodes: [
        { id: 'hub', label: 'Hub', scene: 'scenes/main.scene.json', x: 300, y: 300, icon: 'town', unlock: { kind: 'always' }, spawn: '', hidden: false },
        { id: 'cave', label: 'Cave', scene: 'scenes/cave.scene.json', x: 700, y: 200, icon: 'cave', unlock: { kind: 'always' }, spawn: '', hidden: false },
      ],
    } as never);
  });
  // the older build had the lantern travel list in its pause menu whatever the project switched on: it is on here, so the menus can be compared
  await page.evaluate(() => {
    const list = ['combat', 'inventory', 'story', 'ai', 'lighting', 'storytender'];
    return window.__store!.updateProjectSettings({ plugins: list, packs: list } as never);
  });
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => (window as unknown as { __play?: unknown }).__play !== undefined);
  await page.evaluate(() => {
    const v = (window as unknown as { __play: { sim: { runtime: { vars: Record<string, unknown> } } } }).__play.sim.runtime.vars;
    v['item:potion'] = 3;
    v['item:key'] = 1;
    v['lit:scenes/main.scene.json:l1'] = 'Hub lantern|3|3|0';
    v['lit:scenes/cave.scene.json:l2'] = 'Cave lantern|4|4|0';
  });
  const rec = new Recorder(page);
  const out = process.env.MENUS_OUT;
  try {
    await runScript(rec);
    if (!out) mustMatchTheOlderBuild(rec.seen, 'old-4cd481c.json');
  } finally {
    // (what was seen so far is kept even when the script stops, so it can be looked at)
    if (out) {
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, JSON.stringify(rec.seen as Seen[], null, 2));
    }
  }
  await app.close();
});

test('record what the title screen shows and does', async () => {
  test.setTimeout(300_000);
  const { page, app } = await launchEditor();
  await createProjectViaUi(page, 'Titles', 'action-adventure');
  await page.evaluate(() => window.__store!.updateProjectSettings({ title: { enabled: true, subtitle: 'A tale of the old road' } }));
  const out = process.env.MENUS_OUT;
  const seen: Seen[] = [];
  for (const withSave of [false, true]) {
    await page.getByTestId('btn-play').click();
    await page.waitForFunction(() => (window as unknown as { __play?: unknown }).__play !== undefined);
    const rec = new Recorder(page);
    await runTitleScript(rec, withSave);
    if (!withSave) {
      // New game was chosen: make a save, then stop and play again (the title offers Continue now)
      await page.evaluate(async () => {
        const w = window as unknown as { __play: { session: { saveTo?(slot: string): Promise<string> } } };
        await w.__play.session.saveTo?.('slot1');
      });
    }
    seen.push(...rec.seen.map((s) => ({ ...s, step: `[${withSave ? 'with a save' : 'no save'}] ${s.step}` })));
    await page.getByTestId('btn-stop').click();
    await page.waitForFunction(() => (window as unknown as { __play?: unknown }).__play === undefined);
  }
  if (out) fs.writeFileSync(out.replace(/\.json$/, '-title.json'), JSON.stringify(seen, null, 2));
  else mustMatchTheOlderBuild(seen, 'old-4cd481c-title.json');
  await app.close();
});
