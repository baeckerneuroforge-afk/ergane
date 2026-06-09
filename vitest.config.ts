import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Load env vars (DATABASE_URL → app_user, DIRECT_DATABASE_URL → owner) before
    // any module — including the Prisma client singleton — is imported.
    setupFiles: ['./tests/setup.ts'],
    // The isolation tests share a single database and reset it between cases, so
    // they must not run concurrently with each other.
    fileParallelism: false,
    pool: 'forks',
    hookTimeout: 30_000,
    testTimeout: 30_000,
    include: ['tests/**/*.test.ts'],
  },
});
