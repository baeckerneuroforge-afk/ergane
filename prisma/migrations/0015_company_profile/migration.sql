-- =============================================================================
-- ergane — Firmendaten am Tenant (company profile).
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Vier optionale Textfelder auf org_settings: Briefkopf (Name + Adresse) und
-- Fußzeile (USt-IdNr. + Bankverbindung) der erzeugten Angebots-/Rechnungs-
-- PDFs. RLS/FORCE + Policy + GRANTs der Tabelle (Migration 0012) gelten
-- unverändert — Spalten erben sie. CHECK-Limits halten die Felder als kurze
-- Stammdaten (kein Freitext-Dump, DB bleibt die letzte Instanz).
-- =============================================================================

ALTER TABLE "org_settings"
    ADD COLUMN "company_name"    TEXT,
    ADD COLUMN "company_address" TEXT,
    ADD COLUMN "company_vat_id"  TEXT,
    ADD COLUMN "company_bank"    TEXT;

ALTER TABLE "org_settings"
    ADD CONSTRAINT "org_settings_company_name_len"
        CHECK ("company_name" IS NULL OR char_length("company_name") BETWEEN 1 AND 200),
    ADD CONSTRAINT "org_settings_company_address_len"
        CHECK ("company_address" IS NULL OR char_length("company_address") BETWEEN 1 AND 500),
    ADD CONSTRAINT "org_settings_company_vat_id_len"
        CHECK ("company_vat_id" IS NULL OR char_length("company_vat_id") BETWEEN 1 AND 50),
    ADD CONSTRAINT "org_settings_company_bank_len"
        CHECK ("company_bank" IS NULL OR char_length("company_bank") BETWEEN 1 AND 500);
