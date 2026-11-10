import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GAME = path.resolve(HERE, '..');
export const ROOT = path.resolve(GAME, '..', '..');
export const PROJECT = path.join(GAME, 'project');
export const SHOTS = path.join(GAME, 'screenshots');
export const shot = (name: string): string => path.join(SHOTS, name);

export interface Opened {
  app: ElectronApplication;
  page: Page;
  /** The copy of the game the editor has open (the committed project is never written to by a check). */
  dir: string;
  errors: string[];
}

/** Start the real editor on a throw-away copy of a project folder and wait until its first scene is showing. */
export async function openInEditor(projectDir = PROJECT): Promise<Opened> {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'nightgarden-e2e-'));
  const dir = path.join(base, 'Nightgarden');
  fs.cpSync(projectDir, dir, { recursive: true });
  const app = await electron.launch({
    args: [path.join(ROOT, 'packages', 'editor'), `--user-data-dir=${path.join(base, 'userdata')}`],
    env: { ...process.env, TILEWRIGHT_TEST_DIR: dir },
  });
  const page = await app.firstWindow();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await page.setViewportSize({ width: 1500, height: 920 }).catch(() => undefined);
  await page.getByTestId('btn-open-project').click();
  await page.getByTestId('editor-shell').waitFor();
  await page.waitForFunction(() => window.__viewport !== undefined && window.__viewport.doc !== null);
  await page.waitForTimeout(500);
  return { app, page, dir, errors };
}
