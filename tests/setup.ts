// Loads variables from `.env` for local test runs. In CI the variables are
// provided directly in the environment; dotenv does not override existing vars,
// so CI values always win.
import 'dotenv/config';

if (!process.env.DATABASE_URL) {
  throw new Error(
    'DATABASE_URL is not set. Tests connect as the least-privileged `app_user` role. ' +
      'Copy .env.example to .env (or export the vars) before running `pnpm test`.',
  );
}
if (!process.env.DIRECT_DATABASE_URL) {
  throw new Error(
    'DIRECT_DATABASE_URL is not set. The test harness needs the owner connection to reset state between cases.',
  );
}

// Force the app_user client onto a SINGLE connection during tests. The suite is
// serial, so this is safe — and it makes the "no-context / leak-across-tx" checks
// meaningful: a bare query after a withTenant() transaction is guaranteed to run
// on the SAME backend that just had app.current_org set, so asserting it returns
// zero rows actually proves the transaction-local GUC was reset (not merely that
// a fresh connection never had it).
if (!/connection_limit=/.test(process.env.DATABASE_URL)) {
  const sep = process.env.DATABASE_URL.includes('?') ? '&' : '?';
  process.env.DATABASE_URL = `${process.env.DATABASE_URL}${sep}connection_limit=1`;
}
