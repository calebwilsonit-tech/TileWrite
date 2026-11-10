import { defineConfig } from '@playwright/test';

/** The Nightgarden end-to-end checks: the real editor opens the game, checks it, plays it and looks at every screen. */
export default defineConfig({
  testDir: 'e2e',
  timeout: 300_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  expect: { toHaveScreenshot: { animations: 'disabled', maxDiffPixelRatio: 0.01 } },
});
