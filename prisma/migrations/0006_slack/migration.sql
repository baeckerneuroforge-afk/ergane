-- =============================================================================
-- ergane — Slack adapter (Phase 6): slack_installations, slack_user_links.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Slack is the SECOND entry point — external, without a Clerk session. The two
-- tables map the external Slack identities onto the existing tenant model:
--
--   slack_installations  slack_team_id  → org_id   (one workspace = ONE tenant)
--   slack_user_links     slack_user_id  → user_id  (membership in THAT tenant)
--
-- Both follow the README checklist (org_id NOT NULL + FK, RLS ENABLE + FORCE,
-- fail-closed tenant policy, minimal GRANTs). Every Slack request first
-- resolves team → org and then runs through withTenant(orgId) like everything
-- else — the RLS floor is untouched.
--
-- SECRETS: bot_token_ref stores a REFERENCE to the bot token (e.g.
-- 'env:SLACK_BOT_TOKEN'), NEVER the token itself. There is no vault in this
-- stack yet; the actual token lives only in the environment (.env). When a
-- vault/KMS is introduced, the ref format changes — the column does not.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- slack_installations — one Slack workspace (team) maps to EXACTLY ONE org.
-- The GLOBAL unique index on slack_team_id makes double-mapping structurally
-- impossible: a second org claiming the same team is rejected by the database.
-- -----------------------------------------------------------------------------
CREATE TABLE "slack_installations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "slack_team_id" TEXT NOT NULL,
    "bot_token_ref" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "slack_installations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "slack_installations_slack_team_id_key"
    ON "slack_installations" ("slack_team_id");
CREATE INDEX "slack_installations_org_id_idx" ON "slack_installations" ("org_id");

-- -----------------------------------------------------------------------------
-- slack_user_links — a Slack user maps to a membership of THIS org.
-- The composite FK (org_id, user_id) → memberships(org_id, user_id) makes a
-- link to a foreign tenant's membership structurally impossible (on top of RLS),
-- and deletes the link automatically when the membership goes away.
-- -----------------------------------------------------------------------------
CREATE TABLE "slack_user_links" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "slack_user_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "slack_user_links_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "slack_user_links_org_id_slack_user_id_key"
    ON "slack_user_links" ("org_id", "slack_user_id");
CREATE INDEX "slack_user_links_org_id_idx" ON "slack_user_links" ("org_id");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "slack_installations"
    ADD CONSTRAINT "slack_installations_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_user_links"
    ADD CONSTRAINT "slack_user_links_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "slack_user_links"
    ADD CONSTRAINT "slack_user_links_membership_fkey"
    FOREIGN KEY ("org_id", "user_id")
    REFERENCES "memberships" ("org_id", "user_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — the same fail-closed predicate as every tenant table.
-- -----------------------------------------------------------------------------
ALTER TABLE "slack_installations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slack_installations" FORCE ROW LEVEL SECURITY;
CREATE POLICY "slack_installations_tenant_isolation" ON "slack_installations"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- Bootstrap lookup policy (SELECT only): an incoming Slack request knows the
-- team id but not yet the org — the tenant context is the RESULT of this very
-- lookup. resolveSlackTeam() binds the team id transaction-locally into
-- app.slack_team_lookup (same set_config mechanics as withTenant) and may then
-- read EXACTLY the rows of that one team. Without the GUC the policy matches
-- nothing (NULLIF ⇒ NULL ⇒ no row) — bare queries stay at 0 rows, fail-closed.
-- Writes are NOT covered (FOR SELECT), so mutations always require a tenant
-- context via the isolation policy above.
CREATE POLICY "slack_installations_team_lookup" ON "slack_installations"
    FOR SELECT
    USING ("slack_team_id" = NULLIF(current_setting('app.slack_team_lookup', true), ''));

ALTER TABLE "slack_user_links" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "slack_user_links" FORCE ROW LEVEL SECURITY;
CREATE POLICY "slack_user_links_tenant_isolation" ON "slack_user_links"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- LEAST-PRIVILEGE GRANTS for app_user.
-- Both tables: created and removed by admins, never edited in place → no UPDATE.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT, DELETE ON "slack_installations" TO app_user;
GRANT SELECT, INSERT, DELETE ON "slack_user_links" TO app_user;
