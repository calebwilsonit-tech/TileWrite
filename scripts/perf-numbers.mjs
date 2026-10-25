// Measures what a person notices when they use the editor, on the build in this folder:
//   node scripts/perf-numbers.mjs [--runs 3] [--sample colony]
// It starts the editor (a built one: `npm run build -w @tilewright/editor` first), and prints one JSON line:
//   startup  - ms from starting the program to the project list being on screen (median of the runs)
//   load     - ms from asking to open the sample project to its scene being ready (median)
//   memory   - MB the program holds after the project has loaded: all its processes together (working set), and the window's JavaScript
//   export   - MB of the exported game (the folder with the program in it), and how long the export took
// The same script runs on an older checkout (a git worktree) so before and after are measured the same way, one after the other.
import { _electron as electron, expect } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const runs = Number(arg('runs', '3'));
const sample = arg('sample', 'colony');
const median = (xs) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const mb = (bytes) => Math.round((bytes / 1024 / 1024) * 10) / 10;

const dirSize = (dir) => {
  let n = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    n += e.isDirectory() ? dirSize(p) : fs.statSync(p).size;
  }
  return n;
};

async function launch(base) {
  const workDir = path.join(base, 'projects');
  fs.mkdirSync(workDir, { recursive: true });
  const started = Date.now();
  const app = await electron.launch({ args: [path.join(root, 'packages', 'editor'), `--user-data-dir=${path.join(base, 'userdata')}`], env: { ...process.env, TILEWRIGHT_TEST_DIR: workDir } });
  const page = await app.firstWindow();
  await page.getByTestId('btn-new-project').waitFor();
  return { app, page, workDir, startup: Date.now() - started };
}

async function open(page, workDir) {
  const copy = path.join(workDir, sample);
  fs.rmSync(copy, { recursive: true, force: true });
  fs.cpSync(path.join(root, 'samples', sample), copy, { recursive: true });
  await page.evaluate(([d, n]) => window.tilewright.recent.add(d, n), [copy, sample]);
  const started = Date.now();
  await page.evaluate((d) => window.__store.openRecent(d), copy);
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  return Date.now() - started;
}

const startups = [];
const loads = [];
let memory = null;
let exported = null;
for (let i = 0; i < runs; i++) {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-perf-'));
  const { app, page, workDir, startup } = await launch(base);
  startups.push(startup);
  loads.push(await open(page, workDir));
  await page.waitForTimeout(1500); // let the first frames and the autosave settle
  if (i === runs - 1) {
    const metrics = await app.evaluate(({ app: a }) => a.getAppMetrics().map((m) => ({ type: m.type, workingSetKb: m.memory.workingSetSize })));
    const heap = await page.evaluate(() => performance.memory.usedJSHeapSize);
    memory = { processes: metrics.length, totalMb: mb(metrics.reduce((s, m) => s + m.workingSetKb * 1024, 0)), jsHeapMb: mb(heap) };
    // export the sample as a game
    const t0 = Date.now();
    await page.getByTestId('btn-export').click();
    await expect(page.getByTestId('export-ready')).toBeVisible({ timeout: 60_000 });
    await page.getByTestId('export-name').fill('PerfGame');
    await page.getByTestId('export-name').blur();
    await page.getByTestId('export-go').click();
    await expect(page.getByTestId('export-result')).toBeVisible({ timeout: 300_000 });
    const exe = await page.getByTestId('export-exe').textContent();
    exported = { ms: Date.now() - t0, folderMb: mb(dirSize(path.dirname(exe))), exeMb: mb(fs.statSync(exe).size) };
    fs.rmSync(path.dirname(path.dirname(exe)), { recursive: true, force: true });
  }
  await app.close();
  fs.rmSync(base, { recursive: true, force: true });
}
console.log(JSON.stringify({ commit: arg('label', ''), sample, runs, startupMs: median(startups), startupAllMs: startups, loadMs: median(loads), loadAllMs: loads, memory, export: exported }));
