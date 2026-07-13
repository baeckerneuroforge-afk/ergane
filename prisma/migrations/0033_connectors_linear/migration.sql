-- =============================================================================
-- Connectors foundation + Linear (read) + documents external_ref / source_meta
--
-- (1) DocumentSource gains ticket | code | doc for tool-ingested knowledge.
-- (2) documents.external_ref + unique (org_id, external_ref) for ingestion dedup.
-- (3) documents.source_meta JSONB for deterministic loop fields (dueDate, state…).
-- (4) connector_installations — generic OAuth install (provider + external workspace).
-- (5) connector_processed_events — per-tenant webhook/event idempotency.
--
-- Applied by prisma migrate deploy as the database OWNER. app_user is least-privilege.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- DocumentSource: tool origins (additive enum values)
-- -----------------------------------------------------------------------------
ALTER TYPE "document_source" ADD VALUE IF NOT EXISTS 'ticket';
ALTER TYPE "document_source" ADD VALUE IF NOT EXISTS 'code';
ALTER TYPE "document_source" ADD VALUE IF NOT EXISTS 'doc';

-- -----------------------------------------------------------------------------
-- documents: external_ref (dedup) + source_meta (loop-checkable fields)
-- -----------------------------------------------------------------------------
ALTER TABLE "documents"
    ADD COLUMN IF NOT EXISTS "external_ref" TEXT,
    ADD COLUMN IF NOT EXISTS "source_meta" JSONB;

-- Partial unique: multiple NULL external_ref remain allowed (uploads/manual).
CREATE UNIQUE INDEX IF NOT EXISTS "documents_org_id_external_ref_key"
    ON "documents" ("org_id", "external_ref")
    WHERE "external_ref" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "documents_org_id_source_idx"
    ON "documents" ("org_id", "source");

-- -----------------------------------------------------------------------------
-- connector_installations — one external workspace maps to EXACTLY ONE org
-- (global unique on provider+external_id), and one provider per org.
-- access_token_ref stores enc:<payload> or env:…, never plaintext secrets.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "connector_installations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "external_id" TEXT NOT NULL,
    "access_token_ref" TEXT,
    "meta" JSONB,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "connector_installations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "connector_installations_provider_external_id_key"
    ON "connector_installations" ("provider", "external_id");
CREATE UNIQUE INDEX IF NOT EXISTS "connector_installations_org_id_provider_key"
    ON "connector_installations" ("org_id", "provider");
CREATE INDEX IF NOT EXISTS "connector_installations_org_id_idx"
    ON "connector_installations" ("org_id");

ALTER TABLE "connector_installations"
    ADD CONSTRAINT "connector_installations_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connector_installations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_installations" FORCE ROW LEVEL SECURITY;

CREATE POLICY "connector_installations_tenant_isolation" ON "connector_installations"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Bootstrap lookup (SELECT only): webhook knows provider+external workspace id,
-- not yet the org. resolveConnectorWorkspace() binds both GUCs transaction-locally.
CREATE POLICY "connector_installations_workspace_lookup" ON "connector_installations"
    FOR SELECT
    USING (
        "provider" = NULLIF(current_setting('app.connector_provider_lookup', true), '')
        AND "external_id" = NULLIF(current_setting('app.connector_external_lookup', true), '')
    );

GRANT SELECT, INSERT, UPDATE, DELETE ON "connector_installations" TO app_user;

-- -----------------------------------------------------------------------------
-- connector_processed_events — idempotency for connector webhooks (per tenant)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "connector_processed_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "event_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "connector_processed_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "connector_processed_events_org_provider_event_key"
    ON "connector_processed_events" ("org_id", "provider", "event_key");
CREATE INDEX IF NOT EXISTS "connector_processed_events_org_id_idx"
    ON "connector_processed_events" ("org_id");

ALTER TABLE "connector_processed_events"
    ADD CONSTRAINT "connector_processed_events_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "connector_processed_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "connector_processed_events" FORCE ROW LEVEL SECURITY;

CREATE POLICY "connector_processed_events_tenant_isolation" ON "connector_processed_events"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

GRANT SELECT, INSERT, DELETE ON "connector_processed_events" TO app_user;
