-- =============================================================================
-- ergane — org settings: automatic chat retention (Phase 15).
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- org_settings: one row per tenant (org_id IS the primary key). Currently one
-- knob: chat_retention_days — NULL (default) = keep forever; N = messages
-- older than N days are purged opportunistically (enforceChatRetention runs
-- deferred after chat activity; no cron — same pattern as the Slack claim
-- cleanup). Follows the README checklist: FK, RLS ENABLE + FORCE, fail-closed
-- tenant policy (keyed on org_id, which doubles as the PK), minimal GRANTs
-- (no DELETE: settings rows are upserted, never removed by the app; they
-- cascade away with the org).
-- =============================================================================

CREATE TABLE "org_settings" (
    "org_id" UUID NOT NULL,
    "chat_retention_days" INTEGER,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "org_settings_pkey" PRIMARY KEY ("org_id"),
    CONSTRAINT "org_settings_retention_positive"
        CHECK ("chat_retention_days" IS NULL OR "chat_retention_days" > 0)
);

ALTER TABLE "org_settings"
    ADD CONSTRAINT "org_settings_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "org_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "org_settings_tenant_isolation" ON "org_settings"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON "org_settings" TO app_user;
