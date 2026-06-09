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
