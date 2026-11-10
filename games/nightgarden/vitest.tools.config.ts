import { defineConfig } from 'vitest/config';

/** Tools that are run by hand: the build (`npm run nightgarden:build`), art previews and the room-design helpers in lab/. */
export default defineConfig({
  test: {
    include: ['games/nightgarden/tools/**/*.test.ts', 'games/nightgarden/lab/**/*.test.ts', 'games/nightgarden/art/**/*.test.ts'],
    environment: 'node',
    testTimeout: 1_200_000,
    fileParallelism: false,
  },
});
