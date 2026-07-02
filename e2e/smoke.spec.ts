// Smoke E2E (Phase 18) — a thin skeleton that grows with real Clerk test
// credentials. Self-skipping: without E2E_BASE_URL nothing runs (CI-safe).
//
// What it covers TODAY (no auth needed):
//   - /api/health answers 200 {ok:true}
//   - unauthenticated users land on the Clerk sign-in (tenant guard at the edge)
//
// Next step (documented, needs CLERK_TESTING_TOKEN from the Clerk dashboard):
// sign in via @clerk/testing, then walk the golden path — upload document →
// ask question with sources → start skill → approve → audit entry visible.
import { expect, test } from '@playwright/test';

const baseConfigured = Boolean(process.env.E2E_BASE_URL);

test.describe('smoke', () => {
  test.skip(!baseConfigured, 'E2E_BASE_URL not set — smoke suite skipped');

  test('health endpoint answers ok', async ({ request }) => {
    const res = await request.get('/api/health');
    expect(res.status()).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });
  });

  test('unauthenticated dashboard access is redirected to sign-in', async ({ page }) => {
    await page.goto('/dashboard');
    await page.waitForURL(/sign-in/);
    expect(page.url()).toContain('sign-in');
  });
});
