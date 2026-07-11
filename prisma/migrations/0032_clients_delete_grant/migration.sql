-- =============================================================================
-- Grant DELETE on clients to app_user so admin client-erase (Art. 17 / PII notes)
-- can remove a client row under RLS. Previously only SELECT/INSERT/UPDATE —
-- org CASCADE still handled full tenant offboarding; this enables per-client erase.
-- skill_runs.client_id and artifacts.client_id are ON DELETE SET NULL.
-- =============================================================================

GRANT DELETE ON "clients" TO app_user;
