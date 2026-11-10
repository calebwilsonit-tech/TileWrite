import { defineConfig } from '@playwright/test';

/** Draws the art of the game in the editor's Sprite studio and Tile studio (run by `npm run art`). */
export default defineConfig({
  testDir: 'art',
  testMatch: 'studio.spec.ts',
  timeout: 3_600_000,
  retries: 0,
  workers: 1,
  reporter: 'list',
});
