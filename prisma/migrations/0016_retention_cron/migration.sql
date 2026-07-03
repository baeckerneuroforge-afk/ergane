-- =============================================================================
-- ergane — Retention-Cron: garantierte Chat-Aufbewahrung (statt nur
-- opportunistisch nach Chat-/Slack-Aktivität).
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Bootstrap-Problem wie in 0009 (user_org_ids), gleiche schmale Lösung: der
-- Cron läuft OHNE Tenant-Kontext und muss wissen, WELCHE Tenants überhaupt
-- eine Aufbewahrungsfrist gesetzt haben. retention_org_ids() ist SECURITY
-- DEFINER und gibt NUR org-ids zurück (keine Einstellungen, keine Namen).
-- Jede eigentliche Löschung läuft danach unverändert durch withTenant(orgId)
-- → enforceChatRetention() (RLS-Boden unangetastet, Audit pro Tenant).
-- =============================================================================

CREATE OR REPLACE FUNCTION retention_org_ids()
RETURNS SETOF uuid
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
    RETURN QUERY
        SELECT "org_id" FROM "org_settings" WHERE "chat_retention_days" IS NOT NULL;
END;
$$ LANGUAGE plpgsql;

REVOKE ALL ON FUNCTION retention_org_ids() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION retention_org_ids() TO app_user;
