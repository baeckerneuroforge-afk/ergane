-- =============================================================================
-- ergane — value assumptions for the automation-value dashboard.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- The value dashboard turns LIVE skill runs into "hours saved" and a USD
-- equivalent. The conversion is an editable ASSUMPTION, not a measurement:
--   - value_hourly_rate_usd:      what one saved hour is worth (USD/h).
--   - value_minutes_per_skill:    jsonb map skill_key -> minutes saved per
--                                 SUCCESSFUL live run.
-- Both are NULLable: NULL (or a missing key in the map) means "use the code
-- default" (src/lib/value.ts) — a fresh org sees sensible numbers without any
-- setup. Only admins may change them (enforced in src/lib/value.ts, audited as
-- 'policy.changed', same shape as company profile / locale).
--
-- RLS/GRANTs of org_settings (0012) unchanged: the table-level grants already
-- cover new columns.
-- =============================================================================

ALTER TABLE "org_settings"
    ADD COLUMN "value_hourly_rate_usd" NUMERIC(8, 2),
    ADD COLUMN "value_minutes_per_skill" JSONB;

-- Assumptions must stay plausible: a rate is positive, and the minutes map is
-- a flat JSON object (validation of its values lives in src/lib/value.ts).
ALTER TABLE "org_settings"
    ADD CONSTRAINT "org_settings_value_hourly_rate_positive"
        CHECK ("value_hourly_rate_usd" IS NULL OR "value_hourly_rate_usd" > 0),
    ADD CONSTRAINT "org_settings_value_minutes_is_object"
        CHECK ("value_minutes_per_skill" IS NULL
               OR jsonb_typeof("value_minutes_per_skill") = 'object');
