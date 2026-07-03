-- =============================================================================
-- ergane — Benachrichtigungs-Adresse für wartende Freigaben.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Eine optionale E-Mail-Adresse pro Tenant (z. B. ein Team-Alias): wenn ein
-- Skill-Run in awaiting_approval pausiert, geht dorthin eine Benachrichtigung
-- (best-effort, NACH dem Commit — die Freigabe-Mechanik hängt nie davon ab).
-- NULL = keine Benachrichtigung. RLS/GRANTs der Tabelle (0012) unverändert.
-- =============================================================================

ALTER TABLE "org_settings"
    ADD COLUMN "approval_notify_email" TEXT;

ALTER TABLE "org_settings"
    ADD CONSTRAINT "org_settings_approval_notify_email_len"
        CHECK (
            "approval_notify_email" IS NULL
            OR char_length("approval_notify_email") BETWEEN 3 AND 320
        );
