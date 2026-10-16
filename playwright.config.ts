import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  timeout: 60_000,
  retries: 0,
  reporter: 'list',
  globalSetup: './e2e/clean-temp.ts',
  globalTeardown: './e2e/clean-temp.ts',
});
