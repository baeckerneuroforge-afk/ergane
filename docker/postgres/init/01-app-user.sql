-- =============================================================================
-- Create the least-privileged application role `app_user`.
--
-- Runs as the superuser during cluster initialization (docker) or is applied
-- manually before migrations (CI / local-without-docker).
--
-- app_user is deliberately powerless:
--   NOSUPERUSER   — cannot do anything a superuser can (superusers bypass RLS).
--   NOBYPASSRLS   — cannot bypass Row-Level Security under any circumstance.
--   NOCREATEDB    — cannot create databases.
--   NOCREATEROLE  — cannot create / alter roles.
--   (not an owner) — it never owns a table, so FORCE RLS always applies to it.
--
-- Because the application connects ONLY as app_user, tenant isolation cannot be
-- defeated by an application-code mistake: the database enforces it.
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'app_user') THEN
    CREATE ROLE app_user
      LOGIN
      PASSWORD 'app_user'
      NOSUPERUSER
      NOCREATEDB
      NOCREATEROLE
      NOBYPASSRLS;
  END IF;
END
$$;

-- Allow app_user to connect to the application database.
GRANT CONNECT ON DATABASE ergane TO app_user;

-- Table-level privileges (SELECT/INSERT/...) are granted by the Prisma migration
-- AFTER the tables exist — see prisma/migrations/0001_init/migration.sql.
