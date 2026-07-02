-- =============================================================================
-- ergane — RAG v2 (Phase 10): per-actor chat history for multi-turn.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- chat_messages.actor_id — WHO a chat turn belongs to (Clerk user id or
-- 'slack:U…'). Nullable on purpose: rows from before this migration have no
-- actor and are treated fail-closed — they never appear in anyone's history.
--
-- Why per actor: multi-turn answering feeds previous turns into the LLM
-- prompt. History is therefore scoped to the SAME person — a member can never
-- receive a lead's confidential answers through prompt history, because only
-- their own turns load (disclosure holds across turns). Purely additive:
-- existing RLS policy/grants on chat_messages cover the new column.
-- =============================================================================

ALTER TABLE "chat_messages" ADD COLUMN "actor_id" TEXT;

CREATE INDEX "chat_messages_org_id_actor_id_created_at_idx"
    ON "chat_messages" ("org_id", "actor_id", "created_at");
