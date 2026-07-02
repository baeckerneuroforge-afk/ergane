-- =============================================================================
-- ergane — Slack idempotency (Phase 6b): slack_processed_events.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Slack redelivers a request (up to 3×) when it does not receive a 200 within
-- 3 seconds — and can, rarely, retry even after a fast ack. The Slack handlers
-- therefore CLAIM every request's stable key (event_id / trigger_id) with an
-- atomic INSERT into this table BEFORE doing any deferred work: the unique
-- index makes the second claim of the same key fail ⇒ that request is a
-- duplicate ⇒ ack 200, do nothing. The claim is per ORG (org_id in the unique),
-- so identical keys of different tenants never collide.
--
-- Follows the README checklist: org_id NOT NULL + FK, RLS ENABLE + FORCE,
-- fail-closed tenant policy, minimal GRANTs (INSERT to claim, SELECT for the
-- unique check/inspection, DELETE for the cleanup helper — never UPDATE).
--
-- Rows are only meaningful for Slack's retry horizon (minutes). Cleanup of
-- entries older than 24 h is a small helper (cleanupProcessedSlackEvents in
-- src/lib/slack/idempotency.ts) callable from any maintenance path — no cron
-- required for correctness, the table just grows slowly until cleaned.
-- =============================================================================

CREATE TABLE "slack_processed_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "event_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "slack_processed_events_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "slack_processed_events_org_id_event_key_key"
    ON "slack_processed_events" ("org_id", "event_key");
CREATE INDEX "slack_processed_events_org_id_idx" ON "slack_processed_events" ("org_id");

ALTER TABLE "slack_processed_events"
    ADD CONSTRAINT "slack_processed_events_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ROW-LEVEL SECURITY — the same fail-closed predicate as every tenant table.
ALTER TABLE "slack_processed_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slack_processed_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "slack_processed_events_tenant_isolation" ON "slack_processed_events"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- LEAST-PRIVILEGE GRANTS for app_user (claim, inspect, clean up — no UPDATE).
GRANT SELECT, INSERT, DELETE ON "slack_processed_events" TO app_user;
