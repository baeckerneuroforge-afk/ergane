# Performance & Security Review — helix.ai

**Datum**: 2026-07-04  
**Repository**: helix (https://github.com/baeckerneuroforge-afk/helix)  
**Zweck**: Detaillierte Analyse von Performance- und Sicherheitslücken (nur Review, keine Code-Änderungen)

---

## Einleitung

Dieses Dokument fasst eine ausführliche Performance- und Sicherheits-Review des helix-Projekts zusammen. Helix ist eine GDPR-native, multi-tenant B2B-Foundation (Next.js + Prisma + Postgres RLS + Clerk + Slack + Skills-Engine + RAG).

**Wichtiger Hinweis**: Diese Review wurde ausschließlich lesend durchgeführt. Es wurden **keine Code-Änderungen** vorgenommen.

## Starke Fundamente (werden nicht geschwächt)

- **Tenant-Isolation** ist hervorragend umgesetzt:
  - `requireTenant()` (ausschließlich aus Clerk-Session)
  - `withTenant(orgId, fn)` → interaktive Transaktion + `set_config('app.current_org', ...)` (parameterisiert)
  - Alle Tenant-Tabellen mit `RLS ENABLE + FORCE`
  - Starke Composite-FKs und Unique-Constraints als zusätzliche Absicherung
- Alle öffentlichen Endpunkte (Slack, Clerk Webhooks, Cron): **Signature-first** (HMAC + `timingSafeEqual` + Replay-Schutz) + Idempotenz + ack-then-defer
- Disclosure-Filter läuft **im SQL** (vor jedem LLM-Kontext) basierend auf Role + Visibility Grants
- Tägliche Soft-Limits vor teuren Operationen
- Append-only Audit + Pseudonymisierungs-Pfad für GDPR
- Secrets werden nie plaintext gespeichert (nur Refs: `env:` oder `enc:`)
- Fail-closed-Design an fast allen Stellen
- Gute Testabdeckung für Isolation (isolation tests, hardening tests etc.)

## Sicherheitslücken (schließbar)

| # | Lücke | Risiko | Betroffene Dateien |
|---|-------|--------|--------------------|
| 1 | **Reingest-Upload umgeht Admin-Gate** | Normale Member können beliebige Dokumente überschreiben (im Gegensatz zu Löschen/Visibility-Änderung) | `src/app/dashboard/knowledge/actions.ts` (reingestUpload) |
| 2 | **Duplizierte Disclosure-Logik** | Gefahr von Divergenz → entweder Leak oder fehlendes Wissen in Skills | `src/lib/rag/retrieve.ts` + `src/lib/skills/catalog/wissen.ts` |
| 3 | **Unzureichende Validierung von IDs** | Viele `documentId`, `runId` etc. werden nur getrimmt, kein `isUuid()` vorher | Viele Server Actions (knowledge, skills, approvals, settings) |
| 4 | **Session-Role vs. Live-DB-Role** | Lokale Elevationen (`lead`/`owner` mit `roleSource=local`) sind nicht immer in Clerk-Session sichtbar | `src/lib/auth-context.ts`, `clerk/webhooks.ts`, Policies, UI-Gates |
| 5 | **Outbound HTTP ohne Timeouts** | Hängende Requests, Ressourcenverbrauch, TX-Timeouts möglich | `src/lib/slack/client.ts`, `ai/voyage.ts`, `effects/resend.ts`, OAuth |
| 6 | **Schwaches Rate-Limiting** | Nur auf Slack/Clerk-Endpunkte + pro-Prozess. Kein Schutz auf Chat/Skills/Ingest | `src/lib/slack/ratelimit.ts`, `src/lib/limits.ts` |
| 7 | **Fehlermeldungen enthalten Identifier** | User-seitig können orgId/userId/documentId etc. leaken | `tenant.ts`, `uuid.ts`, Policy- und Lifecycle-Funktionen |
| 8 | **OAuth-State nutzt dasselbe Secret wie Slack-Signaturen** | Unklare Trennung der Secrets | `src/lib/slack/oauth.ts` |
| 9 | **Full-Export lädt alles in den Speicher** | Memory-Probleme und langsame Responses bei großen Tenants | `src/lib/lifecycle/index.ts` (viele findMany ohne Limit) |
| 10 | **CSP & Security-Header** | CSP läuft standardmäßig nur im Report-Only-Modus | `src/lib/csp.ts`, `next.config.mjs` |

**Weitere Beobachtungen**:
- Listen (Knowledge, Approvals etc.) zeigen teilweise mehr Infos als das eigentliche Retrieval erlauben würde.
- `src/lib/org.ts` (ensureOrgAndMembership) ist für die Membership-Synchronisation kritisch.

## Performance-Lücken (schließbar)

1. **Skill-Engine pro Step eigene Transaktion**
   - Jeder Step macht eine separate `withTenant()`-TX (`engine.ts`)
   - Embeddings und Effects (E-Mail, PDF) laufen **innerhalb** der 15s-Transaktion
   - Besonders kritisch bei `wissen_zusammenfassen` und ähnlichen Skills

2. **Doppelte Vector-Queries bei RAG**
   - Pro Frage werden zwei sehr ähnliche Similarity-Queries ausgeführt (`searchVisible` + `countFilteredHits`)

3. **Fehlende Pagination / Limits in UI-Listen**
   - Knowledge-Liste: kein `take`
   - Approvals (pending), Settings, große Teile von Dashboard und Export laden alles
   - Runs-Liste hat nur ein willkürliches `take: 100`

4. **Kein Embedding-Caching**
   - Jede Anfrage, jeder Ingest und Skills berechnen Embeddings neu

5. **Schwere Aggregationen**
   - Value-Stats laden viele Runs und aggregieren in JS
   - Tägliche Limits zählen mit `count()` über wachsende Tabellen

6. **Keine Timeouts bei externen Aufrufen**
   - Alle `fetch` zu Voyage, Anthropic, Slack, Resend ohne `AbortController`

7. **Volle History + Kontext in LLM-Prompts**
   - Keine smarte Kürzung oder Token-Budgetierung

8. **Feste 15s Transaktions-Timeout**
   - Für alle Tenant-Operationen (kombiniert mit Netzwerkaufrufen problematisch)

9. **In-Memory Rate Limiter**
   - Nur für öffentliche Slack-Pfade, grobes Pruning, pro Prozess (schwach in Serverless)

## Empfohlene Priorisierung

**High Priority (Sicherheit + Kosten)**
- Reingest-Admin-Gate schließen
- Timeouts auf alle ausgehenden HTTP-Calls
- Bessere ID-Validierung + Fehler-Sanitization
- Pagination auf Knowledge, Runs, Approvals

**Medium Priority**
- Duplizierte Disclosure-Logik konsolidieren
- Embedding-Cache oder Deduplikation
- Rate-Limiting auf teure authentifizierte Pfade erweitern
- Export verbessern (Streaming / Limits)

**Nice to have**
- CSP auf Enforce umstellen (nach Beobachtung)
- Value-Stats optimieren (SQL-Aggregate)
- Skill-Engine Transaktions-Modell überdenken

## Dateien mit hoher Relevanz

**Kritisch für Security**
- `src/app/dashboard/knowledge/actions.ts`
- `src/lib/rag/retrieve.ts`
- `src/lib/skills/catalog/wissen.ts`
- `src/lib/skills/engine.ts`
- `src/lib/lifecycle/index.ts`
- `src/lib/auth-context.ts`
- `src/lib/tenant.ts`

**Kritisch für Performance**
- `src/lib/skills/engine.ts`
- `src/lib/rag/answer.ts`
- `src/lib/rag/retrieve.ts`
- `src/lib/value.ts`
- `src/lib/limits.ts`
- Alle Dashboard-Listen und Actions

## Nächste Schritte (Vorschlag)

1. Dieses Review als Grundlage verwenden.
2. Priorisierte Lücken in kleinen, sicheren Schritten schließen.
3. Bestehende Isolation- und Hardening-Tests erweitern.
4. Bei Bedarf synthetische Lasttests mit großen Tenants durchführen.

---

**Hinweis**: Dieses Dokument wurde auf Wunsch des Users als eigenständige Markdown-Datei gespeichert. Es dient nur der Dokumentation der Review-Ergebnisse.