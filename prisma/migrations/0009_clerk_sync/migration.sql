-- =============================================================================
-- ergane — Clerk synchronization (Phase 8): memberships.role_source,
-- user_org_ids() lookup for user-level erasure.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- 1. memberships.role_source — who owns a membership's role:
--      'clerk' (default) → the role mirrors Clerk and is overwritten on every
--                          sync (ensureOrgAndMembership, webhook updates).
--      'local'           → the role was set in ergane (setMembershipRole, e.g.
--                          the org-internal 'lead' tier that Clerk does not
--                          know) and is NEVER overwritten by a Clerk sync.
--    Fixes the documented trap that a locally assigned 'lead' was silently
--    reset to 'member' on the user's next dashboard load.
--
-- 2. user_org_ids(p_user) — SECURITY DEFINER lookup: which orgs does this
--    user belong to? Needed by the user.deleted webhook, which carries NO org
--    context (the user is being erased across ALL tenants) — the same
--    bootstrap problem as the Slack team lookup, solved the same narrow way:
--    the function returns ONLY org ids (no other membership data) for ONE
--    explicit user id. Every subsequent action still runs through
--    withTenant(orgId) per org.
-- =============================================================================

ALTER TABLE "memberships"
    ADD COLUMN "role_source" TEXT NOT NULL DEFAULT 'clerk'
    CHECK ("role_source" IN ('clerk', 'local'));

CREATE OR REPLACE FUNCTION user_org_ids(p_user text)
RETURNS SETOF uuid
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    IF p_user IS NULL OR p_user = '' THEN
        RAISE EXCEPTION 'user_org_ids: a user id is required';
    END IF;
    RETURN QUERY SELECT "org_id" FROM "memberships" WHERE "user_id" = p_user;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION user_org_ids(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION user_org_ids(text) TO app_user;
