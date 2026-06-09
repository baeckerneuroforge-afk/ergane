-- =============================================================================
-- ergane — initial migration.
--
-- Applied by `prisma migrate deploy` as the database OWNER (DIRECT_DATABASE_URL).
-- This file is the source of truth for tenant isolation. It:
--   1. creates the schema (enums, tables, FKs, indexes),
--   2. ENABLEs + FORCEs Row-Level Security on every tenant table,
--   3. installs tenant-isolation policies keyed on the per-transaction GUC
--      `app.current_org` (set by withTenant() via set_config()),
--   4. makes audit_log append-only (policy + trigger),
--   5. grants the LEAST privileges needed to the application role `app_user`.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "role" AS ENUM ('owner', 'admin', 'member');
CREATE TYPE "actor_type" AS ENUM ('human', 'agent');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "clerk_org_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_clerk_org_id_key" ON "organizations" ("clerk_org_id");

CREATE TABLE "memberships" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "memberships_org_id_user_id_key" ON "memberships" ("org_id", "user_id");
CREATE INDEX "memberships_org_id_idx" ON "memberships" ("org_id");

CREATE TABLE "knowledge_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "knowledge_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "knowledge_items_org_id_idx" ON "knowledge_items" ("org_id");

CREATE TABLE "audit_log" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "actor_type" "actor_type" NOT NULL,
    "action" TEXT NOT NULL,
    "target" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_log_org_id_idx" ON "audit_log" ("org_id");

-- -----------------------------------------------------------------------------
-- Foreign keys — every tenant table references organizations(id).
-- -----------------------------------------------------------------------------
ALTER TABLE "memberships"
    ADD CONSTRAINT "memberships_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "knowledge_items"
    ADD CONSTRAINT "knowledge_items_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_log"
    ADD CONSTRAINT "audit_log_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- ROW-LEVEL SECURITY
--
-- The isolation predicate everywhere is:
--     org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
--
-- current_setting(..., true) returns NULL when the GUC was never set this
-- session, but after a transaction-local set_config() it RESETS to an empty
-- string '' (not NULL) at COMMIT/ROLLBACK. Casting '' to uuid would raise 22P02.
-- NULLIF(..., '') collapses BOTH "never set" and "reset to empty" to NULL, and
-- `org_id = NULL` evaluates to NULL (not TRUE), so the row is filtered out.
-- => "no tenant context" fails CLOSED: zero rows, deterministically, never a
--    leak and never an error.
--
-- ENABLE turns RLS on. FORCE makes it apply even to the table owner, so nobody
-- except a superuser (which the app never is) can sidestep it.
-- =============================================================================

-- --- organizations (tenant root): a tenant may see/modify ONLY its own row ----
-- organizations.id IS the tenant key (the deterministic UUIDv5 of the Clerk org
-- id), so the self-row predicate keys on `id` (not org_id). This stops org
-- metadata (name, clerk_org_id) from being enumerable across tenants — enforced
-- at the DB layer, not by app-code discipline. The bootstrap upsert in
-- ensureOrgAndMembership()/seed runs INSIDE withTenant(orgId), so its
-- INSERT/UPDATE satisfy WITH CHECK (id = current_org).
ALTER TABLE "organizations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "organizations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "organizations_self_isolation" ON "organizations"
    USING ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- --- memberships -------------------------------------------------------------
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "memberships" FORCE ROW LEVEL SECURITY;
CREATE POLICY "memberships_tenant_isolation" ON "memberships"
    USING ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- --- knowledge_items ---------------------------------------------------------
ALTER TABLE "knowledge_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "knowledge_items" FORCE ROW LEVEL SECURITY;
CREATE POLICY "knowledge_items_tenant_isolation" ON "knowledge_items"
    USING ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- --- audit_log : tenant-isolated AND append-only -----------------------------
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_log" FORCE ROW LEVEL SECURITY;
-- Read only your own tenant's audit rows.
CREATE POLICY "audit_log_select_tenant" ON "audit_log"
    FOR SELECT
    USING ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);
-- Insert only into your own tenant.
CREATE POLICY "audit_log_insert_tenant" ON "audit_log"
    FOR INSERT
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);
-- NOTE: there is deliberately NO policy FOR UPDATE or FOR DELETE. Under FORCE
-- RLS, a command with no permissive policy is denied. The trigger below is a
-- second, independent guard (defense-in-depth) that also stops the owner.

CREATE OR REPLACE FUNCTION audit_log_prevent_mutation()
    RETURNS TRIGGER
    LANGUAGE plpgsql
AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'check_violation';
END;
$$;

CREATE TRIGGER audit_log_no_update
    BEFORE UPDATE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();

CREATE TRIGGER audit_log_no_delete
    BEFORE DELETE ON "audit_log"
    FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();

-- =============================================================================
-- LEAST-PRIVILEGE GRANTS for app_user.
--
-- app_user holds ONLY these privileges. Combined with NOBYPASSRLS and not owning
-- any table, every statement it issues is filtered by the policies above.
-- It is NOT granted: CREATE on the schema, ownership, TRUNCATE, or any access to
-- the _prisma_migrations bookkeeping table.
-- =============================================================================
GRANT USAGE ON SCHEMA public TO app_user;

-- organizations: tenant root, now RLS-protected (self-row policy above). app_user
-- may look up / create / rename ONLY its own org row, and may NOT delete any org.
-- The grant permits the command; RLS restricts it to the current tenant's row.
GRANT SELECT, INSERT, UPDATE ON "organizations" TO app_user;

GRANT SELECT, INSERT, UPDATE, DELETE ON "memberships" TO app_user;
GRANT SELECT, INSERT, UPDATE, DELETE ON "knowledge_items" TO app_user;

-- audit_log is append-only at the privilege level too: SELECT + INSERT only.
GRANT SELECT, INSERT ON "audit_log" TO app_user;
