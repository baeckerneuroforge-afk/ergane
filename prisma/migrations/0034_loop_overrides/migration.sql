-- =============================================================================
-- Loop config overrides (P1-B): editable metric thresholds + criteria knobs
-- per org. NULL = code defaults (fail-closed safe).
-- =============================================================================

ALTER TABLE "org_settings"
    ADD COLUMN IF NOT EXISTS "loop_metric_thresholds" JSONB,
    ADD COLUMN IF NOT EXISTS "loop_criteria_overrides" JSONB;
