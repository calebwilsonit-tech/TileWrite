import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  // each test drives real Electron windows; with more at once than the machine can draw, timing-sensitive steps flake
  workers: 2,
  reporter: 'list',
  // golden pictures are per operating system. On a computer they are written the first time and compared after that. In CI a missing one is
  // an error, not a quiet pass (the pictures test skips itself, saying so, on a system that has none: see e2e/compat-screens.spec.ts)
  updateSnapshots: process.env.CI ? 'none' : 'missing',
  expect: { toHaveScreenshot: { animations: 'disabled' } },
  globalSetup: './e2e/clean-temp.ts',
  globalTeardown: './e2e/clean-temp.ts',
});
