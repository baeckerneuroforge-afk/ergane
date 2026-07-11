-- =============================================================================
-- Durable multi-step runs + step-bound (multi-checkpoint) approvals.
--
-- skill_runs:
--   claim_token / claim_until  — lease so concurrent continue/resume is serialized
--   step_attempts              — retriable failure budget for the current next step
--
-- approvals:
--   step_idx / step_name       — bind each approval to one acting step/checkpoint
--   NEW approvals always set these; NULL = legacy (pre-0030) rows only.
-- =============================================================================

ALTER TABLE "skill_runs"
  ADD COLUMN "claim_token" TEXT,
  ADD COLUMN "claim_until" TIMESTAMPTZ(6),
  ADD COLUMN "step_attempts" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "approvals"
  ADD COLUMN "step_idx" INTEGER,
  ADD COLUMN "step_name" TEXT;

-- Pending approval lookups by run + step (multi-checkpoint gate).
CREATE INDEX "approvals_run_id_step_idx_status_idx"
  ON "approvals" ("run_id", "step_idx", "status");
