import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // DB tests share one database; run files serially.
    fileParallelism: false,
    projects: [
      { test: { name: 'unit', include: ['tests/unit/**/*.test.ts'], environment: 'node' } },
      {
        test: {
          name: 'db',
          include: ['tests/integration/**/*.test.ts'],
          environment: 'node',
          testTimeout: 20_000,
        },
      },
    ],
  },
});
