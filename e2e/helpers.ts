import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const shot = (name: string): string => path.join(root, 'screenshots', name);

export interface Launched {
  app: ElectronApplication;
  page: Page;
  /** Folder the native "choose folder" dialog answers with. */
  workDir: string;
  errors: string[];
}

/** Start the editor with a throwaway user-data folder and a fixed answer for folder dialogs. */
export async function launchEditor(reuseBase?: string, extraEnv: Record<string, string> = {}): Promise<Launched & { base: string }> {
  const base = reuseBase ?? fs.mkdtempSync(path.join(os.tmpdir(), 'tilewright-e2e-'));
  const workDir = path.join(base, 'projects');
  const userData = path.join(base, 'userdata');
  fs.mkdirSync(workDir, { recursive: true });
  const app = await electron.launch({
    args: [path.join(root, 'packages', 'editor'), `--user-data-dir=${userData}`],
    env: { ...process.env, TILEWRIGHT_TEST_DIR: workDir, ...extraEnv },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1500, height: 920 }).catch(() => undefined);
  return { app, page, workDir, errors, base };
}

/** Create a project from a template through the UI and wait for the editor to appear. */
export async function createProjectViaUi(page: Page, name: string, template: string): Promise<void> {
  await page.getByTestId('btn-new-project').click();
  await page.getByTestId('project-name-input').fill(name);
  await page.getByTestId(`template-${template}`).check({ force: true });
  await page.getByTestId('btn-create-project').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.waitForTimeout(400);
}

/** Page coordinates of a cell centre. */
export async function cellXY(page: Page, x: number, y: number): Promise<{ x: number; y: number }> {
  return page.evaluate(([cx, cy]) => window.__viewport!.cellToClient(cx!, cy!), [x, y]);
}

export async function clickCell(page: Page, x: number, y: number, mods: ('Shift' | 'Alt' | 'Control')[] = []): Promise<void> {
  const p = await cellXY(page, x, y);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.click(p.x, p.y);
  for (const m of mods) await page.keyboard.up(m);
}

export async function dragCells(page: Page, from: [number, number], to: [number, number], mods: ('Shift' | 'Alt' | 'Control')[] = []): Promise<void> {
  const a = await cellXY(page, ...from);
  const b = await cellXY(page, ...to);
  for (const m of mods) await page.keyboard.down(m);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  const steps = 8;
  for (let i = 1; i <= steps; i++) await page.mouse.move(a.x + ((b.x - a.x) * i) / steps, a.y + ((b.y - a.y) * i) / steps);
  await page.mouse.up();
  for (const m of mods) await page.keyboard.up(m);
}

export async function pickTool(page: Page, id: string): Promise<void> {
  await page.getByTestId(`tool-${id}`).click();
}

/** Read map cell info straight from the open document. */
export async function cellInfo(page: Page, x: number, y: number): Promise<{ tile: number; height: number; slope: number; flags: number; deck: number }> {
  return page.evaluate(
    ([cx, cy]) => {
      const m = window.__store!.doc!.map;
      return { tile: m.getTile(cx!, cy!), height: m.getHeight(cx!, cy!), slope: m.getSlope(cx!, cy!)?.dir ?? 0, flags: m.getFlags(cx!, cy!), deck: m.getDeck(cx!, cy!) };
    },
    [x, y],
  );
}
