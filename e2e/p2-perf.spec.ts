import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { createProjectViaUi, launchEditor } from './helpers';
import { SAMPLES_DIR } from './sample-helpers';

/**
 * The builder sample's frame budget: 200 villagers walking to the farms and markets of the colony sample, drawn and run by the
 * real game in the editor's Play. Frames are counted with the browser's own animation clock over several seconds.
 */
test('Phase 2: the colony with 200 moving villagers keeps its frame rate in Play', async () => {
  test.setTimeout(300_000);
  const { page, app, workDir, errors } = await launchEditor();
  await createProjectViaUi(page, 'Scratch', 'empty');
  const copy = path.join(workDir, 'colony-perf');
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(SAMPLES_DIR, 'colony'), copy, { recursive: true });
  await page.evaluate(() => window.__store!.closeProject());
  await page.evaluate((d) => window.tilewright.recent.add(d, 'colony-perf'), copy);
  await page.evaluate((d) => window.__store!.openRecent(d), copy);
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);

  // build the town: farms and markets (as the sample's own prefabs), and two hundred villagers
  const made = await page.evaluate(() => {
    const doc = window.__store!.doc!;
    const place = (prefab: string, x: number, y: number) => {
      const p = window.__store!.prefabs.get(prefab)!;
      return { name: prefab, tags: [...p.root.tags], prefab, components: { transform: { x, y, h: 0, facing: 2 } } };
    };
    const items = [] as ReturnType<typeof place>[];
    for (let i = 0; i < 10; i++) items.push(place('Farm', 6 + (i % 5) * 6, 6 + Math.floor(i / 5) * 8));
    for (let i = 0; i < 5; i++) items.push(place('Market', 8 + i * 6, 30));
    const villagers = [] as { name: string; tags: string[]; components: Record<string, unknown> }[];
    for (let i = 0; i < 200; i++) {
      villagers.push({
        name: `Villager ${i}`,
        tags: ['villager'],
        components: {
          transform: { x: 2.5 + (i % 20) * 1.8, y: 2.5 + Math.floor(i / 20) * 1.4, h: 0, facing: 2 },
          sprite: { shape: 'box', color: 0xe8553d, w: 0.5, d: 0.5, height: 1, sortOffset: 0, visible: true },
          utilityAgent: { table: 'Activities', needs: 'hunger:6, energy:5', speed: 3 },
          body: { vx: 0, vy: 0, vz: 0, radius: 0.25, height: 1, state: 'ground', stepUp: 0.6, stepDown: 1, ledge: 'fall', pits: 'fall', wade: false, gravity: 1, peakZ: 0, layer: 2, mask: 65535, noclip: false, blockedBy: [], blockedTerrain: false },
        },
      });
    }
    doc.addEntities([...items, ...villagers] as never, 'Test town');
    return doc.entities.length;
  });
  expect(made).toBeGreaterThan(210);

  // hungry, tired villagers: they walk between the markets and the farms all the time (the colony's own table sends them to the nearest job and they stay)
  await page.evaluate(() => {
    const t = window.__store!.tables.find((x) => x.name === 'Activities')!;
    window.__store!.setTable({ ...t, rows: [{ id: 'eat', need: 'hunger', gain: 60, target: 'market', seconds: 0.6, weight: 0, when: 'any', makes: 'gold:1' }, { id: 'rest', need: 'energy', gain: 60, target: 'farm', seconds: 0.6, weight: 0, when: 'any', makes: 'food:1' }] });
  });
  await page.getByTestId('btn-play').click();
  await page.waitForFunction(() => window.__play !== undefined);
  await page.waitForTimeout(2000); // they set off
  const stats = await page.evaluate(
    () =>
      new Promise<{ fps: number; p95: number; worst: number; walking: number; ticks: number }>((resolve) => {
        const gaps: number[] = [];
        let last = performance.now();
        const start = last;
        const startTick = window.__play!.sim.tick;
        let peak = 0;
        let sampledAt = start;
        const loop = (now: number): void => {
          gaps.push(now - last);
          last = now;
          if (now - sampledAt > 400) {
            sampledAt = now;
            const n = window.__play!.sim.world.withTag('villager').filter((e) => { const b = e.get<{ vx: number; vy: number }>('body'); return !!b && Math.hypot(b.vx, b.vy) > 0.1; }).length;
            peak = Math.max(peak, n);
          }
          if (now - start < 5000) requestAnimationFrame(loop);
          else {
            const sorted = [...gaps].sort((a, b) => a - b);
            const walking = peak;
            resolve({ fps: (gaps.length / (now - start)) * 1000, p95: sorted[Math.floor(sorted.length * 0.95)]!, worst: sorted.at(-1)!, walking, ticks: window.__play!.sim.tick - startTick });
          }
        };
        requestAnimationFrame(loop);
      }),
  );
  process.stdout.write(`PERF ${JSON.stringify(stats)}\n`);
  expect(stats.walking).toBeGreaterThan(20); // they really are moving
  expect(stats.ticks).toBeGreaterThan(250); // the game kept up with real time (about 60 steps a second)
  expect(stats.fps).toBeGreaterThan(50);
  expect(errors).toEqual([]);
  await app.close();
});
