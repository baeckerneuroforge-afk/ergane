-- =============================================================================
-- helix — skill_runs.is_correction: mark a run started AS a loop correction
-- (Block 4 / Schritt E, plan §4 anti-loop guard).
--
-- Applied by `prisma migrate deploy` as the database OWNER (DIRECT_DATABASE_URL).
--
-- Autonomous auto-correction (autonomy 'autonomous') must NOT re-correct a run
-- that is ITSELF a correction — otherwise run→flag→run→… loops forever. A run's
-- correction-start AUDIT entry is written only AFTER the run has executed (and
-- thus AFTER that run's own end-of-run criteria evaluation already fired), so it
-- is too late to be the anti-loop marker. This column is set ATOMICALLY when the
-- correction run is CREATED (startRun with isCorrection), so the run's own
-- evaluation sees it and never escalates a correction-run flag to another run.
--
-- Boolean, DEFAULT false: every existing run and every normal (human/skill-
-- started) run is NOT a correction — correct. Only startCorrectionRun sets true.
--
-- RLS/GRANTs of skill_runs (0003) are unchanged: the table-level
-- SELECT/INSERT/UPDATE grant to app_user already covers the new column.
-- =============================================================================

ALTER TABLE "skill_runs"
    ADD COLUMN "is_correction" BOOLEAN NOT NULL DEFAULT false;
