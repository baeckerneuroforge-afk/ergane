-- =============================================================================
-- P2: loop_flags (mutable status) + no schema change needed for github/drive
-- (they reuse connector_installations + documents.external_ref / source=code|doc).
-- =============================================================================

CREATE TYPE "loop_flag_status" AS ENUM ('open', 'acked', 'resolved');

CREATE TABLE "loop_flags" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "status" "loop_flag_status" NOT NULL DEFAULT 'open',
    "action" TEXT NOT NULL,
    "target" TEXT,
    "category" TEXT NOT NULL DEFAULT 'other',
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "type" TEXT,
    "detail" JSONB,
    "audit_id" UUID,
    "acked_at" TIMESTAMPTZ(6),
    "acked_by" TEXT,
    "resolved_at" TIMESTAMPTZ(6),
    "resolved_by" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "loop_flags_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "loop_flags_org_id_created_at_idx"
    ON "loop_flags" ("org_id", "created_at" DESC);
CREATE INDEX "loop_flags_org_id_status_idx"
    ON "loop_flags" ("org_id", "status");
CREATE INDEX "loop_flags_org_id_target_idx"
    ON "loop_flags" ("org_id", "target");

ALTER TABLE "loop_flags"
    ADD CONSTRAINT "loop_flags_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "loop_flags" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "loop_flags" FORCE ROW LEVEL SECURITY;

CREATE POLICY "loop_flags_tenant_isolation" ON "loop_flags"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON "loop_flags" TO app_user;
