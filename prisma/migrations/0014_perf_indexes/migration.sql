-- Performance indexes for the dashboard's hot read paths.
-- Every dashboard query filters by org (RLS) and orders by created_at, and the
-- pending-approvals badge in the layout counts by (org, status) on EVERY page
-- view. The old single-column org_id indexes are replaced where a composite
-- index fully covers them.

-- skill_runs: runs list (order by created_at desc, take 100)
DROP INDEX IF EXISTS "skill_runs_org_id_idx";
CREATE INDEX "skill_runs_org_id_created_at_idx" ON "skill_runs"("org_id", "created_at" DESC);

-- approvals: pending badge + approvals page (filter status, order created_at)
DROP INDEX IF EXISTS "approvals_org_id_idx";
CREATE INDEX "approvals_org_id_status_created_at_idx" ON "approvals"("org_id", "status", "created_at");

-- documents: knowledge page (order by created_at desc)
DROP INDEX IF EXISTS "documents_org_id_idx";
CREATE INDEX "documents_org_id_created_at_idx" ON "documents"("org_id", "created_at" DESC);

-- audit_log: dashboard "Letzte Aktivität" + audit page incl. actor filter
DROP INDEX IF EXISTS "audit_log_org_id_idx";
CREATE INDEX "audit_log_org_id_created_at_idx" ON "audit_log"("org_id", "created_at" DESC);
CREATE INDEX "audit_log_org_id_actor_id_created_at_idx" ON "audit_log"("org_id", "actor_id", "created_at" DESC);
