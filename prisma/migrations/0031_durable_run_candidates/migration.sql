-- =============================================================================
-- Durable skill-run background driver: candidate discovery for the cron tick.
--
-- Problem: /api/cron/skills-durable runs as app_user WITHOUT tenant context.
-- RLS on skill_runs would return zero rows. Same bootstrap as loop_org_ids /
-- retention_org_ids: a narrow SECURITY DEFINER returns ONLY (org_id, run_id)
-- for advanceable runs (status running|approved, claim free/expired).
--
-- Each continue still goes through continueRun() → withTenant(orgId) + claim.
-- =============================================================================

CREATE OR REPLACE FUNCTION durable_skill_run_candidates(p_limit integer DEFAULT 50)
RETURNS TABLE(org_id uuid, run_id uuid)
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    -- Cap hard so a bad caller cannot dump the whole table.
    p_limit := GREATEST(1, LEAST(COALESCE(p_limit, 50), 200));
    RETURN QUERY
        SELECT sr."org_id", sr."id"
        FROM "skill_runs" sr
        WHERE sr."status" IN ('running', 'approved')
          AND (sr."claim_until" IS NULL OR sr."claim_until" < now())
        ORDER BY sr."updated_at" ASC
        LIMIT p_limit;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION durable_skill_run_candidates(integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION durable_skill_run_candidates(integer) TO app_user;
