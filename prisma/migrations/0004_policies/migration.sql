-- =============================================================================
-- ergane — governance policies (Phase 4): approval_policies, visibility_grants,
-- documents.visibility, memberships 'lead' role, approvals.required_role,
-- audit_log.detail.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Policies act ONLY WITHIN a tenant. The RLS floor from 0001–0003 is untouched:
-- both new tables follow the README checklist (org_id NOT NULL + FK, RLS
-- ENABLE + FORCE, fail-closed tenant policy, minimal GRANTs). No policy value
-- can open anything cross-tenant — RLS filters before any policy is even read.
--
-- NOTE on the enum: 'lead' is added to the EXISTING "role" type but the new
-- value is deliberately never USED inside this migration (Postgres forbids
-- using a value added in the same transaction) — defaults/seeds reference it
-- only at runtime.
-- =============================================================================

-- Minimal RBAC: the org-internal 'lead' tier between admin and member.
ALTER TYPE "role" ADD VALUE IF NOT EXISTS 'lead' BEFORE 'member';

-- Roles come from seed/demo for now (later: Clerk org-role mapping, see README).
ALTER TABLE "memberships" ALTER COLUMN "role" SET DEFAULT 'member';

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "approval_mode" AS ENUM ('always', 'threshold', 'never');
CREATE TYPE "document_visibility" AS ENUM ('open', 'restricted', 'confidential');

-- -----------------------------------------------------------------------------
-- documents.visibility — existing rows become 'open' via the default.
-- -----------------------------------------------------------------------------
ALTER TABLE "documents"
    ADD COLUMN "visibility" "document_visibility" NOT NULL DEFAULT 'open';

-- -----------------------------------------------------------------------------
-- audit_log.detail — structured payload (e.g. old/new value of a policy
-- change). Nullable; the append-only trigger and the SELECT/INSERT-only
-- privileges are unaffected.
-- -----------------------------------------------------------------------------
ALTER TABLE "audit_log" ADD COLUMN "detail" JSONB;

-- -----------------------------------------------------------------------------
-- approvals.required_role — which role may decide this approval. NULLABLE on
-- purpose: it is set (from the approval policy) only when a policy produced the
-- approval; a NULL keeps the pre-policy behavior (any decided_by), so existing
-- runs/tests are untouched. With a policy present the gate is enforced.
-- -----------------------------------------------------------------------------
ALTER TABLE "approvals" ADD COLUMN "required_role" "role";

-- -----------------------------------------------------------------------------
-- approval_policies — per skill: when does a run need a human?
--   always    → every run pauses for approval
--   threshold → runs with amount ≥ threshold_amount pause
--   never     → no approval — ONLY honored for skills without money effects;
--               for handlesMoney skills the engine overrides it at runtime
--               (audit 'policy.overridden_failsafe'). Not switch-off-able.
-- -----------------------------------------------------------------------------
CREATE TABLE "approval_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "skill_key" TEXT NOT NULL,
    "mode" "approval_mode" NOT NULL,
    "threshold_amount" NUMERIC(14, 2),
    "approver_role" "role",
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "approval_policies_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "approval_policies_org_id_idx" ON "approval_policies" ("org_id");
CREATE UNIQUE INDEX "approval_policies_org_id_skill_key_key"
    ON "approval_policies" ("org_id", "skill_key");

-- -----------------------------------------------------------------------------
-- visibility_grants — which roles may see which visibility level.
-- 'open' needs no grant (always visible); level is therefore restricted to the
-- two protected tiers. No grant for a level+role ⇒ that role does NOT see it
-- (fail-closed).
-- -----------------------------------------------------------------------------
CREATE TABLE "visibility_grants" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "level" "document_visibility" NOT NULL,
    "role" "role" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "visibility_grants_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "visibility_grants_level_not_open" CHECK ("level" <> 'open')
);
CREATE INDEX "visibility_grants_org_id_idx" ON "visibility_grants" ("org_id");
CREATE UNIQUE INDEX "visibility_grants_org_id_level_role_key"
    ON "visibility_grants" ("org_id", "level", "role");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "approval_policies"
    ADD CONSTRAINT "approval_policies_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "visibility_grants"
    ADD CONSTRAINT "visibility_grants_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — the same fail-closed predicate as every tenant table.
-- -----------------------------------------------------------------------------
ALTER TABLE "approval_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "approval_policies" FORCE ROW LEVEL SECURITY;
CREATE POLICY "approval_policies_tenant_isolation" ON "approval_policies"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER TABLE "visibility_grants" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "visibility_grants" FORCE ROW LEVEL SECURITY;
CREATE POLICY "visibility_grants_tenant_isolation" ON "visibility_grants"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- LEAST-PRIVILEGE GRANTS for app_user.
-- approval_policies: upserted (INSERT/UPDATE), never deleted by the app.
-- visibility_grants: granted/revoked (INSERT/DELETE); a grant row is never
-- edited in place, so no UPDATE.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, UPDATE ON "approval_policies" TO app_user;
GRANT SELECT, INSERT, DELETE ON "visibility_grants" TO app_user;

-- documents was SELECT/INSERT-only ("grant when a feature appears" — 0002).
-- The feature is here: setDocumentVisibility() flips the disclosure level.
GRANT UPDATE ON "documents" TO app_user;
