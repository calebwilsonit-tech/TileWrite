import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/src/**/*.test.ts', 'packages/*/src/**/*.test.tsx'],
    environment: 'node',
    // simulations of hundreds of units take a few seconds on a busy machine
    testTimeout: 60_000,
  },
});
