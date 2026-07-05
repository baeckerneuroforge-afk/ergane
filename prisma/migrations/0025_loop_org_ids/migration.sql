-- =============================================================================
-- ergane — Loop-Tick: org-id enumeration for the periodic process-metric check
-- (Schritt C, plan §8).
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Same bootstrap problem and same narrow solution as retention_org_ids()
-- (migration 0016): the loop cron (/api/cron/loop) runs WITHOUT tenant context
-- and must learn WHICH tenants exist so it can check each one's metrics. Unlike
-- retention (only orgs with a deadline), the loop checks EVERY org, so this
-- returns all organization ids — and NOTHING else (no names, no settings).
--
-- Each metric check + flag write then runs, unchanged, through withTenant(orgId)
-- → computeLoopMetrics() + logAudit() (RLS floor untouched, audit per tenant).
-- SECURITY DEFINER + REVOKE/GRANT mirror 0016 exactly.
-- =============================================================================

CREATE OR REPLACE FUNCTION loop_org_ids()
RETURNS SETOF uuid
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT "id" FROM "organizations";
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION loop_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION loop_org_ids() TO app_user;
