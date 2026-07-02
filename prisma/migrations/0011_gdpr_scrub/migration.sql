-- =============================================================================
-- ergane — GDPR detail scrubbing (Phase 14).
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Closes the last documented Art.-17 gap from 0008: audit_log.detail JSON can
-- carry person identifiers (slackUserId, userId, decidedBy, …) that
-- pseudonymize_audit_actor does not touch.
--
-- 1. pseudonymize_audit_detail(old, new) — SECURITY DEFINER, same gates as
--    0008 (requires the caller's withTenant context, transaction-local GUC):
--    replaces every JSON **string value** in detail that EXACTLY equals `old`
--    with `new`. Exact-value semantics on purpose: the replacement operates
--    on the JSON-encoded string token ("old" incl. quotes), so substrings
--    inside longer values are never rewritten — no accidental corruption of
--    unrelated payloads. Composite values (e.g. "slack:U123" when erasing
--    "U123") must be scrubbed by a second call with that exact value — the
--    application layer does exactly that for slack actors.
--
-- 2. The 0008 trigger gains a SECOND narrow UPDATE exception: a change that
--    touches ONLY `detail` (all other columns identical), only while
--    app.audit_pseudonymize is set. Everything else keeps raising.
-- =============================================================================

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
       AND NEW."created_at" = OLD."created_at"
       AND (
            -- 0008 exception: ONLY actor_id changes …
            (NEW."detail" IS NOT DISTINCT FROM OLD."detail")
            -- … or (0011): ONLY detail changes.
            OR (NEW."actor_id" = OLD."actor_id")
       )
    THEN
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE'
       AND current_setting('app.audit_erasure', true) = 'on'
    THEN
        RETURN OLD;
    END IF;

    RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
        USING ERRCODE = 'raise_exception';
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION pseudonymize_audit_detail(p_old text, p_new text)
RETURNS integer
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_org uuid;
    v_count integer;
    v_old_token text;
    v_new_token text;
BEGIN
    v_org := NULLIF(current_setting('app.current_org', true), '')::uuid;
    IF v_org IS NULL THEN
        RAISE EXCEPTION 'pseudonymize_audit_detail: no tenant context (call inside withTenant)';
    END IF;
    IF p_old IS NULL OR p_old = '' OR p_new IS NULL OR p_new = '' THEN
        RAISE EXCEPTION 'pseudonymize_audit_detail: old and new values are required';
    END IF;

    -- JSON-encoded string tokens (incl. quotes/escaping) — replacing the full
    -- token means only EXACT string values match, never substrings.
    v_old_token := to_json(p_old)::text;
    v_new_token := to_json(p_new)::text;

    PERFORM set_config('app.audit_pseudonymize', 'on', true);
    UPDATE "audit_log"
       SET "detail" = replace("detail"::text, v_old_token, v_new_token)::jsonb
     WHERE "org_id" = v_org
       AND "detail" IS NOT NULL
       -- POSITION statt LIKE: Clerk-Ids enthalten '_' (LIKE-Wildcard) — das
       -- würde Zeilen ohne echten Treffer anfassen und den Zähler verfälschen.
       AND POSITION(v_old_token IN "detail"::text) > 0;
    GET DIAGNOSTICS v_count = ROW_COUNT;
    PERFORM set_config('app.audit_pseudonymize', '', true);

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION pseudonymize_audit_detail(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION pseudonymize_audit_detail(text, text) TO app_user;
