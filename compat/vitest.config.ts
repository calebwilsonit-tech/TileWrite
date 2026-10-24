import { defineConfig } from 'vitest/config';

// The compatibility corpus (see compat/README.md). It plays every project for a few thousand ticks, so it gets its own run.
export default defineConfig({
  test: {
    include: ['compat/*.test.ts'],
    environment: 'node',
    testTimeout: 300_000,
    hookTimeout: 300_000,
    // projects share the behaviour registry, so they are played one after the other
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
