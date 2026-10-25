import { expect, test } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { launchEditor, root } from './helpers';

/**
 * Rule A of phase 3, the pictures: every scene of every project in the compatibility corpus (the samples, the
 * Storytender template and the owner's projects in compat/projects) is opened in the editor and compared with a
 * golden picture. The first run on a computer writes the pictures; after that any difference fails.
 * (`npm run compat` is the part that does not need a window: loading, playing, saving, exporting.)
 *
 * The code templates are covered by the traces in `npm run compat`; their pictures would only be a grid.
 */
function projects(): { kind: string; id: string; dir: string }[] {
  const out: { kind: string; id: string; dir: string }[] = [];
  const add = (kind: string, parent: string): void => {
    if (!fs.existsSync(parent)) return;
    for (const e of fs.readdirSync(parent, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(parent, e.name, 'project.json'))) out.push({ kind, id: e.name, dir: path.join(parent, e.name) });
    }
  };
  add('sample', path.join(root, 'samples'));
  for (const e of fs.existsSync(path.join(root, 'packages', 'plugins')) ? fs.readdirSync(path.join(root, 'packages', 'plugins')) : []) add('plugin-sample', path.join(root, 'packages', 'plugins', e, 'samples'));
  add('owner', path.join(root, 'compat', 'projects'));
  return out.sort((a, b) => `${a.kind}/${a.id}`.localeCompare(`${b.kind}/${b.id}`));
}

const only = process.env.COMPAT_ONLY;

/** Golden pictures are kept per operating system (`-win32.png`, `-linux.png`). */
const SNAPSHOTS = path.join(root, 'e2e', 'compat-screens.spec.ts-snapshots');
const hasGoldens = fs.existsSync(SNAPSHOTS) && fs.readdirSync(SNAPSHOTS).some((f) => f.endsWith(`-${process.platform}.png`) && !f.startsWith('owner-'));

for (const p of projects()) {
  if (only && p.id !== only) continue;
  test(`compat pictures: ${p.kind} ${p.id}`, async () => {
    // In CI a system with no golden pictures says so, instead of passing by writing them (the "Update golden pictures" workflow makes them).
    test.skip(Boolean(process.env.CI) && !hasGoldens, `no golden pictures are committed for ${process.platform} yet: run the "Update golden pictures" workflow and commit what it makes`);
    test.setTimeout(180_000);
    const { page, app, workDir } = await launchEditor();
    try {
      // the editor works on a copy, so the corpus is never touched
      const copy = path.join(workDir, `compat-${p.id}`);
      fs.rmSync(copy, { recursive: true, force: true });
      fs.cpSync(p.dir, copy, { recursive: true, filter: (src) => !/[\\/]\.tilewright([\\/]|$)/.test(src) });
      await page.getByTestId('btn-new-project').waitFor();
      await page.evaluate((d) => window.tilewright.recent.add(d, 'compat'), copy);
      await page.evaluate((d) => window.__store!.openRecent(d), copy);
      await page.getByTestId('editor-shell').waitFor();
      await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
      const scenes = await page.evaluate(() => window.__store!.state.project!.project.scenes);
      for (const scene of scenes) {
        // the editor opens the starting scene first; open each one explicitly so the picture is of the scene it is named after
        await page.evaluate((s) => window.__store!.openScene(s), scene);
        await page.waitForFunction((s) => window.__store!.state.scenePath === s, scene);
        await page.evaluate(() => window.__store!.select([]));
        await page.evaluate(() => window.__viewport!.frameMap());
        await page.waitForTimeout(500);
        const name = `${p.kind}-${p.id}-${scene.replace(/^scenes\//, '').replace(/\.scene\.json$/, '')}.png`.replace(/\s+/g, '_');
        await expect(page.getByTestId('viewport').locator('canvas')).toHaveScreenshot(name, { maxDiffPixelRatio: 0.02 });
      }
    } finally {
      await app.close();
    }
  });
}

