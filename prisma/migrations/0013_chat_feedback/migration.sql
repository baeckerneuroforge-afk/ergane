-- =============================================================================
-- ergane — RAG feedback loop (Phase 18): chat_feedback.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- One 👍/👎 verdict per (message, voter). The voter can only rate messages of
-- their OWN conversation (enforced in submitChatFeedback: chat history is
-- per-actor since 0010, so rating foreign messages would leak their
-- existence). Votes are changeable (upsert) — hence the UPDATE grant.
-- Deliberately NOT audited: feedback is high-volume product telemetry, not a
-- governance action; aggregates surface in the chat UI.
--
-- Follows the README checklist: org_id NOT NULL + FK, RLS ENABLE + FORCE,
-- fail-closed tenant policy, minimal GRANTs. The composite FK
-- (message_id, org_id) → chat_messages makes cross-tenant votes structurally
-- impossible on top of RLS — chat_messages gains the required (id, org_id)
-- unique target (purely additive).
-- =============================================================================

ALTER TABLE "chat_messages"
    ADD CONSTRAINT "chat_messages_id_org_id_key" UNIQUE ("id", "org_id");

CREATE TABLE "chat_feedback" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "message_id" UUID NOT NULL,
    "actor_id" TEXT NOT NULL,
    "verdict" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "chat_feedback_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "chat_feedback_verdict_check" CHECK ("verdict" IN ('up', 'down'))
);
CREATE UNIQUE INDEX "chat_feedback_org_id_message_id_actor_id_key"
    ON "chat_feedback" ("org_id", "message_id", "actor_id");
CREATE INDEX "chat_feedback_org_id_idx" ON "chat_feedback" ("org_id");

ALTER TABLE "chat_feedback"
    ADD CONSTRAINT "chat_feedback_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_feedback"
    ADD CONSTRAINT "chat_feedback_message_fkey"
    FOREIGN KEY ("message_id", "org_id")
    REFERENCES "chat_messages" ("id", "org_id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_feedback" FORCE ROW LEVEL SECURITY;
CREATE POLICY "chat_feedback_tenant_isolation" ON "chat_feedback"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE ON "chat_feedback" TO app_user;
