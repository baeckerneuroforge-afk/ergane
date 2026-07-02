// Playwright smoke config (Phase 18). Runs ONLY against an existing server
// (E2E_BASE_URL) — the suite self-skips without it, so `pnpm e2e` is safe in
// any environment. Browsers: `pnpm exec playwright install chromium` once.
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:3000',
    trace: 'retain-on-failure',
  },
  reporter: [['list']],
});
