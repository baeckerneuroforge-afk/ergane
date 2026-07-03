-- =============================================================================
-- ergane — skill run mode: live vs. simulation ("Probelauf" / dry-run).
--
-- Applied by `prisma migrate deploy` as the database OWNER (DIRECT_DATABASE_URL).
--
-- A run is either a LIVE execution or a SIMULATION (dry-run). In a simulation
-- the engine still runs retrieval, context building, guardrail evaluation and
-- the approval-need check EXACTLY as in live mode — but every ACTING step
-- (acts:true) is simulated instead of executed, so nothing leaves the system.
-- The distinction is persisted on the run itself so that:
--   - the append-only audit trail stays unambiguous (simulation runs are clearly
--     marked, never mistaken for a real execution), and
--   - value/activity aggregations can (and must) filter to mode='live' — a
--     simulation is NEVER a real execution (e.g. the "runs / 7 days" KPI, and
--     the later value dashboard).
--
-- `mode` is an ENUM, mirroring its sibling `status` (skill_run_status) on the
-- same table: a small, closed governance dimension, type-safe end to end. Like
-- the other skill_* enums it relies on PUBLIC's default USAGE on the type (this
-- codebase never REVOKEs it — see 0001..0004), so no extra GRANT is needed for
-- app_user.
--
-- RLS/GRANTs of skill_runs (0003) are unchanged: the table-level
-- SELECT/INSERT/UPDATE grant to app_user already covers the new column, and
-- DEFAULT 'live' backfills every existing row as a real execution — correct,
-- because everything created before this migration was a live run.
-- =============================================================================

CREATE TYPE "skill_run_mode" AS ENUM ('live', 'simulation');

ALTER TABLE "skill_runs"
    ADD COLUMN "mode" "skill_run_mode" NOT NULL DEFAULT 'live';

-- Supports the mode-filtered aggregations the column exists for: counting or
-- listing a tenant's runs by mode (e.g. the value dashboard's WHERE mode='live').
CREATE INDEX "skill_runs_org_id_mode_idx" ON "skill_runs" ("org_id", "mode");
