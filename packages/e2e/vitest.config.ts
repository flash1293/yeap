import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 180_000,
    hookTimeout: 60_000,
    // Run test files sequentially — each test depends on prior state
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    sequence: { concurrent: false },
    reporters: ['verbose'],
  },
})
