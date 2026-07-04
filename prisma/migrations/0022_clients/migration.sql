-- =============================================================================
-- helix — 0022_clients: tenant-scoped client entity + optional FK from skill_runs.
--
-- Applied by `prisma migrate deploy` as the database OWNER (DIRECT_DATABASE_URL).
-- Follows the checklist for adding a new tenant table:
--   org_id UUID NOT NULL + FK → organizations(id), composite unique (id, org_id),
--   RLS ENABLE + FORCE, tenant policy on current_setting('app.current_org'),
--   least-privilege GRANTs to app_user.
--
-- skill_runs gains an OPTIONAL client_id (nullable FK → clients). Existing runs
-- without a client continue to work unchanged — the column defaults to NULL.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: clients
-- -----------------------------------------------------------------------------
CREATE TABLE "clients" (
    "id"         UUID          NOT NULL DEFAULT gen_random_uuid(),
    "org_id"     UUID          NOT NULL,
    "name"       TEXT          NOT NULL,
    "notes"      TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "clients_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "clients_name_length" CHECK (char_length("name") BETWEEN 1 AND 200),
    CONSTRAINT "clients_notes_length" CHECK ("notes" IS NULL OR char_length("notes") <= 2000)
);

CREATE INDEX "clients_org_id_created_at_idx" ON "clients" ("org_id", "created_at" DESC);
CREATE UNIQUE INDEX "clients_id_org_id_key" ON "clients" ("id", "org_id");

-- -----------------------------------------------------------------------------
-- Foreign keys: clients
-- -----------------------------------------------------------------------------
ALTER TABLE "clients"
    ADD CONSTRAINT "clients_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — same fail-closed predicate as every other tenant table.
-- No tenant context ⇒ zero rows (NULLIF → NULL → false).
-- -----------------------------------------------------------------------------
ALTER TABLE "clients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "clients" FORCE ROW LEVEL SECURITY;
CREATE POLICY "clients_tenant_isolation" ON "clients"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- LEAST-PRIVILEGE GRANTS for app_user.
-- SELECT + INSERT + UPDATE: clients are mutable (name/notes can change).
-- No DELETE: clients are not removed by the app (org CASCADE handles offboarding).
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "clients" TO app_user;

-- -----------------------------------------------------------------------------
-- skill_runs: optional client_id FK
-- -----------------------------------------------------------------------------
ALTER TABLE "skill_runs" ADD COLUMN "client_id" UUID;

ALTER TABLE "skill_runs"
    ADD CONSTRAINT "skill_runs_client_id_org_id_fkey"
    FOREIGN KEY ("client_id", "org_id") REFERENCES "clients" ("id", "org_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "skill_runs_client_id_idx" ON "skill_runs" ("client_id")
    WHERE "client_id" IS NOT NULL;
