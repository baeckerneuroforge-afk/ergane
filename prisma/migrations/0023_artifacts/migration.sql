-- =============================================================================
-- helix — 0023_artifacts: tenant-scoped artifact storage for deliverables.
--
-- Artifacts are the persistent, versioned objects produced by skills (e.g. the
-- framework from transkript_zu_framework). They link to a client (optional) and
-- the producing skill run (optional), and reference a blob in external storage.
--
-- Follows the tenant-table checklist (see 0022_clients for the pattern):
--   org_id UUID NOT NULL + FK → organizations(id), composite unique (id, org_id),
--   RLS ENABLE + FORCE, tenant isolation policy on current_setting('app.current_org'),
--   least-privilege GRANTs to app_user.
--
-- Versionierung: artifacts with the same (org_id, slug) form a version chain.
-- slug = client_id + type + normalized title. A new run for the same purpose
-- increments the version; old versions stay readable. The slug is nullable for
-- one-off artifacts without a version chain.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Table: artifacts
-- -----------------------------------------------------------------------------
CREATE TABLE "artifacts" (
    "id"           UUID          NOT NULL DEFAULT gen_random_uuid(),
    "org_id"       UUID          NOT NULL,
    "title"        TEXT          NOT NULL,
    "type"         TEXT          NOT NULL,
    "client_id"    UUID,
    "run_id"       UUID,
    "blob_key"     TEXT          NOT NULL,
    "content_type" TEXT          NOT NULL,
    "size_bytes"   INTEGER       NOT NULL,
    "version"      INTEGER       NOT NULL DEFAULT 1,
    "slug"         TEXT,
    "created_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at"   TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "artifacts_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "artifacts_title_length" CHECK (char_length("title") BETWEEN 1 AND 500),
    CONSTRAINT "artifacts_type_length" CHECK (char_length("type") BETWEEN 1 AND 100),
    CONSTRAINT "artifacts_version_positive" CHECK ("version" >= 1)
);

CREATE UNIQUE INDEX "artifacts_id_org_id_key" ON "artifacts" ("id", "org_id");
CREATE INDEX "artifacts_org_id_created_at_idx" ON "artifacts" ("org_id", "created_at" DESC);
CREATE INDEX "artifacts_org_id_client_id_idx" ON "artifacts" ("org_id", "client_id")
    WHERE "client_id" IS NOT NULL;
CREATE INDEX "artifacts_org_id_slug_version_idx" ON "artifacts" ("org_id", "slug", "version" DESC)
    WHERE "slug" IS NOT NULL;

-- -----------------------------------------------------------------------------
-- Foreign keys: artifacts
-- -----------------------------------------------------------------------------
ALTER TABLE "artifacts"
    ADD CONSTRAINT "artifacts_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Composite FK → clients: cross-tenant references are structurally impossible.
ALTER TABLE "artifacts"
    ADD CONSTRAINT "artifacts_client_id_org_id_fkey"
    FOREIGN KEY ("client_id", "org_id") REFERENCES "clients" ("id", "org_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Composite FK → skill_runs: cross-tenant references are structurally impossible.
ALTER TABLE "artifacts"
    ADD CONSTRAINT "artifacts_run_id_org_id_fkey"
    FOREIGN KEY ("run_id", "org_id") REFERENCES "skill_runs" ("id", "org_id")
    ON DELETE SET NULL ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — same fail-closed predicate as every other tenant table.
-- No tenant context ⇒ zero rows (NULLIF → NULL → false).
-- -----------------------------------------------------------------------------
ALTER TABLE "artifacts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "artifacts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "artifacts_tenant_isolation" ON "artifacts"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- LEAST-PRIVILEGE GRANTS for app_user.
-- SELECT + INSERT + UPDATE + DELETE: artifacts are mutable and deletable.
-- DELETE is needed because the user must be able to remove an artifact + blob.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE, DELETE ON "artifacts" TO app_user;
