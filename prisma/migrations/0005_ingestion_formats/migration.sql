-- =============================================================================
-- ergane — ingestion formats (Phase 5): additive metadata on documents.
--
-- Applied by `prisma migrate deploy` as the database OWNER.
--
-- Purely ADDITIVE: three nullable columns describing where a document's text
-- came from. No new table, so the RLS checklist collapses to "nothing to do":
-- documents keeps its 0002 policy (ENABLE + FORCE, tenant predicate) and its
-- existing table-level GRANTs — both automatically cover new columns.
-- Existing rows stay valid (all three columns NULL = "unknown / pre-0005").
-- =============================================================================

ALTER TABLE "documents"
  ADD COLUMN "source_format" TEXT,
  ADD COLUMN "page_count"    INTEGER,
  ADD COLUMN "word_count"    INTEGER;
