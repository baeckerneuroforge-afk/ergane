-- Assert app_user's least-privilege hardening at deploy time (Audit-Fix F6,
-- docs/audit/2026-07-05-fix-plan.md).
--
-- The entire "the DATABASE enforces tenant isolation" premise rests on the
-- runtime role `app_user` being:
--   * NOT a superuser        (superusers bypass even FORCE RLS),
--   * NOBYPASSRLS            (cannot opt out of Row-Level Security),
--   * NOT the owner of any tenant table (FORCE RLS is what makes RLS apply to the
--     owner; owning a table would still be a misconfiguration and is refused).
--
-- Until now those properties lived ONLY in an out-of-band init script
-- (docker/postgres/init/01-app-user.sql, scripts/setup-local-db.sh) and an
-- .env.example comment — nothing in the versioned migration chain enforced them.
-- On a managed provider (Neon) a mis-provisioned role would silently defeat RLS.
--
-- This migration runs as the OWNER during `prisma migrate deploy` (the same
-- privileged connection that created the tables) and raises — failing the deploy
-- — if the invariant is violated. It changes nothing when the setup is correct.
-- tests/isolation.test.ts already proves the same properties in CI; this pulls
-- the guarantee into every production deploy, where CI does not run.
DO $$
DECLARE
  r RECORD;
  owned_count INT;
BEGIN
  SELECT rolsuper, rolbypassrls
    INTO r
    FROM pg_roles
    WHERE rolname = 'app_user';

  IF NOT FOUND THEN
    RAISE EXCEPTION
      'app_user role is missing — the application connects as app_user; provision it (NOSUPERUSER, NOBYPASSRLS, no table ownership) before deploying.';
  END IF;

  IF r.rolsuper THEN
    RAISE EXCEPTION
      'app_user must be NOSUPERUSER — a superuser bypasses FORCE ROW LEVEL SECURITY and defeats tenant isolation.';
  END IF;

  IF r.rolbypassrls THEN
    RAISE EXCEPTION
      'app_user must be NOBYPASSRLS — BYPASSRLS defeats tenant isolation.';
  END IF;

  SELECT count(*)
    INTO owned_count
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tableowner = 'app_user';

  IF owned_count > 0 THEN
    RAISE EXCEPTION
      'app_user must not own any table in schema public (owns %) — the runtime role owning a table is a misconfiguration; tables are owned by the migrator/owner role.',
      owned_count;
  END IF;
END
$$;
