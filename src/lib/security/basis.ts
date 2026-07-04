// Verifiable basis constants for the Security view.
//
// These describe the CI gate that makes the guarantees checkable by anyone, not
// just us. Kept honest by being trivially verifiable: the gate name matches
// .github/workflows/ci.yml, and the test count matches `pnpm test` on this
// commit. If you change the test suite, update TEST_COUNT (run `pnpm test` and
// read the tally) — a stale number here is a small honesty bug, so keep it true.
export const SECURITY_BASIS = {
  /** The required check name in .github/workflows/ci.yml — a proper noun (the
   * literal CI check name), so it is NOT localized. */
  gateName: 'Tenant isolation gate',
  /** vitest tally on this commit — `pnpm test` → "Tests  N passed". */
  testCount: 280,
} as const;
