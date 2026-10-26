import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['./src/test/load-env.ts'],
    // DB tests share one database; run files serially.
    fileParallelism: false,
  },
});
