import { defineConfig } from 'vitest/config';

/** The Nightgarden checks (`npm run nightgarden:check`): the build is current, the project is sound, every room is solved and played, the screens keep to the theme and lead where they should. */
export default defineConfig({
  test: {
    include: ['games/nightgarden/check/**/*.test.ts'],
    environment: 'node',
    testTimeout: 1_200_000,
    hookTimeout: 1_200_000,
    fileParallelism: false,
    sequence: { concurrent: false },
  },
});
