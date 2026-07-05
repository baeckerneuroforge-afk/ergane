# Helix — Sicherheits- & Performance-Audit

**Datum:** 2026-07-05
**Stand:** `main` @ `60fe578` (Loop Schritt E / Autonomie „Autonom")
**Umfang:** Tenant-Isolation (Postgres RLS), API-/Auth-Grenzen, LLM-/Skill-/Loop-Fläche, Performance (DB/Queries/Rendering), Infrastruktur (Secrets, Krypto, Dependencies, Header).
**Methode:** Fünf parallele Read-only-Analysen über die jeweiligen Flächen; die beiden folgenschwersten Befunde (Blob-Zugriff, Auto-Correction-Race) und der RLS-Kern zusätzlich per Hand am Code gegengeprüft.

> Dieses Dokument ist bewusst **kein Plan** und ändert keinen bestehenden Plan. Es ist eine Momentaufnahme „wo stehen wir" mit einer nach Wirkung sortierten Befundliste. Umsetzung/Reihenfolge ist eine spätere, separate Entscheidung.

---

## Kurzfassung (TL;DR)

Helix ist für seinen Reifegrad **ungewöhnlich sauber gebaut**. Das zentrale Sicherheitsversprechen — Tenant-Isolation wird von der **Datenbank** erzwungen (Postgres Row-Level Security + FORCE), nicht von App-Code-Disziplin — **hält**. Es wurde **kein tenant-übergreifendes Datenleck** im DB-Layer, **kein IDOR**, **keine ungeprüfte/fail-open Signaturprüfung** und **kein Vertrauen in client-gelieferte Org-IDs** gefunden. Der `app_user`-Rollenzwang, die Krypto (AES-256-GCM), das Secret-Masking und die Upload-Härtung sind solide. Dependencies: **0 kritisch / 0 hoch**. Next.js **15.5.19** ist gegen CVE-2025-29927 (Middleware-Auth-Bypass) gepatcht.

Die realen offenen Punkte konzentrieren sich auf **wenige, klar benennbare Stellen**:

| # | Kategorie | Schwere | Befund (Einzeiler) |
|---|-----------|---------|--------------------|
| S1 | Security | **Mittel** | Artefakt-Blobs liegen `access: 'public'` (Kommentar behauptet „privat") — Kunden-Deliverables nur durch unerratbare Capability-URL geschützt, keine Authz beim Fetch. |
| S2 | Security/Reliab. | **Mittel** | Race im Tageslimit der Auto-Correction → Kappe (3/Tag) kann überschritten werden. Der Code-Kommentar liegt in der Richtung falsch. |
| P1 | Performance | **Hoch** | `audit_log.action` ist nicht indiziert; das Dashboard-Layout filtert bei **jeder** Navigation per `LIKE 'flag.%'`. Append-only-Tabelle wächst unbegrenzt. |
| P2 | Performance | **Hoch (Ops)** | Serverless-Connection-Pool nicht konfiguriert: nackter PrismaClient, kein `connection_limit`, kein Pooler, interaktive Transaktionen auf Vercel → Exhaustion-Risiko. |
| S3 | Security (Ops) | **Mittel** | `app_user`-Rollenattribute (`NOBYPASSRLS`, kein Superuser, kein Owner) leben nur im Docker/Local-Init-Skript, **nicht** in den Prisma-Migrations → auf Neon-Prod eine unverifizierte Runbook-Annahme. |
| P3 | Performance | **Mittel** | Embedding-HTTP-Call läuft **innerhalb** der `withTenant`-Transaktion in `holeWissen` → Connection wird über Netz-Latenz gehalten. |
| S4 | Security | **Niedrig** | Kein HSTS-Header; CSP standardmäßig Report-Only (in Prod prüfen, ob `CSP_ENFORCE=true`). |
| S5 | Security | **Niedrig** | `CRON_SECRET` per `!==` statt `timingSafeEqual` verglichen (die einzigen zwei Nicht-Konstantzeit-Vergleiche im Repo). |
| S6 | Security | **Niedrig** | Prompt-Injection-Schutz ist nur instruktionsbasiert; Framework-Skill speist freigegebene Deliverables als vertrauenswürdige „Vorarbeit" zurück (Persistenz-Vektor, nur Content-Integrität). |
| D1 | Deps | **Niedrig** | `postcss 8.4.31` (transitiv via Next) moderate XSS-CVE; hier nicht direkt ausnutzbar. `next`-Floor `^15.1.6` liegt unter der CVE-sicheren Grenze 15.2.3 (Lockfile löst sicher auf). |

Nichts davon ist ein akuter Notfall. S1 und S2 sind die zwei Punkte mit dem besten Aufwand/Wirkung-Verhältnis; P1 und P2 sind die Performance-/Skalierungs-Hebel, die man vor Last angehen will.

---

## 1. Was verifiziert **solide** ist

Damit die Befundliste im Kontext steht — diese Eigenschaften wurden geprüft und halten:

**Tenant-Isolation (DB-Layer) — der Kern.**
- Alle **20 tenant-bezogenen Tabellen** haben `ENABLE` **und** `FORCE ROW LEVEL SECURITY` mit einer Policy, die **beide** Richtungen abdeckt (`USING` für Lesen/Update/Delete-Sichtbarkeit, `WITH CHECK` für Insert/Update-Schreiben). Über 27 Migrationen hinweg gibt es **keine** tenant-Tabelle ohne RLS/FORCE/Policy/Grant — jede `CREATE TABLE` mit `org_id` bringt die vier Bausteine mit.
- Das Isolations-Prädikat ist überall `org_id = NULLIF(current_setting('app.current_org', true), '')::uuid` und **fail-closed**: ohne Tenant-Kontext → 0 Zeilen, deterministisch, nie ein Fehler, nie ein Leak.
- `withTenant()` (`src/lib/tenant.ts`) ist der einzige sanktionierte Zugang: UUID-Validierung zuerst, dann eine gepinnte interaktive Transaktion, deren **erste** Anweisung den GUC via `set_config('app.current_org', $1, true)` bindet — transaktions-lokal (bei COMMIT/ROLLBACK automatisch geräumt, pooling-sicher) und als **Bind-Parameter** (keine SQL-Injection-Fläche).
- `audit_log` ist **dreifach** append-only: Grant nur SELECT/INSERT, keine UPDATE/DELETE-Policy (unter FORCE = verweigert), **plus** ein `BEFORE UPDATE/DELETE`-Trigger.
- Strukturelle Zweitverteidigung über RLS hinaus: zusammengesetzte `(id, org_id)`-Unique-Targets + composite FKs, sodass ein Kind-Row, der auf den Parent eines fremden Tenants zeigt, **strukturell unmöglich** ist.
- **Belegt durch Tests:** `tests/isolation.test.ts` läuft als `app_user` (verweigert den Start sonst) und prüft adversarisch beide Richtungen, WITH CHECK bei Insert und bei Tenant-Umzug, Fail-closed ohne Kontext, GUC-Nicht-Leck über gepoolte Verbindungen, den Append-only-Trigger unabhängig via Superuser-Bypass, sowie Privilege-Escalation-Negative.

**Auth-Grenzen.**
- `orgId` wird **immer** serverseitig abgeleitet — aus der verifizierten Clerk-Session (`requireTenant`) oder aus einem signatur-verifizierten Webhook — nie aus Client-Input. Deterministisches UUIDv5-Mapping der Clerk-Org-ID.
- Öffentliche Routen (Slack, Clerk/Svix, Cron, Health) sind alle fail-closed: HMAC-SHA256 über den Raw-Body mit `timingSafeEqual`, ±5-Min-Replay-Fenster, plus atomare Idempotenz-Claims. Health leakt nichts (Fehler nie im Body).
- Artefakt-Download ist **kein** IDOR: `getArtifact(orgId, id)` läuft `findUnique` innerhalb `withTenant(orgId)`, RLS gibt für ein fremdes Artefakt null → 404 vor jedem Byte. (Der App-Pfad ist sauber — die Schwäche liegt in der Blob-Speicherung selbst, siehe S1.)

**Krypto & Secrets.**
- `src/lib/crypto.ts`: AES-256-GCM, Schlüssel auf exakt 32 Byte validiert (wirft sonst), **frischer** `randomBytes(12)`-IV pro Verschlüsselung, Auth-Tag gesetzt/geprüft, `final()` wirft bei Manipulation. Kein ECB, kein statischer IV, keine Nonce-Wiederverwendung. Lehrbuch.
- Slack-Bot-Tokens **verschlüsselt at rest** (`bot_token_ref = 'enc:…'`); DB hält nie Plaintext; Auflösung fail-closed.
- `.env` ist **nicht** getrackt und war nie in der Git-History. Keine hartcodierten Secrets. Keine gefährlichen Fallback-Defaults für sicherheitsrelevante Variablen.
- Logging (`src/lib/log.ts`): rekursives Secret-Masking nach Key-Name **und** Wert-Form (Slack `xox…`, Svix `whsec_`, Stripe `sk_live`, Bearer); Regel „nie Inhalte loggen, nur IDs/Counts/Actions"; nie `.stack` an den Client.

**Rendering & RAG.**
- **Keine** `withTenant`-in-Schleife-N+1-Hotspots in Request-Pfaden; Dashboard-Reads sind in je **eine** Transaktion + `Promise.all` gebündelt.
- RAG hat einen **echten** Vektor-Index (`chunks_embedding_hnsw_idx`, HNSW/cosine) — ANN-Index-Scan, kein In-Memory-Scan.
- Nur 8 kleine `'use client'`-Blätter; Server Components korrekt genutzt.

**Dependencies.**
- `pnpm audit --prod`: **0 kritisch, 0 hoch.** Anthropic SDK, Clerk, Prisma, Vercel Blob, mammoth, unpdf ohne bekannte Lücken.
- Next.js **15.5.19** (Lockfile) — über der CVE-2025-29927-Fix-Grenze (15.2.3); Clerks Peer-Constraint verhindert zusätzlich ein Auflösen auf < 15.2.3.

---

## 2. Security-Befunde (Detail)

### S1 — Artefakt-Blobs `access: 'public'` (Mittel) · *von zwei Analysen unabhängig gefunden*
**Ort:** `src/lib/storage/blob.ts` (`put(...)` mit `access: 'public'`, Read-Pfad `get()` = nacktes `fetch(match.url)`).
Generierte Deliverables (Angebote, Rechnungen, Frameworks) werden als **öffentliche** Vercel-Blobs abgelegt — obwohl der Datei-Header-Kommentar „private, no public access" behauptet. Der Blob-Key enthält `orgId` + v4-UUID, die URL ist also unerratbar; aber jede geleakte/geloggte/geteilte URL ist **weltweit lesbar**, ohne Tenant-Autorisierung beim Fetch. Das ist Zugriffskontrolle per **Capability-URL**, nicht echte Tenant-Isolation — ein Bruch mit dem GDPR-nativen Anspruch, gerade weil Artefakte Kundendaten enthalten.
*Kern des Fixes:* private Blobs + signierte/kurzlebige URLs, oder Bytes durch den bereits RLS-gesicherten `/api/artifacts/[id]/download`-Pfad proxen. (Der App-seitige Download prüft die Org bereits korrekt — nur die Speicher-Sichtbarkeit unterläuft das.)

### S2 — Race im Auto-Correction-Tageslimit (Mittel) · *per Hand am Code bestätigt*
**Ort:** `src/lib/loop/auto-correct.ts` (Entscheidung) + `src/lib/loop/correct.ts:163-177` (Audit-Write).
Die Bremse „max. `MAX_AUTO_CORRECTIONS_PER_DAY = 3` Auto-Starts pro Org/24h" zählt `loop.auto_correction_started`-Audit-Zeilen. Aber genau diese Audit-Zeile wird **erst später, in einer separaten Transaktion**, **nachdem** der Run gestartet ist, geschrieben. Der Zähler-Increment **läuft der Entscheidung also hinterher.** Zwei gleichzeitig entstehende Kriterien-Flags (möglich: Kriterien-Evaluierung läuft best-effort nach jedem Run-Commit, Runs können parallel fertig werden) lesen beide `used = 2 < 3` und starten beide → **4+ Starts, Kappe von 3 überschritten.**
Der Code-Kommentar behauptet, der Race könne „only ever UNDER-start" — das ist **in der Richtung falsch**: Weil der Increment dem Read nachläuft, ist der reale Fehler **Over-Starting**. Die Wirkung ist begrenzt (jeder über-gestartete Run läuft weiter durch das menschliche Approval-Gate; die Anti-Loop-Bremse verhindert Ketten), also **Kosten-/Limit-Integritäts-Bug, kein Privilege-Bypass** — aber die versprochene harte Grenze ist unterlaufen, und jeder Über-Start kann einen vollen generativen LLM-Call kosten.
*Kern des Fixes:* im selben Tx wie der Start zählen (Advisory-Lock / `SELECT … FOR UPDATE`) oder eine dedizierte Zähler-Zeile.
*Hinweis:* Dasselbe check-then-act existiert in den **weichen** Tageslimits (`src/lib/limits.ts`) — dort aber bewusst dokumentiert und als „weiches Limit" akzeptabel. Nur der Auto-Correction-Kommentar benennt die Konsequenz falsch.

### S3 — `app_user`-Rollenattribute außerhalb der Migrations-Kette (Mittel, Ops)
**Ort:** `docker/postgres/init/01-app-user.sql`, `scripts/setup-local-db.sh` — **nicht** in `prisma/migrations/`.
Das gesamte „DB erzwingt Isolation"-Versprechen ruht darauf, dass `app_user` `NOBYPASSRLS`, **kein** Superuser und **kein** Table-Owner ist (sonst greift FORCE RLS nicht). Die Migrations **granten** an `app_user`, **erschaffen** die Rolle aber nirgends und asserten diese Attribute nie. Auf Neon (Prod) ist das eine Provisionierungs-Annahme; zeigt man die App je auf eine Rolle mit `BYPASSRLS` oder Owner-Rechten, wird FORCE RLS **still** umgangen — ohne Migrations-Guard, der das fängt. (`.env.example` *behauptet* die Attribute im Kommentar; ein Kommentar ist keine Durchsetzung.)
*Kern des Fixes:* Deploy-Zeit-Assertion (Migration oder Startup-Check): verweigere den Deploy, wenn die verbundene Rolle `rolbypassrls`/`rolsuper` hat oder `app_user` irgendeine `public`-Tabelle besitzt.
*Verwandt:* In Local/Docker/CI ist der Owner (`ergane`) ein echter Superuser — Superuser umgehen auch FORCE RLS. Akzeptabel, **solange** die App ausschließlich als `app_user` verbindet und die Owner-URL nur DDL macht. Owner-Credential niemals in die App-Runtime-Umgebung.

### S4 — Fehlender HSTS-Header; CSP standardmäßig Report-Only (Niedrig)
- **Kein** `Strict-Transport-Security` irgendwo (`next.config.mjs`, `vercel.json`). Für eine B2B-App auf Vercel sollte HSTS gesetzt sein (z. B. `max-age=63072000; includeSubDomains; preload`).
- CSP ist standardmäßig `Content-Security-Policy-Report-Only` und schützt erst **aktiv**, wenn `CSP_ENFORCE=true` in Prod gesetzt ist. Der zweistufige Rollout ist Absicht — **in Prod verifizieren, dass umgelegt wurde.** (Ansonsten ist die CSP gut: Nonce + `strict-dynamic`, `object-src 'none'`, `frame-ancestors 'none'`, kein `'unsafe-inline'`/`'unsafe-eval'` für Skripte.)

### S5 — `CRON_SECRET` per `!==` (Niedrig)
**Ort:** `src/app/api/cron/loop/route.ts:21`, `src/app/api/cron/retention/route.ts:21`.
Die einzigen zwei nicht-konstantzeitigen Secret-Vergleiche im Repo (alle anderen nutzen `timingSafeEqual`). Ein Remote-Timing-Seitenkanal auf einem vollen String-`!==` ist praktisch kaum ausnutzbar (Netz-Jitter, V8-Stringvergleich) und die Wirkung ist gedeckelt (löst nur Flags aus / fährt den Retention-Sweep — keine Tenant-Daten zurück). Fail-closed-bei-fehlendem-Secret (503) ist bereits korrekt. Für Konsistenz auf Konstantzeit umstellen.

### S6 — Prompt-Injection nur instruktionsbasiert (Niedrig)
**Orte:** `src/lib/rag/answer.ts` (Chunk-Text + Dokumenttitel in die User-Message), `src/lib/skills/catalog/transkript_zu_framework.ts` (Transkript-Auszüge **und** frühere Deliverables).
Untrusted Tenant-Inhalt wird ohne Delimiter-Escaping in Prompts konkateniert; die einzige Trennung ist positionell (Instruktionen im `system`, Daten in der User-Turn) plus natürlichsprachliche Erdung („nur aus dem Kontext"). **Blast-Radius begrenzt:** Das Modell macht **keine** Tool-Calls und treibt **keine** Aktionen aus diesem Text (bestätigt: kein `JSON.parse` von Modell-Output; Korrekturen sind ein originalgetreuer Replay des gespeicherten Inputs, nicht modellgeneriert; Kriterien-Checks sind deterministische Regex/Zählung). Also **Content-Integrität**, kein Privilege-Bypass.
**Bemerkenswert:** Der Framework-Skill speist frühere, **freigegebene** Deliverables verbatim als vertrauenswürdige „Vorarbeit" zurück — ein Injection-Payload, der einmal das menschliche Approval übersteht, wird beim nächsten Lauf als vertrauter Kontext re-ingestiert (**Persistenz-Vektor**). Kompensierende Kontrolle: das menschliche Approval-Gate greift bei diesem Skill immer. *Härtung (optional):* `[]`/Fence-Marker in eingefügtem Inhalt neutralisieren; untrusted Spans explizit taggen; Vorarbeits-Feedback als untrusted behandeln.

### Weitere Sicherheits-Notizen (Info)
- **`loop_org_ids()`** (`0025`) gibt als `SECURITY DEFINER` an `app_user` **alle** Org-UUIDs ungefiltert zurück (by design für den Loop-Cron) — die eine tenant-übergreifende Enumerations-Primitive, die die App-Rolle erreichen kann. Nur opake UUIDs, keine Namen/PII. Wenn der Cron auf eine dedizierte Rolle wandern kann, `EXECUTE` darauf einschränken.
- **DPA/Subprocessor:** Tenant-Dokument-/Transkript-/PII-Text geht an Anthropic (US-First-Party-API) und Voyage (Embeddings); keine Redaktion — laut Code-Kommentaren beabsichtigt, Ziel ist „Claude via AWS Bedrock EU" für Datenresidenz, aber **im Code noch nicht realisiert** (nutzt aktuell `new Anthropic({ apiKey })`). Prüfen, dass eine Subprocessor-Offenlegung Anthropic + Voyage abdeckt.
- **3 `console.*`-Stellen** umgehen `maskSecrets` (Löschungs-Proof + zwei Ingest-Fehler-Logs) — keine Inhalte/PII-Bodies, aber ungemaskter stdout. Auf `logInfo`/`logError` umstellen.
- **`.env.example`-Doku-Lücke:** `CRON_SECRET` und `BLOB_READ_WRITE_TOKEN` werden im Code genutzt, sind aber nicht dokumentiert.

---

## 3. Performance-Befunde (Detail)

### P1 — `audit_log.action` nicht indiziert; jede Dashboard-Navigation filtert darauf (Hoch)
**Orte:** `src/app/dashboard/layout.tsx` (läuft bei **jeder** Navigation: `auditLog.count({ where: { action: { startsWith: 'flag.' }, … } })`), `src/app/dashboard/page.tsx` (Cockpit, zweimal), `src/lib/loop/tick.ts` + `src/lib/loop/auto-correct.ts` (Raw-SQL `WHERE action = … AND created_at > …` pro Metrik/Org, jeder Cron-Tick), `src/lib/audit.ts` (`queryAuditLog` für Audit-/Flags-Seite, je `findMany` **und** `count`).
Die einzigen `audit_log`-Indizes sind `(org_id, created_at DESC)` und `(org_id, actor_id, created_at DESC)`. Nichts indiziert `action`. Prismas `startsWith` kompiliert zu `action LIKE 'flag.%'`; der Planner nutzt den Zeit-Index fürs Fenster, aber das `action LIKE` ist ein ungefilterter Scan über alle Zeilen im Fenster. `audit_log` ist append-only und wird **nie** geprunt → der Scan wächst unbegrenzt.
*Kern des Fixes:* `CREATE INDEX ON audit_log (org_id, action text_pattern_ops, created_at DESC)` — `text_pattern_ops` macht `LIKE 'prefix%'` zum Index-Range-Scan. Deckt Layout-Badge, Cockpit-Flag-Panel, Audit-/Flags-Filter und die Cron-Dedup-Queries auf einmal.

### P2 — Serverless-Connection-Pool nicht konfiguriert (Hoch, Ops)
**Orte:** `src/lib/prisma.ts` (nackter `new PrismaClient()`, kein `connection_limit`, kein Pool-Adapter), `.env.example` (`DATABASE_URL` direkt auf Postgres, kein Pooler), `vercel.json` (deployt auf Vercel).
Auf Vercel hält jede gleichzeitig laufende Function-Instanz ihren eigenen Prisma-Pool. Kombiniert damit, dass **jede** Tenant-DB-Operation eine **interaktive** Transaktion (`withTenant`) ist, die eine Verbindung für ihre volle Dauer pinnt (inkl., für P3, eines Embedding-HTTP-Roundtrips) — das ist das Lehrbuch-Szenario **serverless + interaktive Transaktionen + kein externer Pooler = Connection-Exhaustion.** Unter Last kann `(Instanzen) × (Pool)` `max_connections` sprengen.
*Kern des Fixes (Reihenfolge):* (1) Transaction-Mode-Pooler davor (Neon Pooled Endpoint / PgBouncer / Prisma Accelerate) + `?pgbouncer=true` — der Code dokumentiert bereits, dass `withTenant` unter Transaction-Pooling korrekt ist (GUC ist `set_config(..., is_local:=true)`, transaktions-scoped); (2) explizites `connection_limit` auf `DATABASE_URL`; (3) P3 fixen, damit Transaktionen nicht über Netz-Latenz offen gehalten werden. Die Isolation selbst ist unter Pooling sauber — die Lücke ist rein operative Config.

### P3 — Embedding-Call innerhalb `withTenant` in `holeWissen` (Mittel)
**Ort:** `src/lib/skills/catalog/wissen.ts:66` (`embedder.embed(...)` + `tx.$queryRaw` auf **derselben** Step-Transaktion), aufgerufen aus den `run()`-Hooks von `wissen_zusammenfassen.ts` und `transkript_zu_framework.ts` (Step `transkript_kontext`).
Die einzige Stelle, die die Regel „kein Netz-Call in `withTenant`" bewusst bricht. Mit dem Fake-Provider (Tests/Demo) instant; mit **echtem Voyage** in Prod passiert ein HTTP-Roundtrip, **während** die interaktive Transaktion (und ihre gepinnte Verbindung) offen ist — zählt gegen das 15s-Timeout und belegt eine Pool-Verbindung für die volle Embedding-Latenz. Der Code-Kommentar (`wissen.ts:19-23`) benennt den Trade-off explizit (Atomarität des Steps).
*Kern des Fixes:* den `embed()`-Call in den `prepare()`-Hook des Steps hochziehen (läuft vor der Transaktion, kein `tx`) und den Query-Vektor via `ctx.prepared` in `run()` reichen — dann läuft nur noch das `$queryRaw` (der eigentliche Tenant-Read) in der Transaktion. Genau das Muster nutzen `answerQuestion` und der Chat-/LLM-Call des Framework-Skills bereits korrekt.

### P4 — `force-dynamic` überall ohne Data-Cache + Write im Layout (Niedrig-Mittel)
Jede Dashboard-Route ist `dynamic = 'force-dynamic'`, es gibt **kein** Data-Caching (`unstable_cache`/`'use cache'`/React `cache()`/`revalidate` — nichts). Jede Navigation trifft Postgres neu. Für ein session-scoped, live-Badge, tenant-privates Dashboard ist das ein vertretbarer Default (statisch nicht cachebar), und `experimental.staleTimes.dynamic: 30` mildert Rück/Vor-Navigation über den Client-Router-Cache. Aber: das Layout läuft bei jeder Navigation und macht (1) `ensureOrgAndMembership` — einen Clerk-Mirror-**Upsert (= Write-Transaktion) pro Seitenaufruf**, (2) den Pending-Approvals-`count`, (3) den nicht-indizierten `flag.`-`count` (P1). Der Write-on-every-render ist idempotent, aber eine Write-Transaktion pro Navigation — überprüfenswert (z. B. seltener/konditional spiegeln).

### P5 — Latente Punkte, bei aktuellem Volumen unkritisch (Niedrig)
- **`approvals`-„decided"-Liste** sortiert nach nicht-indiziertem `decided_at` (`src/app/dashboard/approvals/page.tsx`) → Index-Scan auf `status` + In-Memory-Sort. Optionaler Index `(org_id, status, decided_at DESC)`.
- **`skill_runs`-Aggregationen in JS** (`src/lib/value.ts`, `src/lib/loop/metrics.ts`) — In-Memory-GROUP-BY, das der Value-Dashboard bei jedem Load und jeder Loop-Tick neu rechnet. Bei wachsenden Run-Volumina in SQL-`GROUP BY`/`count` verschieben.
- **Cron-Sweeps sind O(Tenants) sequentielle Transaktionen** (`tick.ts`, `lifecycle/index.ts`) — off-request um 3/4 Uhr, per Design (RLS-Isolation, ein Fehler stoppt die anderen nicht), aber lineare Wall-Time mit wachsender Tenant-Zahl → irgendwann Batching/Concurrency-Limit.

---

## 4. Verweise auf Code-Stellen (Schnellindex)

| Befund | Primäre Datei(en) |
|--------|-------------------|
| S1 Public Blobs | `src/lib/storage/blob.ts` |
| S2 Auto-Correction-Race | `src/lib/loop/auto-correct.ts`, `src/lib/loop/correct.ts:163-177` |
| S3 Rollenattribute | `docker/postgres/init/01-app-user.sql`, `scripts/setup-local-db.sh`, `prisma/migrations/0001_init/migration.sql` |
| S4 HSTS/CSP | `next.config.mjs`, `vercel.json`, `src/lib/csp.ts` |
| S5 CRON_SECRET | `src/app/api/cron/{loop,retention}/route.ts:21` |
| S6 Prompt-Injection | `src/lib/rag/answer.ts`, `src/lib/skills/catalog/transkript_zu_framework.ts` |
| P1 audit_log.action | `src/app/dashboard/layout.tsx`, `src/lib/audit.ts`, `src/app/dashboard/page.tsx` |
| P2 Connection-Pool | `src/lib/prisma.ts`, `.env.example`, `src/lib/tenant.ts` |
| P3 Embedding in Tx | `src/lib/skills/catalog/wissen.ts:66` |

---

*Read-only-Audit — es wurden keine Quell- oder Konfigurationsdateien geändert.*
