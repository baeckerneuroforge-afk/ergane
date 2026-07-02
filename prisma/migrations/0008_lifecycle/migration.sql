-- =============================================================================
-- ergane — data lifecycle & GDPR subject rights (Phase 7).
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- No new tables — this migration adds the DELETION capabilities the
-- "GDPR-native" claim requires, without weakening the existing floor:
--
--   1. DELETE grants for app_user on documents/chunks/chat_messages —
--      document deletion (with chunk cascade) and chat retention/purge.
--      All three keep their FOR ALL tenant policies, so a DELETE without a
--      tenant context still affects 0 rows (fail-closed as always).
--
--   2. audit_log stays append-only for ALL normal paths, but gains two
--      narrow, GUC-gated exceptions in the trigger (see below):
--        - PSEUDONYMIZE: an UPDATE that changes ONLY actor_id, and only while
--          app.audit_pseudonymize = 'on' (transaction-local, set exclusively
--          by the SECURITY DEFINER function pseudonymize_audit_actor).
--          Art. 17: the person identifier is erased, the audit STRUCTURE
--          (what happened, when) remains.
--        - ERASURE: a DELETE only while app.audit_erasure = 'on'
--          (transaction-local, set exclusively by delete_organization).
--          Needed because tenant offboarding cascades organizations →
--          audit_log, and the trigger fires on cascaded deletes too.
--
--   3. Two SECURITY DEFINER functions as the ONLY entry points to those
--      exceptions. Both are fail-closed: they REQUIRE the caller's
--      transaction to carry the matching app.current_org (i.e. they only work
--      inside withTenant(orgId)), pin search_path, and act strictly within
--      that one tenant. app_user gets EXECUTE — it still has NO
--      UPDATE/DELETE privilege on audit_log and NO DELETE on organizations,
--      so the functions are the single, auditable path.
--
-- Known limitation (documented, deliberate): audit_log.detail may contain
-- personal identifiers inside JSON payloads (e.g. slackUserId). Phase 7
-- pseudonymizes actor_id; detail-level scrubbing is a follow-up and is noted
-- in the README.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. DELETE grants (policies FOR ALL already cover DELETE, tenant-scoped).
-- -----------------------------------------------------------------------------
GRANT DELETE ON "documents"     TO app_user;
GRANT DELETE ON "chunks"        TO app_user;
GRANT DELETE ON "chat_messages" TO app_user;

-- -----------------------------------------------------------------------------
-- 2. audit_log trigger: append-only with the two gated exceptions.
--    Replaces the 0001 function in place (both triggers keep pointing at it).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION audit_log_prevent_mutation()
RETURNS trigger AS $$
BEGIN
    IF TG_OP = 'UPDATE'
       AND current_setting('app.audit_pseudonymize', true) = 'on'
       AND NEW."id"         = OLD."id"
       AND NEW."org_id"     = OLD."org_id"
       AND NEW."actor_type" = OLD."actor_type"
       AND NEW."action"     = OLD."action"
       AND NEW."target"     IS NOT DISTINCT FROM OLD."target"
       AND NEW."detail"     IS NOT DISTINCT FROM OLD."detail"
       AND NEW."created_at" = OLD."created_at"
    THEN
        -- Pseudonymization: ONLY actor_id may change, only under the GUC.
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE'
       AND current_setting('app.audit_erasure', true) = 'on'
    THEN
        -- Tenant erasure: the organizations → audit_log cascade during
        -- delete_organization(). Never reachable outside that function.
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

-- -----------------------------------------------------------------------------
-- 3a. pseudonymize_audit_actor — Art. 17 for audit actor ids, per tenant.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION pseudonymize_audit_actor(p_old_actor text, p_new_actor text)
RETURNS integer
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org uuid;
    v_count integer;
BEGIN
    v_org := NULLIF(current_setting('app.current_org', true), '')::uuid;
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'pseudonymize_audit_actor: no tenant context (call inside withTenant)';
    END IF;
    IF p_old_actor IS NULL OR p_old_actor = '' OR p_new_actor IS NULL OR p_new_actor = '' THEN
        RAISE EXCEPTION 'pseudonymize_audit_actor: old and new actor ids are required';
    END IF;

    PERFORM set_config('app.audit_pseudonymize', 'on', true);
    UPDATE "audit_log"
       SET "actor_id" = p_new_actor
     WHERE "org_id" = v_org AND "actor_id" = p_old_actor;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    PERFORM set_config('app.audit_pseudonymize', '', true);

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION pseudonymize_audit_actor(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pseudonymize_audit_actor(text, text) TO app_user;

-- -----------------------------------------------------------------------------
-- 3b. delete_organization — tenant offboarding (full erasure via cascades).
--     Fail-closed: only deletes the org whose id equals the transaction's
--     app.current_org. The audit_log cascade is permitted via app.audit_erasure.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION delete_organization(p_org uuid)
RETURNS void
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org uuid;
BEGIN
    v_org := NULLIF(current_setting('app.current_org', true), '')::uuid;
    IF v_org IS NULL OR v_org <> p_org THEN
        RAISE EXCEPTION 'delete_organization: tenant context does not match the organization to delete';
    END IF;

    PERFORM set_config('app.audit_erasure', 'on', true);
    DELETE FROM "organizations" WHERE "id" = p_org;
    PERFORM set_config('app.audit_erasure', '', true);
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION delete_organization(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION delete_organization(uuid) TO app_user;
