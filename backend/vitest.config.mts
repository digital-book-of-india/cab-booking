import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Each file boots its own in-memory MongoDB; under parallel load some tests need headroom.
    testTimeout: 30_000,
    hookTimeout: 60_000,
  },
});
