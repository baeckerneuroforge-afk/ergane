-- =============================================================================
-- helix — deliverable trace on skill runs (Loop Schritt A).
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Completed skill runs get a nullable jsonb `trace` describing the acceptance
-- criteria evaluation: which criteria passed/failed, whether a flag was raised.
-- Analogous to chat_messages.trace (0021) for answer traces.
--
-- NULL = run completed before this feature, or a run whose skill type has no
-- acceptance criteria defined. RLS/GRANTs of skill_runs (0001/0004) are
-- table-level and cover the new column unchanged.
-- =============================================================================

ALTER TABLE "skill_runs" ADD COLUMN "trace" JSONB;
