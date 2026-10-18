import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  // each test drives real Electron windows; with more at once than the machine can draw, timing-sensitive steps flake
  workers: 2,
  reporter: 'list',
  // golden pictures are written the first time and compared after that (they are per operating system)
  updateSnapshots: 'missing',
  expect: { toHaveScreenshot: { animations: 'disabled' } },
  globalSetup: './e2e/clean-temp.ts',
  globalTeardown: './e2e/clean-temp.ts',
});
