-- =============================================================================
-- ergane — knowledge base (Phase 2): documents, chunks (pgvector), chat_messages.
--
-- Applied by `prisma migrate deploy` as the database OWNER (DIRECT_DATABASE_URL).
-- Follows the README checklist "adding a new tenant table" for all three tables:
--   org_id UUID NOT NULL + FK → organizations(id), index on org_id,
--   RLS ENABLE + FORCE, tenant policy on current_setting('app.current_org'),
--   least-privilege GRANTs to app_user (no ownership, no TRUNCATE, no bypass).
-- =============================================================================

-- pgvector: the extension binaries ship with the server image
-- (pgvector/pgvector:pg16 in docker/CI, built from source by
-- scripts/setup-local-db.sh for Homebrew). CREATE EXTENSION requires the
-- privileges this migration already runs with (owner/superuser) — app_user
-- could never do this.
CREATE EXTENSION IF NOT EXISTS vector;

-- -----------------------------------------------------------------------------
-- Enums
-- -----------------------------------------------------------------------------
CREATE TYPE "document_source" AS ENUM ('upload', 'manual', 'transcript');
CREATE TYPE "chat_role" AS ENUM ('user', 'assistant');

-- -----------------------------------------------------------------------------
-- Tables
-- -----------------------------------------------------------------------------
CREATE TABLE "documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "source" "document_source" NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "documents_org_id_idx" ON "documents" ("org_id");
-- Target for the composite FK from chunks: guarantees a chunk can only ever
-- point at a document of the SAME tenant (see below).
CREATE UNIQUE INDEX "documents_id_org_id_key" ON "documents" ("id", "org_id");

CREATE TABLE "chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "document_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    -- vector(1024) = the dimensionality of the default embedding model
    -- (voyage-3.5; the fake test embedder produces the same size). Changing the
    -- embedding model to a different dimensionality requires a new migration.
    "embedding" vector(1024) NOT NULL,
    "ord" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "chunks_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "chunks_org_id_idx" ON "chunks" ("org_id");
CREATE UNIQUE INDEX "chunks_document_id_ord_key" ON "chunks" ("document_id", "ord");

CREATE TABLE "chat_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "org_id" UUID NOT NULL,
    "role" "chat_role" NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
    CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "chat_messages_org_id_created_at_idx" ON "chat_messages" ("org_id", "created_at");

-- -----------------------------------------------------------------------------
-- Foreign keys
-- -----------------------------------------------------------------------------
ALTER TABLE "documents"
    ADD CONSTRAINT "documents_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chunks"
    ADD CONSTRAINT "chunks_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- COMPOSITE FK (document_id, org_id): a chunk row is structurally incapable of
-- referencing another tenant's document, even if RLS were somehow mis-set —
-- belt-and-suspenders on top of the tenant policies below.
ALTER TABLE "chunks"
    ADD CONSTRAINT "chunks_document_id_org_id_fkey"
    FOREIGN KEY ("document_id", "org_id") REFERENCES "documents" ("id", "org_id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "chat_messages"
    ADD CONSTRAINT "chat_messages_org_id_fkey"
    FOREIGN KEY ("org_id") REFERENCES "organizations" ("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -----------------------------------------------------------------------------
-- ROW-LEVEL SECURITY — same predicate as every other tenant table:
--   org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
-- (fails CLOSED: no tenant context ⇒ zero rows; see 0001_init for the rationale)
-- -----------------------------------------------------------------------------
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "documents" FORCE ROW LEVEL SECURITY;
CREATE POLICY "documents_tenant_isolation" ON "documents"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER TABLE "chunks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chunks" FORCE ROW LEVEL SECURITY;
CREATE POLICY "chunks_tenant_isolation" ON "chunks"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

ALTER TABLE "chat_messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "chat_messages" FORCE ROW LEVEL SECURITY;
CREATE POLICY "chat_messages_tenant_isolation" ON "chat_messages"
    USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
    WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);

-- -----------------------------------------------------------------------------
-- Vector index — HNSW, cosine distance (the operator retrieve() uses: <=>).
--
-- RLS (and the explicit org_id filter in retrieve()) is applied as a filter on
-- top of the index scan. pgvector >= 0.8 supports iterative index scans, so a
-- filtered ANN query keeps scanning until it has enough matching rows instead
-- of returning too few. A per-org partial index is impossible (orgs are
-- dynamic), and at this scale a single global HNSW index filtered by org is
-- the standard, correct setup.
-- -----------------------------------------------------------------------------
CREATE INDEX "chunks_embedding_hnsw_idx" ON "chunks"
    USING hnsw ("embedding" vector_cosine_ops);

-- -----------------------------------------------------------------------------
-- LEAST-PRIVILEGE GRANTS for app_user.
--
-- Deliberately minimal: exactly what the current code paths need (list/ingest
-- documents+chunks, read/append chat history). No UPDATE/DELETE anywhere yet —
-- there is no feature that needs them; grant when (and only when) one appears.
-- app_user still owns nothing, cannot TRUNCATE, cannot bypass RLS.
-- -----------------------------------------------------------------------------
GRANT SELECT, INSERT ON "documents" TO app_user;
GRANT SELECT, INSERT ON "chunks" TO app_user;
GRANT SELECT, INSERT ON "chat_messages" TO app_user;
