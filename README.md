# ergane

A **GDPR-native, multi-tenant (B2B) foundation**. Phase 0–1 built the
tenant-first fundament: tenancy, auth/orgs, RBAC, an append-only audit log, and
the isolation test gate that guards them. **Phase 2** adds the first feature on
top of it: a tenant-isolated **knowledge base with semantic search and a RAG
chat that answers with sources** — see
[Knowledge base + RAG chat](#knowledge-base--rag-chat-phase-2).

> **The one idea that matters:** tenant separation is enforced by the
> **database** (PostgreSQL Row-Level Security with `FORCE`), **not** by
> application-code discipline. Even a buggy query, a forgotten `WHERE org_id = …`,
> or a confused-deputy bug **cannot** leak another tenant's data, because the
> application connects as a role that is physically incapable of seeing rows
> outside its current tenant context.

---

## Table of contents

- [Architecture in one screen](#architecture-in-one-screen)
- [How tenant separation is enforced](#how-tenant-separation-is-enforced)
- [The `withTenant` pattern](#the-withtenant-pattern)
- [Data model](#data-model)
- [Getting started](#getting-started)
  - [Option A — Docker (canonical)](#option-a--docker-canonical)
  - [Option B — local Postgres without Docker](#option-b--local-postgres-without-docker)
- [The isolation test gate](#the-isolation-test-gate-pnpm-test)
- [Knowledge base + RAG chat (Phase 2)](#knowledge-base--rag-chat-phase-2)
- [Skill engine: Guardrail → Freigabe → Audit (Phase 3)](#skill-engine-guardrail--freigabe--audit-phase-3)
- [Governance-Policies (Phase 4)](#governance-policies-phase-4)
- [Settings-Oberfläche (Admin-Governance-UI)](#settings-oberfläche-admin-governance-ui)
- [Slack als zweiter Eingang (Phase 6)](#slack-als-zweiter-eingang-phase-6)
  - [Slack: ack-then-work & Idempotenz](#slack-ack-then-work--idempotenz)
  - [Slack lokal testen](#slack-lokal-testen)
- [Lebenszyklus & DSGVO (Phase 7)](#lebenszyklus--dsgvo-phase-7)
- [Clerk-Synchronisation (Phase 8)](#clerk-synchronisation-phase-8)
- [Slack produktionsreif (Phase 9)](#slack-produktionsreif-phase-9)
- [RAG v2: Multi-Turn & Dokument-Versionen (Phase 10)](#rag-v2-multi-turn--dokument-versionen-phase-10)
- [Echte Skill-Effekte (Phase 11)](#echte-skill-effekte-phase-11)
- [Betrieb: Logging, Audit-UI, Deployment (Phase 12)](#betrieb-logging-audit-ui-deployment-phase-12)
- [OCR für gescannte PDFs (Phase 17)](#ocr-für-gescannte-pdfs-phase-17)
- [✅ Checklist: adding a new tenant table](#-checklist-adding-a-new-tenant-table-the-most-important-section)
- [Design decisions & trade-offs](#design-decisions--trade-offs)
- [Project layout](#project-layout)

---

## Architecture in one screen

```
Browser ──▶ Clerk (auth + Organizations + RBAC)
              │  verified session carries the active orgId
              ▼
        Next.js 15 middleware ── no user → sign-in · no org → /select-org
              │
              ▼
        Server Component / Server Action
              │  orgId is read ONLY from the verified Clerk session
              ▼
        withTenant(orgId, tx => …)              ┌─────────────────────────────┐
              │  opens an interactive tx and    │ PostgreSQL                  │
              │  SELECT set_config('app.current_org', orgId, local:=true)     │
              ▼                                  │                             │
        Prisma Client  ──── connects as ──────▶ │  role app_user              │
                              app_user           │   NOSUPERUSER / NOBYPASSRLS │
                                                 │   not a table owner         │
                                                 │                             │
                                                 │  RLS ENABLE + FORCE on every│
                                                 │  tenant table:              │
                                                 │   USING/​WITH CHECK          │
                                                 │   org_id = NULLIF(          │
                                                 │     current_setting(        │
                                                 │     'app.current_org'),'')  │
                                                 │     ::uuid                  │
                                                 └─────────────────────────────┘
```

Two database connections, two privilege levels:

| Connection            | Role        | Privileges                              | Used by                              |
| --------------------- | ----------- | --------------------------------------- | ------------------------------------ |
| `DATABASE_URL`        | `app_user`  | least-privilege, **NOBYPASSRLS**, not owner | the app, Prisma Client, the tests |
| `DIRECT_DATABASE_URL` | owner       | full (migrations/DDL)                   | `prisma migrate`, test reset only    |

---

## How tenant separation is enforced

Four independent layers. Each one alone blocks a cross-tenant leak; together they
are defense-in-depth.

1. **A powerless application role.** The app connects only as `app_user`, created
   with `NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE` and **never** owning a
   table. Superusers and `BYPASSRLS` roles skip RLS — `app_user` is neither, so it
   is fully subject to every policy. (See `docker/postgres/init/01-app-user.sql`.)

2. **RLS `ENABLE` + `FORCE` on every tenant table.** `FORCE` makes the policy
   apply even to the table owner, so nobody short of a superuser can sidestep it.
   The policy predicate is everywhere:

   ```sql
   org_id = NULLIF(current_setting('app.current_org', true), '')::uuid
   ```

   `current_setting(…, true)` returns `NULL` when the GUC was never set, but a
   transaction-local `set_config()` *resets* it to an empty string `''` (not
   NULL) when the transaction ends — and `''::uuid` would raise an error.
   `NULLIF(…, '')` collapses both cases to `NULL`, so `org_id = NULL` → `NULL`
   → the row is filtered out. **No context ⇒ zero rows, deterministically.** It
   fails *closed* — never a leak, never an error. (See
   `prisma/migrations/0001_init/migration.sql`. This exact edge case is covered
   by Test 4 in the gate.)

3. **A per-request tenant context, set safely.** `withTenant()` opens an
   interactive transaction and binds the org as its first statement using
   `set_config('app.current_org', $orgId, true)`. The `true` makes it
   transaction-local (auto-cleared at COMMIT/ROLLBACK; never leaks across pooled
   connections). The value is a **bind parameter** (not string-interpolated) and
   is validated as a strict UUID first — no injection surface.

4. **The orgId comes only from the verified session.** `requireTenant()` reads
   `auth().orgId` from Clerk and maps it to our internal UUID server-side. It is
   **never** taken from a request body or query parameter. Mutations additionally
   set `org_id` explicitly and assert it (belt-and-suspenders on top of RLS).

Plus the audit log is **append-only**: it has `SELECT`/`INSERT` policies but no
`UPDATE`/`DELETE` policy (denied under `FORCE`), `app_user` lacks the
`UPDATE`/`DELETE` privilege, **and** a trigger raises on any `UPDATE`/`DELETE`.

---

## The `withTenant` pattern

`src/lib/tenant.ts` — the **only** sanctioned way to touch tenant data:

```ts
export async function withTenant<T>(orgId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  if (!orgId) throw new Error('withTenant: refusing to run a tenant query without an org context.');
  if (!isUuid(orgId)) throw new Error(`withTenant: orgId must be a valid UUID, received: ${JSON.stringify(orgId)}`);

  return prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT set_config('app.current_org', ${orgId}, true)`; // first statement
    return fn(tx);
  }, { timeout: 15_000 });
}
```

**Rules of the road:**

- ✅ Read/write tenant data **only** inside `withTenant(orgId, tx => …)`.
- ✅ Get `orgId` **only** from `requireTenant()` (the verified Clerk session).
- ❌ Never run a tenant query on the bare `prisma` client — it has no context and
  returns nothing by design (and if it ever returned rows, that's a bug the gate
  catches).
- ❌ Never accept `orgId` from the client.

```ts
// In a Server Component or Server Action:
const { orgId, userId } = await requireTenant();
const items = await withTenant(orgId, (tx) =>
  tx.knowledgeItem.findMany({ orderBy: { createdAt: 'desc' } }),
);
```

---

## Data model

| Table             | Tenant-scoped?   | RLS         | Notes                                                |
| ----------------- | ---------------- | ----------- | ---------------------------------------------------- |
| `organizations`   | **yes** (root)   | ENABLE+FORCE| self-row policy keyed on `id`; internal `id` (uuid) + unique `clerk_org_id` + `name` |
| `memberships`     | **yes**          | ENABLE+FORCE| `(org_id, user_id)` unique, `role` ∈ owner/admin/member |
| `knowledge_items` | **yes**          | ENABLE+FORCE| the example tenant table                             |
| `audit_log`       | **yes**          | ENABLE+FORCE| append-only (policy + privilege + trigger)           |
| `documents`       | **yes**          | ENABLE+FORCE| knowledge-base documents (`source` ∈ upload/manual/transcript) |
| `chunks`          | **yes**          | ENABLE+FORCE| embedded text chunks, `embedding vector(1024)` (pgvector) + HNSW index; composite FK `(document_id, org_id)` → same-tenant document only |
| `chat_messages`   | **yes**          | ENABLE+FORCE| RAG chat history (`role` ∈ user/assistant)          |
| `skill_runs`      | **yes**          | ENABLE+FORCE| one skill execution: `status` ∈ running/awaiting_approval/approved/rejected/completed/failed, `input`/`result` jsonb |
| `skill_steps`     | **yes**          | ENABLE+FORCE| executed steps of a run; composite FK `(run_id, org_id)` → same-tenant run only |
| `approvals`       | **yes**          | ENABLE+FORCE| human approval gate (`reason`, `required_role`, `decided_by`, `decided_at`); composite FK `(run_id, org_id)` |
| `approval_policies` | **yes**        | ENABLE+FORCE| per-skill approval config (`mode` ∈ always/threshold/never, `threshold_amount`, `approver_role`); unique `(org_id, skill_key)` |
| `visibility_grants` | **yes**        | ENABLE+FORCE| which role sees which visibility level; unique `(org_id, level, role)`, level ≠ open |

Every table except `organizations` has `org_id UUID NOT NULL` with a foreign key
to `organizations(id)`. `organizations` is the tenant root, so its own RLS policy
keys on `id` (which *is* the tenant key) instead of `org_id`.

---

## Getting started

Prerequisites: **Node ≥ 20**, **pnpm**, and a **Clerk** application with
**Organizations enabled** (for the web app; the test gate needs no Clerk).

```bash
cp .env.example .env          # then paste your Clerk keys into .env
pnpm install
```

### Option A — Docker (canonical)

```bash
pnpm db:up                    # starts Postgres; init SQL creates app_user
pnpm db:migrate               # prisma migrate deploy (as owner) → tables, RLS, grants
pnpm db:seed                  # optional: two demo tenants to look at
pnpm dev                      # http://localhost:3000
pnpm test                     # the isolation gate
```

`pnpm db:up` runs `docker/postgres/init/01-app-user.sql` automatically on first
boot, so `app_user` exists before migrations grant it privileges.

### Option B — local Postgres without Docker

If you can't run Docker, any local Postgres 16 works. Create the database, the
owner role `ergane`, and `app_user`, then migrate. A helper script is provided:

```bash
./scripts/setup-local-db.sh   # creates the cluster + roles using DIRECT_DATABASE_URL
pnpm db:migrate
pnpm test
```

(The script is idempotent and only used for local dev/verification; Docker is the
documented canonical path.)

---

## The isolation test gate (`pnpm test`)

`tests/isolation.test.ts` runs **as `app_user`** — the same role the app uses —
so it tests the real enforcement. It **must stay green**; CI fails if it doesn't.

| #   | What it proves                                                                 |
| --- | ------------------------------------------------------------------------------ |
| 1   | `withTenant(A)` sees only A's items, never B's.                                |
| 2   | As A, reading/updating B's row by id returns nothing / affects 0 rows.         |
| 3   | Inserting a row with a foreign `org_id` is rejected by `WITH CHECK`.           |
| 4   | A query with **no** tenant context returns **no** rows (fails closed).         |
| 5   | `app_user` cannot bypass RLS: not superuser, no `BYPASSRLS`, not owner; cannot disable RLS; cannot delete audit rows. |

Beyond the canonical 5, the suite adds **regression guards** (hardening added
after an adversarial security review) so the gate can't silently weaken:

- asserts `ENABLE` **and** `FORCE` RLS are on for all four tenant tables (a dropped
  `FORCE` is invisible to app_user-only tests otherwise);
- proves an `UPDATE` cannot **move** a row to another tenant (WITH CHECK on UPDATE);
- positively checks cross-tenant **reads** for `memberships`, `audit_log`, and the
  self-row `organizations` policy (not just the empty-context case);
- proves the append-only `audit_log` **trigger** holds independently of RLS (via a
  superuser connection that bypasses RLS but still hits the trigger);
- asserts `app_user` lacks escalation privileges (`DELETE` org / `TRUNCATE` /
  `_prisma_migrations`);
- proves the tenant GUC **does not leak across transactions** on a reused
  connection (tests pin a single connection to make this meaningful);
- a `beforeAll` precondition refuses to run unless connected as the powerless
  `app_user` — so a misconfigured role fails loudly instead of passing falsely.

Run it: `pnpm test`. It also runs in CI (`.github/workflows/ci.yml`) against a
real Postgres service container.

**Phase 2 additions** (`tests/rag-isolation.test.ts`, same rules: runs as
`app_user`, deterministic fake AI providers, zero network calls in CI):

- RLS ENABLE **and** FORCE asserted for `documents`, `chunks`, `chat_messages`;
- tenant A never reads B's documents/chunks/chat history — **including through
  the vector similarity query**: a retrieval query that matches B's content
  *verbatim* still returns none of B's chunks (with a positive control that B
  itself finds them at ~1.0 similarity);
- `INSERT` with a foreign `org_id` fails `WITH CHECK` on all three tables
  (including a raw chunk insert with an embedding);
- with **no** tenant context, plain and vector queries return **0 rows**;
- the RAG flow end-to-end: grounded answer **with source titles**, the honest
  "no verified knowledge" answer when nothing relevant exists, chat history
  persisted, and `knowledge.ingested` / `chat.answered` audit entries written.

---

## Knowledge base + RAG chat (Phase 2)

Wissen wird pro Tenant gespeichert, semantisch durchsuchbar gemacht und im Chat
**mit Quellenangabe** beantwortet. Alles läuft durch dieselben Isolations-Bahnen
wie Phase 0–1: jede neue Tabelle hat `org_id NOT NULL` + FK, RLS ENABLE+FORCE,
die Standard-Policy auf `app.current_org`, und **jeder** Zugriff geht durch
`withTenant()`.

### Ingestion (`src/lib/rag/ingest.ts`)

```
ingestDocument({orgId, actorId, title, source, text})
  1. chunkText()      — paragraph-aware sliding window (1200 chars, 200 overlap)
  2. embedder.embed() — via the provider abstraction, OUTSIDE any transaction
  3. ONE withTenant(orgId) transaction:
       documents row  +  all chunks rows (raw SQL — pgvector column)
       + logAudit('agent', 'knowledge.ingested', title)
```

The `chunks.embedding` column is `vector(1024)` (pgvector). Prisma cannot
express that type (`Unsupported` in the schema), so chunk inserts and
similarity queries are tagged-template raw SQL **inside `withTenant()`** — same
tenant guarantees, RLS applies identically. `org_id` is always set explicitly
on top (defense-in-depth), and a **composite FK `(document_id, org_id)`** makes
a chunk structurally incapable of pointing at another tenant's document.

### Datei-Ingestion: PDF, DOCX, MD, TXT (Phase 5)

Uploads laufen durch **einen** Extraktions-Layer (`src/lib/ingest/extract.ts`):
`extractText(file) → { text, meta }`. Der extrahierte Text geht danach
unverändert durch die **bestehende** `ingestDocument()`-Pipeline — keine
Parallel-Pipeline. Die Meta-Daten (`source_format`, `page_count`, `word_count`,
Migration 0005, rein additiv) landen auf der `documents`-Zeile und werden in
der UI als Format-Badge angezeigt.

| Format | Parser  | Anmerkungen |
| ------ | ------- | ----------- |
| `.pdf` | unpdf   | Nur Text-PDFs; liefert Seitenzahl |
| `.docx`| mammoth | Überschriften bleiben als eigene Absätze erhalten |
| `.md`  | direkt  | Markdown-Dekoration leicht bereinigt; Code-Fences bleiben wörtlich erhalten |
| `.txt` | direkt  | — |

**Defensiv & fail-closed:**

- **20 MB Limit** pro Datei; MIME-Typ **und** Datei-Endung müssen zusammenpassen.
- **Gescannte PDFs ohne Textebene werden abgelehnt** („OCR kommt später") —
  es gibt keinen stillen Leer-Import; ohne extrahierbaren Text wird **kein**
  Dokument angelegt (Extraktion läuft vor jedem Write).
- Beim Multi-Upload (Drag & Drop in `/dashboard/knowledge`) wird **jede Datei
  einzeln** ingestiert und gemeldet (Chunks erzeugt / Fehler mit Grund) — eine
  kaputte Datei bricht nie den ganzen Batch ab.

**Bekannte Grenzen:** kein OCR (Scan-PDFs), keine Bilder/Tabellen-Extraktion,
20 MB pro Datei. Demo: `pnpm demo:ingest` ingestiert je eine Beispieldatei pro
Format aus `fixtures/` und beantwortet eine Frage mit Quelle aus dem PDF.

### Retrieval (`src/lib/rag/retrieve.ts`)

`retrieve({orgId, query, k})` embeds the query (`input_type: 'query'`), then
runs cosine top-k (`embedding <=> $vec`) **inside `withTenant()`** with an
additional explicit `WHERE c.org_id = $orgId`. Results carry the chunk content
**and the document title — the source**. The HNSW index
(`chunks_embedding_hnsw_idx`, `vector_cosine_ops`) accelerates this; RLS + the
org filter are applied on top of the index scan (pgvector ≥ 0.8 iterative
scans keep filtered ANN correct).

### Answering (`src/lib/rag/answer.ts`)

`answerQuestion({orgId, actorId, question})`:

1. retrieve top-k chunks; drop everything below the **embedder's**
   `relevanceThreshold` (similarity distributions are model-specific, so the
   threshold lives on the provider, not in the RAG layer);
2. **nothing relevant → no LLM call at all**: the fixed, honest answer
   *„Dazu habe ich kein geprüftes Wissen in der Wissensbasis."* with zero
   sources — hallucination is prevented structurally, and the system prompt
   repeats the rule for the LLM path;
3. otherwise the LLM gets ONLY the retrieved passages (each prefixed with its
   `[document title]`) and must answer from them; sources = the used titles;
4. user + assistant messages land in `chat_messages` and
   `logAudit('agent', 'chat.answered', …)` in **one** `withTenant` transaction
   after the answer exists (LLM calls never run inside an open DB transaction).

UI: `/dashboard/knowledge` (list + ingest form + optional `.txt` upload, read
server-side) and `/dashboard/chat` (history + question form; sources rendered
under each answer). Both use `requireTenant()` + `ensureOrgAndMembership()`.

### Provider abstraction (`src/lib/ai/`)

LLM and embeddings are consumed ONLY through two interfaces:

```ts
interface EmbeddingProvider { dimensions; relevanceThreshold; embed(texts, inputType) }
interface ChatProvider      { complete({system, messages, maxTokens}) }
```

| Adapter | Provider | Selected when |
| ------- | -------- | ------------- |
| `anthropic.ts` | Anthropic Messages API, `claude-opus-4-8` (override: `ANTHROPIC_MODEL`) | `ANTHROPIC_API_KEY` set |
| `voyage.ts` | Voyage AI `voyage-3.5`, 1024 dims (Anthropic's embeddings partner — Anthropic has no embeddings endpoint) | `VOYAGE_API_KEY` set |
| `fake.ts` | deterministic, offline (hashed bag-of-words embedder + context-echo chat) | no key, **non-production only** — production throws instead of silently faking |

`src/lib/ai/index.ts` is the **only** place that decides the vendor. Routes,
server actions and `lib/rag` never import a vendor SDK.

**Switching the LLM to Claude on AWS Bedrock (EU) later:**

1. `pnpm add @anthropic-ai/bedrock-sdk` and write `src/lib/ai/bedrock.ts`
   implementing `ChatProvider` (constructor takes the AWS region, e.g.
   `eu-central-1`, and resolves AWS credentials; model id becomes the Bedrock
   EU model id, e.g. `eu.anthropic.claude-…`).
2. Select it in `getChatProvider()` (e.g. keyed on `AI_CHAT_PROVIDER=bedrock`).
3. Nothing else changes — prompts, RAG, UI, tests are provider-agnostic.
   Embeddings stay on the `EmbeddingProvider` interface the same way; if the
   embedding model's dimensionality changes, that requires a migration
   (`vector(N)` is fixed in the schema) and re-ingestion.

### pgvector

- **Docker/CI (canonical):** the `pgvector/pgvector:pg16` image ships the
  extension; the migration runs `CREATE EXTENSION IF NOT EXISTS vector` as
  owner.
- **Local without Docker:** `scripts/setup-local-db.sh` builds pgvector v0.8.4
  from source against the Homebrew `postgresql@16` keg when it is missing
  (idempotent).

### Demo without Clerk (`pnpm demo:rag`)

Clerk is integrated but **not configured** in this phase (placeholder keys, no
auth bypass added — middleware and session path are untouched). The Definition
of Done is therefore proven by `scripts/demo-rag.ts`, which drives the full
pipeline through the exact same code paths as the UI (`withTenant` →
`ingestDocument` → `answerQuestion`): it creates a demo org (seed pattern),
ingests a sample document, asks one answerable question (must return the answer
**with sources**) and one unanswerable question (must return the honest
no-knowledge answer), and prints the audit trail. Without API keys it uses the
deterministic fake providers; with `ANTHROPIC_API_KEY`/`VOYAGE_API_KEY` set it
uses the real ones.

### Decisions taken on ambiguity (safer option)

- **GRANTs are minimal:** `app_user` gets `SELECT, INSERT` only on the three
  new tables — no feature needs UPDATE/DELETE yet; grant when one appears.
- **`chat_messages` keeps the spec-fixed shape** (no sources column). Sources
  survive reloads via the **canonical sources format**: every grounded answer
  ends with exactly one line `Quellen: <Titel1>, <Titel2>, …`, appended
  deterministically by the RAG layer (`SOURCES_MARKER` in
  `src/lib/rag/answer.ts`) — never by the LLM (the prompt forbids it, and any
  model-emitted `Quellen:` line is stripped). The honest no-knowledge answer
  has NO sources line. The chat UI parses the line back into a list; future
  consumers (e.g. the skill engine) can rely on exactly this format.
- **Embedding dimensionality is a constant** (`vector(1024)` = voyage-3.5;
  the fake embedder matches). A different model size = new migration, on
  purpose — silently mixing dimensionalities in one column is not possible.
- **Relevance threshold is per embedding provider** (fake: 0.05 — bag-of-words
  cosine runs low; voyage: 0.45), so the honest "no knowledge" answer behaves
  sensibly with either.

---

## Skill engine: Guardrail → Freigabe → Audit (Phase 3)

Der Mechanismus, der ergane vom Chatbot zum Company Orchestrator macht:
**ausführbare Skills** mit Leitplanke, menschlicher Freigabe und lückenlosem
Audit. Erster Skill end-to-end: `beleg_kontieren`.

### Skill-Format (`src/lib/skills/types.ts`)

Ein Skill ist **Daten, kein Code-Sonderfall**:

```ts
{ key, title, handlesMoney: boolean, guardrail?: (input) => {triggered, reason?}, steps: StepDef[] }
// StepDef: { name, acts?: boolean, run: (ctx) => Promise<detail> }
```

- `ctx` enthält den **tenant-gebundenen `tx`** (aus `withTenant`), das `input`
  und den bisherigen State (Details der abgeschlossenen Steps).
- **„liest nur" vs. „handelt":** `acts: false` (Default) = Step liest/leitet nur
  ab. `acts: true` = Step hat (ggf. simulierte) Außenwirkung und wird durch die
  Guardrail-Mechanik gated. `handlesMoney: true` markiert den ganzen Skill:
  handelnde Steps ohne Guardrail **failen closed** (immer Freigabe nötig).

### Ausführung (`src/lib/skills/engine.ts`)

```
startRun(orgId, key, input)   running ──(Steps, je 1 withTenant-Tx)──▶ completed
                                 │  handelnder Step + Guardrail triggered
                                 ▼
                          awaiting_approval  ← NICHTS handelt, solange pausiert
                           │            │
                 approve() │            │ reject()
                           ▼            ▼
                        approved      rejected (handelnder Step lief NIE)
                           └─(restliche Steps)──▶ completed
```

- Jeder Step ist **atomar**: Step-Effekt + `skill_steps`-Zeile + Audit-Eintrag
  in einer Transaktion. Ohne Tenant-Kontext: null Wirkung (RLS, fail-closed).
- Audit-Kette pro Run (append-only, `audit_log`): `skill.started` →
  `skill.step_completed`… → ggf. `guardrail.triggered` →
  `approval.approved|rejected` (actor_type **human**, `decided_by`) →
  `skill.completed|failed`. Engine-Aktionen sind actor_type **agent**.
- **Vier-Augen-Mechanik:** `approvals` trägt `reason`, `decided_by`,
  `decided_at`; ein Run, dessen Guardrail griff, erreicht `completed` nur über
  `approve()` durch einen Menschen.

### Der erste Skill: `beleg_kontieren`

`beleg_gelesen → konto_vorgeschlagen → buchung_vorbereitet → verbucht (acts)`.
Kontovorschlag ist eine deterministische SKR03-Regeltabelle (offline; später
durch RAG über die Wissensbasis ersetzbar, ohne die Engine anzufassen).
Guardrail: **Betrag > 1.000 € → „Freigabe erforderlich"**. Der
`verbucht`-Schritt ist ein simulierter Effekt (keine echte DATEV-Anbindung) —
genug für den End-to-End-Beweis.

Demo ohne Auth/HTTP: **`pnpm demo:skill`** zeigt 240 € (glatt durch), 1.240 €
mit `approve()` (pausiert → completed) und 1.240 € mit `reject()` (rejected,
nie verbucht) inkl. Audit-Kette. Tests: `tests/skill-isolation.test.ts` ist
Teil des CI-Gates (Isolation inkl. zusammengesetzter FKs, Guardrail-Semantik,
approve/reject, Vier-Augen-Sanity).

### Skill-Katalog: ein Motor, vier Skills

Jeder Skill ist reine Daten im `SkillDef`-Format — die Engine kennt keine
Sonderpfade. Der Katalog (`src/lib/skills/catalog/`) zeigt die drei
Freigabe-Archetypen:

| Skill | Typ | Freigabe (ohne Policy) | Warum |
| ----- | --- | ---------------------- | ----- |
| `wissen_zusammenfassen` | **liest nur** (alle Steps `acts:false`, `handlesMoney:false`) | **nie** — läuft immer direkt bis `completed` | keine Wirkung nach außen |
| `angebot_erstellen` | handelt (Versand simuliert) | **immer**, unabhängig vom Betrag | Guardrail triggert auf **externe Kommunikation** — ein Angebot verlässt das Unternehmen; `handlesMoney:false` |
| `rechnung_erstellen` | handelt, Geld (`handlesMoney:true`) | **ab Rechnungssumme > 1.000 €** | Betrag-Guardrail wie `beleg_kontieren`; `amountOf` liefert die Summe für Threshold-Policies |
| `beleg_kontieren` | handelt, Geld (`handlesMoney:true`) | **ab Betrag > 1.000 €** | s. o. — der erste Skill |

**Wissens-Retrieval in Steps** (`catalog/wissen.ts`): Skills, die Wissen
brauchen (`wissen_zusammenfassen`, `angebot_erstellen`), fragen die
Wissensbasis **rollenbewusst** ab — mit der Rolle des Auslösers, die die
UI-Action serverseitig aus der verifizierten Session in den Input spiegelt
(nie vom Client). Es gilt exakt der Disclosure-Filter von `retrieve()`
(fail-closed: keine/unbekannte Rolle ⇒ nur `open`; kein sichtbares Wissen ⇒
die ehrliche Kein-Wissen-Antwort ohne Leak, Quellen im kanonischen
`Quellen: …`-Format). Technische Fußnote: Steps laufen INNERHALB der
withTenant-Transaktion der Engine, `retrieve()` öffnet eine eigene —
verschachtelt blockiert das den Connection-Pool. `holeWissen()` führt deshalb
dieselbe Abfrage (identisches WHERE-Prädikat, dokumentiert als Spiegel) auf
der Step-Transaktion aus.

Tests: `tests/skill-catalog.test.ts` (read-only pausiert nie + Disclosure ohne
Leak; Angebot pausiert immer, auch bei 1 €; Rechnung unter/über der Schwelle;
widersprüchliche Summe ⇒ `failed` vor jedem Effekt) ist Teil des CI-Gates.

---

## Governance-Policies (Phase 4)

Firmen konfigurieren selbst, **(A)** wann Skills menschliche Freigabe brauchen
(`approval_policies`) und **(B)** welches Wissen für welche Rolle sichtbar ist
(`documents.visibility` + `visibility_grants`).

**Zwei Ebenen, nie vermischt:**

| Ebene | Was | Durchgesetzt von |
| ----- | --- | ---------------- |
| 1 — Boden | Mandantentrennung (RLS + FORCE, withTenant) | **Postgres**, nicht konfigurierbar |
| 2 — Policies | Freigabe-Regeln + Wissens-Sichtbarkeit **innerhalb** eines Tenants | Engine/Retrieval, pro Tenant konfigurierbar |

Kein Policy-Wert kann cross-tenant etwas öffnen: Policies werden selbst nur
durch `withTenant()` gelesen — Tenant B's Policies existieren für Tenant A
schlicht nicht (getestet).

### Rollen (Minimal-RBAC)

`memberships.role` ∈ `owner | admin | lead | member` (Default `member`).
Rollen kommen derzeit aus Seed/Demo. **Clerk-Mapping-Pfad (später):** Clerk
Custom Roles `org:admin` / `org:lead` / `org:member` anlegen und
`mapClerkRole()` in `src/lib/auth-context.ts` um `'org:lead' → 'lead'`
erweitern — die Rolle fließt dann pro Request aus der verifizierten Session in
`requireTenant()` und von dort in Retrieval/Approvals. `owner` bleibt manuelle
Elevation und zählt in allen Policy-Prüfungen wie `admin`.

### Approval-Policies (konfigurierbares Human-in-the-Loop)

`setApprovalPolicy()` (nur admin) legt pro Skill fest: `mode` ∈
`always | threshold | never`, `threshold_amount`, `approver_role` (Default
`lead`). Auflösung im Engine-Gate, in dieser Reihenfolge:

1. Freigabe (approved) für den Run vorhanden → Schritt läuft.
2. `always` → Freigabe immer.
3. `threshold` → Freigabe ab `Betrag ≥ threshold_amount` (`SkillDef.amountOf`
   liefert den Betrag; unbestimmbar ⇒ Freigabe — fail-closed).
4. `never` → nur für Skills **ohne** Geld-Wirkung wirksam. Für
   `handlesMoney`-Skills wird `never` zur Laufzeit **überschrieben** (Audit
   `policy.overridden_failsafe`), es gilt die Skill-Guardrail. Diese
   Unabschaltbarkeit ist gewollt und getestet.
5. Keine Policy → Verhalten wie Phase 3 (Skill-Guardrail; `handlesMoney` ohne
   Guardrail ⇒ immer Freigabe).

Policy-erzeugte Approvals tragen `required_role`; `approve()`/`reject()` prüft
die Membership-Rolle des Entscheiders (admin/owner erfüllen jede Anforderung).
Approvals **ohne** `required_role` (Kein-Policy-Fall) behalten das
Phase-3-Verhalten.

### Disclosure-Policies (Wissens-Sichtbarkeit)

`documents.visibility` ∈ `open | restricted | confidential` (Default `open`,
Bestandsdaten → `open`). `visibility_grants` sagt, welche Rolle welche Stufe
sehen darf (Seed-Defaults: restricted → lead+admin, confidential → admin).
`retrieve()` filtert **in SQL, vor jedem LLM-Kontakt**; `answerQuestion()`
reicht die Rolle durch. Für die Rolle unsichtbares Wissen wird nie abgerufen —
die ehrliche Kein-Wissen-Antwort ist deshalb strukturell leak-frei (kein „dazu
darfst du nichts sehen").

### Fail-closed-Matrix

| Situation | Verhalten |
| --------- | --------- |
| Keine approval_policy für den Skill | Skill-Guardrail; `handlesMoney` ohne Guardrail ⇒ immer Freigabe |
| `threshold` ohne bestimmbaren Betrag/Schwelle | Freigabe erforderlich |
| `never` auf `handlesMoney`-Skill | überschrieben (Audit), Skill-Guardrail gilt |
| Entscheider ohne Membership / falsche Rolle (bei `required_role`) | Entscheidung verweigert |
| Approval ohne `required_role` (Kein-Policy-Fall) | Phase-3-Verhalten: jede `decided_by`-Identität |
| Keine/unbekannte Rolle beim Retrieval | nur `open`-Wissen |
| Kein Grant für Stufe+Rolle | Stufe unsichtbar |
| Policy-Änderung durch non-admin | verweigert |
| Für Rolle verstecktes, aber relevantes Wissen | ehrliche Kein-Wissen-Antwort, kein Leak |

Verwaltung: `src/lib/policies/` (`getApprovalPolicy`, `setApprovalPolicy`,
`setDocumentVisibility`, `setVisibilityGrant`) — alle in `withTenant`, alle
admin-only, jede Änderung als `policy.changed` im Audit mit `{old, new}` im
`detail`-jsonb. UI in diesem Branch bewusst minimal: visibility-Auswahl beim
Anlegen + Badge pro Dokument auf `/dashboard/knowledge`.

Demo: **`pnpm demo:policies`** (Threshold-Policy, Never-Failsafe, Disclosure
ohne Leak, Rollen-Gate). Tests: `tests/policy.test.ts` ist Teil des CI-Gates.

---

## Settings-Oberfläche (Admin-Governance-UI)

`/dashboard/settings` macht die Phase-4-Governance für Admins bedienbar —
**ohne neue Governance-Logik**: die Seite ist UI + dünne Server-Actions, jede
Mutation delegiert an die bestehenden Funktionen aus `src/lib/policies/`
(dort sitzen Admin-Gate, `withTenant` und Audit). Der Sidebar-Eintrag ist nur
für `admin`/`owner` sichtbar; die Seite selbst leitet Nicht-Admins um — die
serverseitigen Checks in den Policy-Funktionen bleiben die Wahrheit.

Drei Tabs:

1. **Freigabe-Regeln** — pro Katalog-Skill Modus (`immer | ab Schwelle X € |
   nie`) und Freigeber-Rolle (`lead | admin`), gespeichert über
   `setApprovalPolicy()`. Geld-Skills tragen den Hinweis, dass Freigabe dort
   nicht abschaltbar ist (der Never-Failsafe aus Phase 4, sichtbar gemacht).
2. **Wissens-Sichtbarkeit** — Erklärung der drei Stufen, editierbare
   Grant-Matrix (Rolle × Stufe, `setVisibilityGrant()`), darunter eine
   read-only Dokumentliste mit Verweis auf `/dashboard/knowledge` zum Ändern
   der Stufe.
3. **Mitglieder & Rollen** — Rollen ändern (`member | lead | admin`) über
   `setMembershipRole()`.

**`setMembershipRole()`** (`src/lib/policies/index.ts`) ist die einzige neue
Backend-Funktion dieses Branches: admin-only, in `withTenant` (fremde userIds
sind unter RLS schlicht „not found"), mit **Letzter-Admin-Guard** (der letzte
admin/owner kann nicht degradiert werden) und Audit
`membership.role_changed` mit `{old, new}`. `owner` ist über die Funktion
nicht vergebbar (bleibt manuelle Elevation). Hinweis: `memberships.role` wird
beim Dashboard-Laden des jeweiligen Users mit seiner Clerk-Org-Rolle
gespiegelt (`ensureOrgAndMembership`) — für dauerhafte Änderungen die Rolle
auch in Clerk pflegen.

Tests: `tests/settings.test.ts` (admin-only, Tenant-Scope, Letzter-Admin-Guard,
Audit, No-op ohne Audit) ist Teil des CI-Gates.

---

## Slack als zweiter Eingang (Phase 6)

Slack ist der erste **externe** Eingang: Fragen stellen, Skills anstoßen und
Freigaben erteilen — alles über die **bestehenden** Funktionen
(`answerQuestion`, `startRun`, `approve`, `reject`). Der Slack-Layer
(`src/lib/slack/`) ist ein dünner Adapter ohne eigene Business-Logik.

Weil Slack **ohne Clerk-Session** hereinkommt, gilt für jede Anfrage dieselbe
harte Reihenfolge, fail-closed an jeder Stufe:

1. **Signatur** — jede Anfrage wird gegen `SLACK_SIGNING_SECRET` verifiziert
   (HMAC über den rohen Body, `X-Slack-Signature` +
   `X-Slack-Request-Timestamp`, ±5-Minuten-Replay-Fenster,
   Konstantzeit-Vergleich). Ungültig ⇒ **401**, es wird nichts geparst und
   nichts verarbeitet (`src/lib/slack/verify.ts`).
2. **Team → Org** — der Slack-Workspace (`team_id`) wird über
   `slack_installations` auf **genau eine** `org_id` aufgelöst (globaler
   Unique-Index auf `slack_team_id`: ein Team kann strukturell nie zwei Orgs
   gehören). Kein Mapping ⇒ **403**. Ab hier läuft jede Aktion durch
   `withTenant(orgId)` — die RLS-Mandantentrennung gilt für Slack exakt wie
   für die UI.
3. **User → Rolle** — der Slack-User wird über `slack_user_links` auf eine
   Membership dieser Org gemappt (die Rolle wird **live** gelesen, nie auf dem
   Link gecacht; der zusammengesetzte FK `(org_id, user_id)` →
   `memberships` macht Links auf fremde Memberships strukturell unmöglich).
   Kein Link ⇒ nur Lese-Verhalten auf `open`-Wissen; Skills starten oder
   freigeben ist unmöglich.
4. **Handeln** über die bestehenden Funktionen; das Freigabe-Rollen-Gate
   (`required_role`) erzwingt weiterhin die Engine (`decide()`), nicht der
   Adapter.
5. **Audit** — zusätzlich zu den Einträgen der Engine schreibt der Adapter
   jede Slack-Aktion als `slack.*` (`slack.question_answered`,
   `slack.skill_started`, `slack.approval_approved/rejected/denied`) mit
   `detail.via = "slack"` und `actor_id = "slack:<UserId>"`.

**Bootstrap-Ausnahme in RLS:** die Auflösung Team → Org ist die EINZIGE
Abfrage ohne Tenant-Kontext — der Tenant ist ja ihr Ergebnis. Migration 0006
löst das mit einer zusätzlichen **SELECT-only-Policy** auf
`slack_installations`: `resolveSlackTeam()` bindet die Team-ID
transaktionslokal in `app.slack_team_lookup` (dieselbe `set_config`-Mechanik
wie `withTenant`) und sieht damit exakt die Zeilen dieses einen Teams. Ohne
GUC matcht die Policy nichts — nackte Queries liefern weiter 0 Zeilen.
Schreibzugriffe deckt die Lookup-Policy nicht ab.

**Secrets:** `SLACK_SIGNING_SECRET` und `SLACK_BOT_TOKEN` leben nur in `.env`.
`slack_installations.bot_token_ref` speichert einen **Verweis**
(`env:SLACK_BOT_TOKEN`), nie das Token — es gibt noch keinen Vault in diesem
Stack; kommt einer, ändert sich nur das Ref-Format, nicht die Spalte
(`createSlackInstallation` weist Werte ab, die wie echte `xox…`-Token
aussehen).

### Die drei Endpoints

Alle drei sind **öffentliche** Routen (in `src/middleware.ts` von der
Clerk-Pflicht ausgenommen), aber signatur-authentifiziert:

| Route | Zweck |
| --- | --- |
| `POST /api/slack/events` | Events API: `url_verification`-Challenge, `app_mention` + DM ⇒ Frage → `answerQuestion` → Antwort mit `Quellen:`-Zeile in den Thread (via `chat.postMessage`) |
| `POST /api/slack/commands` | Slash-Command `/ergane`: `frage <text>` und `skill <key> {json}`; `awaiting_approval` ⇒ Block-Kit-Nachricht mit **Freigeben/Ablehnen**-Buttons |
| `POST /api/slack/interactions` | Button-Klicks: `approve()`/`reject()` mit der gemappten Membership als `decided_by`; unzureichende Rolle/kein Link ⇒ ephemere Fehlermeldung, keine Aktion |

Skill-Runs mit JSON-Argumenten: eine ins JSON geschmuggelte `"rolle"` wird
serverseitig mit der verifizierten Link-Rolle überschrieben.

### Slack: ack-then-work & Idempotenz

**Warum:** Slack verlangt ein 200 innerhalb von **3 Sekunden**, sonst
re-delivert es denselben Request (bis zu 3×). Würde die Antwort (mit echten
LLM-Providern potenziell mehrere Sekunden) vor dem Ack berechnet, bekäme man
Doppelantworten und doppelt gestartete Runs.

**Wie:** Alle drei Handler folgen dem Muster **ack-then-work** — mit einer
wichtigen Einschränkung: die Sicherheits-Tore bleiben **vor** dem Ack.

1. Signatur (ungültig ⇒ **401**) → Team→Org (kein Mapping ⇒ **403**) →
   User→Rolle. Ein unsignierter/fremder Request bekommt nie ein vorschnelles
   200.
2. **Idempotenz-Claim** (`src/lib/slack/idempotency.ts`, Migration 0007):
   vor jeder Arbeit wird die stabile Kennung des Requests — Events:
   `event_id` (Fallback `team_id` + Event-ts), Commands/Interactions:
   `trigger_id` — atomar in `slack_processed_events` eingefügt (RLS+FORCE
   nach Checkliste, unique pro `org_id` + `event_key`). Schlägt der Insert
   am Unique fehl ⇒ Duplikat-Delivery ⇒ stilles 200, keine zweite
   Ausführung. Claims sind **pro Tenant** — derselbe Key in Org A und Org B
   kollidiert nie. Aufräumen: `cleanupProcessedSlackEvents()` löscht
   Einträge > 24 h (Korrektheit hängt nicht daran; aufrufbar aus jedem
   Wartungspfad, bewusst kein Cron).
3. **Sofortiges 200**: Events leer, Slash-Commands mit ephemerem
   „… wird bearbeitet", Interactions `{ ok: true }`. Die
   `url_verification`-Challenge bleibt synchron (der Challenge-Wert muss in
   den Response-Body).
4. **Arbeit danach** via `deferWork()` (`src/lib/slack/defer.ts`): die
   nachgelagerte Arbeit (`answerQuestion`, `startRun`, `approve`/`reject`)
   läuft in `withTenant(orgId)` mit derselben aufgelösten Org/Rolle und
   liefert das Ergebnis per `chat.postMessage` nach. Fehler werden geloggt
   **und** dem Slack-User als (ephemere) Fehlermeldung gemeldet — nie ein
   unbehandelter Reject.

**Plattform-Anschlusspunkt:** Der Node-Default von `deferWork()` ist
fire-and-forget — korrekt überall, wo der Prozess weiterläuft (dev,
self-hosted). Auf Serverless-Runtimes, die die Instanz direkt nach der
Response einfrieren (Vercel Functions/Lambda), einmalig beim Start das
Keep-alive der Plattform einhängen:

```ts
import { after } from 'next/server'; // oder waitUntil aus @vercel/functions
import { setDeferKeepAlive } from '@/lib/slack';

setDeferKeepAlive((pending) => after(() => pending));
```

Tests/Demo machen die Reihenfolge deterministisch sichtbar über
`drainDeferredWork()`: `pnpm demo:slack` zeigt jedes „ACK HTTP 200" **vor**
der zugehörigen nachgelieferten Nachricht und demonstriert, dass eine
Re-Delivery mit derselben `trigger_id` keinen zweiten Run startet.
Test-Gates: `tests/slack-ack.test.ts` (Ack-vor-Arbeit, Gates vor Ack,
Idempotenz pro Tenant, deferWork-Fehlerpfade, synchrone Challenge).

### Verwaltung (Settings → Slack, admin-only)

Der Tab zeigt den Verbindungsstatus und erlaubt das manuelle Anlegen des
Team-Mappings sowie das Verknüpfen/Entknüpfen von Slack-Usern mit
Memberships (`src/lib/slack/admin.ts`: Admin-Gate + Audit wie bei den
Policies). **MVP-Entscheidung:** kein OAuth-Install-Flow — die Team-ID wird
von einem Admin eingetragen; OAuth ersetzt später nur
`createSlackInstallation`, Tabellen und alles danach bleiben unverändert.

### Slack lokal testen

Ohne Slack-Account: **`pnpm demo:slack`** baut valide signierte Requests mit
einem Demo-Secret, ruft die drei Handler direkt auf und fängt ausgehende
Nachrichten ab. Gezeigt werden: 401/403-Gates, Frage → Antwort mit Quelle,
Skill → `awaiting_approval` mit Buttons, Klick durch unverlinkt/member
(abgewiesen) und lead (Freigabe → completed) — inklusive Audit-Kette.

Mit echtem Slack-Workspace:

1. **Slack-App anlegen** ([api.slack.com/apps](https://api.slack.com/apps) →
   „Create New App" → From scratch, Workspace wählen).
2. **Secrets nach `.env`:** *Basic Information → Signing Secret* ⇒
   `SLACK_SIGNING_SECRET`; nach dem Install *OAuth & Permissions → Bot User
   OAuth Token* ⇒ `SLACK_BOT_TOKEN`.
3. **Scopes** (*OAuth & Permissions → Bot Token Scopes*):
   `app_mentions:read`, `chat:write`, `commands` — für DM-Fragen zusätzlich
   `im:history` (+ Event `message.im`).
4. **Tunnel:** `pnpm dev` (Port 3000) und `ngrok http 3000` — die
   `https://…ngrok…`-URL ist die Basis für alle drei Request-URLs.
5. **Request-URLs eintragen:**
   - *Event Subscriptions* → Enable, Request URL
     `https://<ngrok>/api/slack/events` (die `url_verification`-Challenge
     beantwortet der Handler automatisch), Bot Events: `app_mention`
     (+ `message.im` für DMs).
   - *Interactivity & Shortcuts* → Enable, Request URL
     `https://<ngrok>/api/slack/interactions`.
   - *Slash Commands* → Create: Command `/ergane`, Request URL
     `https://<ngrok>/api/slack/commands`, Usage-Hint
     `frage <text> | skill <key> {json}`.
6. **App installieren** (*Install App*), Bot in einen Kanal einladen.
7. **Mappen:** Team-ID (`T…`, z. B. aus der Workspace-URL oder dem
   Event-Payload) unter *Einstellungen → Slack* mit der Org verbinden;
   Slack-User-IDs (`U…`, Slack-Profil → „Copy member ID") mit Memberships
   verknüpfen. Nicht gemappte Teams/Nutzer werden abgewiesen bzw. sehen nur
   `open`-Wissen.
8. **Ausprobieren:** `@ergane <Frage>` im Kanal, `/ergane frage <Frage>`,
   `/ergane skill beleg_kontieren {"beschreibung":"Lizenz","betragEur":1240}`
   → Freigabe-Buttons im Kanal.

Tests: `tests/slack.test.ts` (Signatur-Gate inkl. Replay-Fenster, Team-Gate,
Cross-Tenant-Beweis Team A ↛ Org B, Disclosure via Slack, unverlinkt/member/
lead an den Buttons, „via slack"-Audit, RLS ENABLE+FORCE auf beiden neuen
Tabellen) ist Teil des CI-Gates.

---

## Lebenszyklus & DSGVO (Phase 7)

„GDPR-native" braucht Löschpfade. Phase 7 liefert sie (`src/lib/lifecycle/`,
Migration 0008) — ohne den Boden aufzuweichen: alles läuft in `withTenant`
(fremde IDs sind „not found", Löschen ohne Kontext trifft 0 Zeilen), alles ist
admin-gated und auditiert.

| Operation | Funktion | Absicherung |
| --- | --- | --- |
| Dokument löschen (Chunks kaskadieren) | `deleteDocument()` | Admin-Gate, Audit `document.deleted`; danach ehrliche Kein-Wissen-Antwort |
| Chat-Retention (manuell) | `purgeChatHistory(olderThanDays)` | Admin-Gate, Audit `chat.purged` mit Anzahl |
| Chat-Retention (automatisch, Phase 15) | `setChatRetention(days\|null)` + `enforceChatRetention()` — läuft deferred nach Chat-Aktivität (kein Cron), `org_settings` (Migration 0012, RLS+FORCE) | Admin-Gate für die Einstellung; automatische Löschungen auditiert als Agent `retention` |
| Vollexport (Art. 20) | `exportOrgData()` → Download unter Einstellungen → „Daten & Löschung" | liest nur durch `withTenant` — kann strukturell nur den eigenen Tenant enthalten; Audit `org.exported` |
| Person aus dem Audit tilgen (Art. 17) | `pseudonymizeAuditActor(old, new)` | läuft NUR über die SECURITY-DEFINER-Funktion aus 0008 (s. u.); der Marker-Eintrag enthält die alte Kennung nicht — auch nicht als Autor |
| Tenant-Offboarding | `deleteOrganization(confirmName)` | Name muss exakt getippt werden; Löschnachweis (Zeilenzahlen) wird ZURÜCKGEGEBEN (kann nicht in der gelöschten DB liegen) |

**Audit vs. Art. 17 — die Entscheidung:** Der Audit-Trail bleibt append-only.
Es gibt genau zwei eng vergitterte Ausnahmen, beide nur über
SECURITY-DEFINER-Funktionen erreichbar (`app_user` hat weiterhin KEIN
UPDATE/DELETE auf `audit_log` und KEIN DELETE auf `organizations`):

1. `pseudonymize_audit_actor(old, new)` — erlaubt dem Trigger ein UPDATE, das
   AUSSCHLIESSLICH `actor_id` ändert, nur solange das transaktionslokale GUC
   `app.audit_pseudonymize` gesetzt ist, nur im Tenant des aufrufenden
   `withTenant`-Kontexts. Die Audit-STRUKTUR (was, wann) bleibt erhalten.
2. `delete_organization(org)` — erlaubt dem Trigger den DELETE der
   Audit-Zeilen nur während der Organisations-Kaskade (GUC
   `app.audit_erasure`), und nur wenn `org` dem aktuellen Tenant-Kontext
   entspricht. Nötig, weil der Append-only-Trigger sonst auch die
   FK-Kaskade `organizations → audit_log` blockiert.

Seit Phase 14 werden auch **detail-Payloads gescrubbt**
(`pseudonymize_audit_detail`, Migration 0011): jeder JSON-String-Wert, der der
Kennung EXAKT entspricht, wird ersetzt — Substrings in längeren Werten nie
(Exact-Token-Semantik, bewusst: keine versehentliche Korruption fremder
Payloads). Der `user.deleted`-Webhook tilgt dabei ALLE Kennungs-Formen der
Person (Clerk-ID, Slack-ID, `slack:<ID>`) aus `actor_id` UND `detail`.

Demo: **`pnpm demo:lifecycle`** (Anlegen → Export → Löschen → Pseudonymisieren
→ Offboarding mit Nachweis). Tests: `tests/lifecycle.test.ts`.

---

## Clerk-Synchronisation (Phase 8)

Clerk ist die Quelle der Wahrheit für WER zu WELCHER Org gehört — bisher wurde
aber nur beim Dashboard-Laden gespiegelt. Die Lücke: ein in Clerk entfernter
Nutzer behielt seine lokale Membership, damit Freigaberechte und Slack-Link.
`POST /api/clerk/webhooks` (öffentlich, Svix-signatur-verifiziert wie der
Slack-Eingang: HMAC über den rohen Body, ±5-Minuten-Fenster, ungültig ⇒ 401)
schließt sie:

| Event | Wirkung |
| --- | --- |
| `organizationMembership.deleted` | Membership weg; der Composite-FK kaskadiert den Slack-Link — die Person kann via Slack nichts mehr freigeben (End-to-End getestet) |
| `organizationMembership.created/updated` | Membership gespiegelt/Rolle synchronisiert — aber NUR bei `role_source='clerk'` |
| `user.deleted` | Memberships in ALLEN Orgs entfernt (`user_org_ids()`, Migration 0009 — dieselbe enge Bootstrap-Ausnahme wie der Slack-Team-Lookup) + Audit-Kennung pro Tenant pseudonymisiert (Phase-7-Funktion) |
| `organization.deleted` | NUR Audit-Marker. Bewusst keine Auto-Löschung — Offboarding bleibt der explizite, bestätigte `deleteOrganization()`-Pfad |

**`memberships.role_source`** (Migration 0009) behebt die dokumentierte Falle,
dass ein lokal vergebenes `lead` beim nächsten Login vom Clerk-Mapping
überschrieben wurde: `setMembershipRole()` markiert Rollen als `local`, und
weder `ensureOrgAndMembership` noch der Webhook fassen `local`-Rollen an.

Idempotenz: Org-Events claimen `clerk:<svix-id>` pro Tenant (derselbe
atomare Mechanismus wie bei Slack); `user.deleted` ist von Natur aus
idempotent. Secret: `CLERK_WEBHOOK_SECRET` (`whsec_…`) in `.env`.
Tests: `tests/clerk-sync.test.ts`.

---

## Slack produktionsreif (Phase 9)

Vier Betriebslücken des Slack-Eingangs geschlossen:

1. **Token pro Installation.** Der Poster löst `bot_token_ref` PRO NACHRICHT
   auf: `env:<NAME>` (manuelles Mapping), `enc:<payload>` (OAuth, AES-256-GCM
   mit `SLACK_TOKEN_ENC_KEY` — Schlüssel in `.env`, DB hält nur Ciphertext),
   ohne Ref → `env:SLACK_BOT_TOKEN`. Unbekanntes Schema/fehlende Variable ⇒
   Fehler, nie ein stiller Post in den falschen Workspace. Multi-Workspace
   funktioniert damit wirklich.
2. **OAuth-Install-Flow.** `GET /api/slack/oauth/start` (nur Admin, signierter
   State mit Ablauf bindet den Flow an GENAU diese Org) → Slack →
   `GET /api/slack/oauth/callback` (Session-Org MUSS der State-Org entsprechen,
   Code-Tausch injizierbar für Tests, Token wird verschlüsselt gespeichert über
   `createSlackInstallation` — Admin-Gate, Audit, globales Team-Unique gelten).
   Redirect-URL in der Slack-App: `https://<host>/api/slack/oauth/callback`.
   Das manuelle Team-ID-Mapping bleibt als Fallback.
3. **Keep-alive verdrahtet.** `src/instrumentation.ts` hängt Nexts `after()`
   in `setDeferKeepAlive()` ein — auf Vercel/Lambda wird die deferte Arbeit
   nicht mehr vom Einfrieren der Instanz abgeschnitten. Zusätzlich räumt jeder
   verarbeitete Request die Idempotenz-Claims seines Tenants auf (>24 h,
   deferred, best-effort) — weiterhin kein Cron nötig.
4. **Rate-Limit.** In-App-Backstop (60/min pro IP, Fixed-Window, per Prozess)
   VOR der Signaturprüfung ⇒ 429. Für harte Garantien gehört ein
   Plattform-Limiter (z. B. Vercel WAF) davor; dieser hier schützt HMAC/DB
   vor Garbage-Fluten.

Neue Env-Variablen: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`,
`SLACK_TOKEN_ENC_KEY` (siehe `.env.example`).
Tests: `tests/slack-prod.test.ts`.

---

## RAG v2: Multi-Turn & Dokument-Versionen (Phase 10)

**Multi-Turn mit Disclosure-Invariante.** `answerQuestion()` nimmt optional
`history` (vorherige Gesprächs-Turns) in den LLM-Prompt — Retrieval nutzt
weiterhin AUSSCHLIESSLICH die aktuelle Frage + Rolle. Die Historie ist strikt
**pro Person**: `chat_messages.actor_id` (Migration 0010, nullable — alte
Zeilen sind fail-closed nie Teil einer Historie), geladen nur über
`loadChatHistory(orgId, actorId)`. Damit kann ein member niemals die
confidential-Antworten eines leads über den Prompt erben — End-to-End
getestet. Chat-UI und Slack-Fragen laufen beide über diesen Pfad; die
Chat-Seite zeigt seither auch nur noch die EIGENE Historie (die org-weite
Anzeige hätte role-gated Antworten an alle geleakt — behoben).

**Dokument-Versionen (Re-Ingest).** `ingestDocument({ replaceDocumentId })`
ersetzt den Inhalt eines bestehenden Dokuments atomar in einer Transaktion:
alte Chunks weg, neue rein, gleiche Dokument-ID (nichts bricht), Audit
`knowledge.reingested`. Sichtbarkeit bleibt erhalten, wenn keine neue
angegeben wird (fail-closed: ein confidential-Dokument wird durch ein Update
nicht versehentlich open). UI: „Neue Version" pro Dokument in der
Wissensbasis. Fremde Dokument-IDs sind unter RLS „not found".

Tests: `tests/rag-v2.test.ts`.

---

## Echte Skill-Effekte (Phase 11)

Die Acting-Steps von `angebot_erstellen` und `rechnung_erstellen` haben jetzt
einen ECHTEN Effekt: mit optionalem `input.email` geht das Dokument als
**PDF-Anhang per E-Mail** raus — ohne `email` bleibt alles beim simulierten
Verhalten (byte-kompatibel, `simuliert: true`), eine unplausible Adresse fällt
fail-closed auf simuliert zurück.

- **Effekt-Abstraktion** (`src/lib/effects/`): dasselbe Muster wie die
  AI-Provider — Interface + deterministischer Fake (zeichnet Sendungen auf,
  `failNext()` für Fehlerpfade) + Resend-Adapter. `RESEND_API_KEY` gesetzt ⇒
  echt (Absender `EFFECTS_EMAIL_FROM`); ohne Key: dev/test ⇒ Fake, Produktion
  ⇒ throw.
- **PDF-Renderer** (`renderSimplePdf`): abhängigkeitsfreier Ein-Seiten-Writer
  (WinAnsi ⇒ Umlaute funktionieren, korrekte xref-Offsets, escaping) — wächst
  der Layout-Bedarf, wird hinter derselben Funktion eine Library eingesetzt.
- **Die Freigabe-Mechanik ist unangetastet**: der Effekt lebt IM Acting-Step,
  also strukturell hinter Guardrail/Policy/Approval. Getestet: vor der
  Freigabe geht nichts raus, nach approve genau EINE Mail, nach reject nie;
  ein fehlschlagender Versand ⇒ Step `failed` ⇒ Run `failed` + Audit, keine
  Geister-Mail. Die Buchung der Rechnung bleibt simuliert (keine
  Buchhaltungs-Anbindung — dokumentiert).

UI: optionales Feld „Empfänger-E-Mail" in beiden Skill-Formularen.
Tests: `tests/skill-effects.test.ts`.

---

## Betrieb: Logging, Audit-UI, Deployment (Phase 12)

**Strukturiertes Logging** (`src/lib/log.ts`): eine JSON-Zeile pro Ereignis,
niemals Inhalte (Dokumente/Fragen/Antworten — dafür ist das audit_log da),
Secrets werden defensiv maskiert (nach Schlüsselnamen UND nach Werte-Form:
`xox…`, `whsec_…`, `Bearer …`). `setErrorReporter()` ist der dokumentierte
Anschlusspunkt für Sentry & Co. (Wiring in `src/instrumentation.ts`); ein
kaputter Reporter kann den Aufrufer nie brechen. `deferWork()` loggt darüber.

**Audit-UI**: Kategorie-Filter (jetzt inkl. `slack` und `lifecycle`),
Akteur-Filter und Pagination — alles über `queryAuditLog()` (`src/lib/audit.ts`),
das strikt in `withTenant` läuft: kein Filter kann den Tenant-Scope weiten.

**Security-Header** (`next.config.mjs`): `X-Content-Type-Options`,
`X-Frame-Options: DENY`, `Referrer-Policy`, `Permissions-Policy` auf jeder
Antwort.

**CSP mit Nonces (Phase 16, `src/lib/csp.ts` + Middleware):** jede
Seiten-Antwort bekommt eine Content-Security-Policy mit frischem
Per-Request-Nonce (`strict-dynamic`; Clerk-Hosts freigegeben; `frame-ancestors
'none'`). Zweistufiger Rollout: Default ist **Report-Only** (beobachten, nichts
brechen) — nach einem beobachteten Deploy `CSP_ENFORCE=true` setzen. API-Routen
bekommen keine CSP (kein HTML).

**Fehler-Sink (Phase 16, `src/lib/error-reporter.ts`):** mit
`ERROR_WEBHOOK_URL` wird jede `logError()`-Meldung (maskiert, fire-and-forget,
nie in den App-Pfad werfend) als JSON an einen Webhook gePOSTet —
vendor-neutral (Slack/Discord/Relay). Der Sentry-SDK-Anschluss ist im
Datei-Header dokumentiert; der `setErrorReporter()`-Vertrag bleibt identisch.

**WAF-/Plattform-Rate-Rules (Checkliste, nicht lokal testbar):** in Vercel →
Firewall Custom Rules für `/api/slack/*` und `/api/clerk/*` mit Rate-Limit
(z. B. 120/min pro IP) anlegen — der In-App-Limiter bleibt der Backstop pro
Instanz.

### Deployment (Vercel-Pfad)

1. **Projekt verbinden**, Framework Next.js — Build ist Standard
   (`next build`); `src/instrumentation.ts` läuft automatisch und verdrahtet
   das `after()`-Keep-alive für die deferte Slack-Arbeit.
2. **Env-Variablen** (Production + Preview): `DATABASE_URL` (app_user!),
   `DIRECT_DATABASE_URL` (Owner, NUR für Migrationen), Clerk-Keys,
   `CLERK_WEBHOOK_SECRET`, `SLACK_SIGNING_SECRET` (+ `SLACK_BOT_TOKEN` oder
   OAuth-Trio `SLACK_CLIENT_ID`/`SLACK_CLIENT_SECRET`/`SLACK_TOKEN_ENC_KEY`),
   optional `ANTHROPIC_API_KEY`/`VOYAGE_API_KEY`, `RESEND_API_KEY` +
   `EFFECTS_EMAIL_FROM`. Ohne AI-/Effekt-Keys wirft Produktion (fail-closed) —
   nichts antwortet heimlich aus Fakes.
3. **Migrationen als Release-Schritt**, nie im Request-Pfad:
   `pnpm db:migrate` (läuft als Owner über `DIRECT_DATABASE_URL`) — z. B. als
   CI-Step vor dem Promote. Die App selbst verbindet nur als `app_user`.
4. **Pooling**: hinter PgBouncer (Transaction-Mode) `&pgbouncer=true` an die
   `DATABASE_URL` — `withTenant` ist unter Transaction-Pooling korrekt (siehe
   oben), das Flag betrifft nur Prepared Statements.
5. **Webhook-URLs eintragen**: Slack (drei URLs + OAuth-Redirect, siehe
   „Slack lokal testen") und Clerk (`/api/clerk/webhooks`).
6. **Backups**: beim Managed-Postgres-Anbieter aktivieren (PITR empfohlen);
   der In-App-Export (Settings → „Daten & Löschung") ist ein
   Betroffenenrechte-Werkzeug, KEIN Backup.
7. **Rate-Limits**: der In-App-Limiter ist per Instanz — für harte Garantien
   WAF-/Plattform-Rate-Rules auf `/api/slack/*` und `/api/clerk/*` legen.

Tests: `tests/ops.test.ts`.

### Go-Live-Checkliste (Phase 13)

Der Deploy-Workflow (`.github/workflows/deploy.yml`) läuft bei jedem Push auf
`main`: Gate → `prisma migrate deploy` (Owner, NUR im CI) → Vercel-Promote →
Smoke-Check auf `/api/health`. Bis die Secrets konfiguriert sind, überspringt
er sich selbst mit einer Notice — nichts deployt versehentlich.

Einmalige manuelle Schritte (nur mit Vercel-/Slack-/Clerk-Zugang möglich):

- [ ] Managed Postgres mit pgvector provisionieren; `app_user` nach dem Muster
      aus `docker/postgres/init/01-app-user.sql` anlegen (NOSUPERUSER,
      NOBYPASSRLS, nie Owner); PITR-Backups aktivieren.
- [ ] Vercel-Projekt verbinden (`vercel link`) und die Runtime-Env setzen
      (Matrix oben — `DATABASE_URL` zeigt auf `app_user`;
      `DIRECT_DATABASE_URL` gehört NICHT in die Vercel-Env).
- [ ] Repo-Secrets setzen: `PROD_DIRECT_DATABASE_URL`, `VERCEL_TOKEN`,
      `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`; Repo-Variable `PROD_HEALTH_URL`
      (z. B. `https://<host>/api/health`).
- [ ] Clerk: Webhook-Endpoint `https://<host>/api/clerk/webhooks` anlegen
      (Events: `organizationMembership.*`, `user.deleted`,
      `organization.deleted`), Signing Secret → `CLERK_WEBHOOK_SECRET`.
- [ ] Slack-App: die drei Request-URLs + OAuth-Redirect eintragen (siehe
      „Slack lokal testen"), Secrets in die Vercel-Env.
- [ ] Smoke-Test: Login → Org → Dokument → Frage mit Quelle; Slack
      `url_verification` grün; Clerk-Test-Event kommt an; `/api/health` 200.


---

## OCR für gescannte PDFs (Phase 17)

Gescannte PDFs ohne Textebene wurden bisher abgelehnt — jetzt werden sie
transkribiert, wenn ein OCR-Provider konfiguriert ist (`src/lib/ingest/ocr.ts`,
Provider-Muster wie AI/Effects):

- **Real-Adapter = Claude über die bestehende Anthropic-Abhängigkeit**: die
  Messages-API liest PDFs nativ (Base64-Document-Block, Vision für Scans) —
  kein neuer Vendor, kein Rasterizer. Aktiv, sobald `ANTHROPIC_API_KEY`
  gesetzt ist.
- **Fail-closed bleibt**: ohne Provider werden Scans exakt wie bisher mit
  klarer Meldung abgelehnt; OCR-Fehler oder leere Transkription ⇒
  `ExtractionError`, nichts wird geschrieben. Die Factory hat bewusst KEINEN
  Fake-Fallback — Tests injizieren den Fake explizit, ein fehlender Key kann
  nie „pretend-OCR" in die Wissensbasis schreiben.
- **Kosten-Guard**: Scans über `OCR_MAX_PAGES` (30) werden VOR jedem API-Call
  abgelehnt. `meta.ocr = true` markiert transkribierte Dokumente; normale
  Text-PDFs laufen nie durch OCR (getestet mit Provider-Spy).

Tests: `tests/ingest-ocr.test.ts`.

---

## ✅ Checklist: adding a new tenant table (the most important section)

Follow this **every time** so new tables are tenant-safe by construction. Do it
in the migration; never rely on app code to scope data.

1. **Column.** Add `org_id UUID NOT NULL` with
   `REFERENCES organizations(id) ON DELETE CASCADE` and an index on `org_id`.
2. **Enable + force RLS:**
   ```sql
   ALTER TABLE "your_table" ENABLE ROW LEVEL SECURITY;
   ALTER TABLE "your_table" FORCE  ROW LEVEL SECURITY;
   ```
3. **Add the isolation policy** (one `FOR ALL`, or split per command):
   ```sql
   CREATE POLICY "your_table_tenant_isolation" ON "your_table"
     USING      ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid)
     WITH CHECK ("org_id" = NULLIF(current_setting('app.current_org', true), '')::uuid);
   ```
4. **Grant least privilege to `app_user`** (only what's needed — append-only
   tables get `SELECT, INSERT` only):
   ```sql
   GRANT SELECT, INSERT, UPDATE, DELETE ON "your_table" TO app_user;
   ```
   Never make `app_user` the owner; never grant it `BYPASSRLS` or `TRUNCATE`.
5. **Access only via `withTenant`.** All reads/writes go through
   `withTenant(orgId, tx => …)`; `orgId` comes only from `requireTenant()`.
6. **Mutations set `org_id` explicitly** from the session context (defense-in-depth).
7. **Extend the gate.** Add the table to `tests/isolation.test.ts` (at minimum the
   "no-context returns no rows" check), and `pnpm test` must stay green.

If you skip step 2, 3, or 4, the test gate's "no-context ⇒ no rows" and
cross-tenant checks are designed to catch it.

---

## Design decisions & trade-offs

- **Clerk org id → internal UUID (deterministic).** Clerk org ids look like
  `org_2ab…`, not UUIDs, while the spec mandates `org_id uuid`. We derive the
  internal UUID as `uuidv5(clerkOrgId)` (`src/lib/uuid.ts`) — stable, no lookup
  table, computed only from the verified session's org id. `organizations.id` is
  this UUID; `clerk_org_id` is stored alongside.
- **`organizations` is self-row RLS-protected.** It is the tenant root, so its
  policy keys on `id` (the tenant key = the deterministic UUIDv5 of the Clerk org
  id) instead of `org_id`: a tenant can see/insert/update only its own org row and
  can never enumerate other tenants' org metadata. `app_user` gets
  `SELECT/INSERT/UPDATE` (not `DELETE`), each scoped by RLS to the current tenant's
  row. Consequently the bootstrap upsert in `ensureOrgAndMembership()` (and the
  seed) runs inside `withTenant(orgId)`. (An earlier draft left this table without
  RLS; an adversarial review flagged that it made org-metadata isolation rest on
  app-code discipline, contradicting the core promise — hence this change.)
- **Two database URLs / roles.** `DATABASE_URL` = `app_user` (everything the app
  and tests do). `DIRECT_DATABASE_URL` = owner (only `prisma migrate` and test
  reset). Prisma uses `directUrl` for migrations and `url` for the client, so the
  split is automatic.
- **Pooling.** `withTenant` uses a transaction-local GUC inside a single
  interactive transaction, so it is correct even behind a transaction-mode pooler
  (PgBouncer): the whole transaction runs on one pinned backend and the setting is
  reset when it ends. **Do not** use session-mode GUCs with transaction pooling.
  Local dev connects directly (no pooler).
- **Append-only audit log, three ways.** No `UPDATE`/`DELETE` policy (denied under
  `FORCE`), no `UPDATE`/`DELETE` privilege for `app_user`, and a trigger that
  raises on either — so even the owner can't quietly rewrite history.
- **`gen_random_uuid()` / `now()` defaults are DB-side**, so `app_user` needs no
  sequence privileges and raw inserts still satisfy `WITH CHECK`.

---

## Project layout

```
.
├─ docker-compose.yml                  # local Postgres (canonical)
├─ docker/postgres/init/01-app-user.sql# creates least-privileged app_user
├─ prisma/
│  ├─ schema.prisma                    # models (mirror of the SQL)
│  ├─ migrations/0001_init/migration.sql # tables + RLS + FORCE + policies + trigger + grants
│  ├─ migrations/0002_knowledge_base/migration.sql # pgvector + documents/chunks/chat_messages (+RLS, HNSW, grants)
│  └─ seed.ts                          # two demo tenants (writes via withTenant)
├─ fixtures/                           # tiny sample files per format (pdf/docx/md/txt + scan.pdf) for tests & demo
├─ scripts/
│  ├─ setup-local-db.sh                # no-Docker local DB helper (builds pgvector if missing)
│  ├─ demo-rag.ts                      # pnpm demo:rag — full RAG pipeline without HTTP/login
│  ├─ demo-ingest.ts                   # pnpm demo:ingest — PDF/DOCX/MD/TXT extraction → RAG answer from the PDF
│  ├─ demo-skill.ts                    # pnpm demo:skill — guardrail → approval → audit end-to-end
│  ├─ demo-policies.ts                 # pnpm demo:policies — threshold, never-failsafe, disclosure, role gate
│  └─ demo-slack.ts                    # pnpm demo:slack — signierte Slack-Requests gegen die drei Handler, ohne Slack-Account
├─ src/
│  ├─ middleware.ts                    # Clerk: require user + active org
│  ├─ lib/
│  │  ├─ prisma.ts                     # app_user client singleton
│  │  ├─ uuid.ts                       # UUID validation + clerkOrgId→uuid (v5)
│  │  ├─ tenant.ts                     # withTenant() — THE tenant boundary
│  │  ├─ audit.ts                      # logAudit()
│  │  ├─ org.ts                        # mirror Clerk org + membership
│  │  ├─ auth-context.ts               # requireTenant() — session → tenant context
│  │  ├─ ai/                           # provider abstraction: types + anthropic/voyage/fake adapters + factory
│  │  ├─ ingest/                       # extraction layer: PDF/DOCX/MD/TXT → text + meta (fail-closed)
│  │  ├─ rag/                          # chunking, ingestDocument, retrieve (disclosure filter), answerQuestion
│  │  ├─ skills/                       # skill engine: types, engine (policy→guardrail→approval→audit), catalog/
│  │  ├─ policies/                     # governance: approval policies, visibility grants, membership roles (admin-only, audited)
│  │  └─ slack/                        # Slack-Adapter: verify (Signatur), team (Team→Org, User→Rolle), handlers (ack-then-work), defer, idempotency, client, admin
│  └─ app/                             # minimal UI: sign-in/up, select-org, dashboard, knowledge, chat, settings (admin) + /api/slack/*
├─ tests/
│  ├─ isolation.test.ts                # THE canonical isolation gate
│  ├─ rag-isolation.test.ts            # Phase-2 gate: new tables + vector retrieval + RAG flow
│  ├─ retention.test.ts               # Phase-15 gate: Auto-Retention tenant-gebunden, org_settings RLS
│  ├─ rag-v2.test.ts                   # Phase-10 gate: Multi-Turn pro Actor (fail-closed), Re-Ingest
│  ├─ skill-effects.test.ts            # Phase-11 gate: Effekt nur nach Freigabe, Fake/Prod-Factory, PDF-Writer
│  ├─ skill-isolation.test.ts          # Phase-3 gate: skill tables + guardrail/approval semantics
│  ├─ policy.test.ts                   # Phase-4 gate: approval policies, disclosure, role gates, fail-closed
│  ├─ gdpr-scrub.test.ts              # Phase-14 gate: Detail-Scrubbing exakt/tenant-gebunden, Trigger-Regression
│  ├─ hardening.test.ts               # Phase-16 gate: CSP-Nonces/Enforce-Schalter, Fehler-Sink maskiert
│  ├─ ingest-ocr.test.ts              # Phase-17 gate: OCR fail-closed, Kosten-Guard, End-to-End
│  ├─ ingest.test.ts                   # Phase-5 gate: format extraction, fail-closed rejects, paragraph chunking
│  ├─ ops.test.ts                     # Phase-12 gate: Logger-Maskierung, queryAuditLog tenant-gebunden
│  ├─ settings.test.ts                 # settings gate: setMembershipRole (admin-only, tenant-scoped, last-admin guard, audit)
│  ├─ skill-catalog.test.ts            # catalog gate: read-only nie Freigabe + Disclosure, Angebot immer Freigabe, Rechnung-Schwelle
│  ├─ clerk-sync.test.ts              # Phase-8 gate: Svix-Signatur, Offboarding kaskadiert Slack-Link, role_source, user.deleted
│  ├─ lifecycle.test.ts               # Phase-7 gate: Löschpfade tenant-gebunden, Audit-Ausnahmen nur über die Gates
│  ├─ slack-prod.test.ts              # Phase-9 gate: Token-Aufloesung, Crypto, OAuth-State, Rate-Limit, Claim-Cleanup
│  ├─ slack.test.ts                    # Phase-6 gate: Signatur, Team→Org, User→Rolle, Disclosure via Slack, Buttons, RLS
│  └─ slack-ack.test.ts                # Phase-6b gate: Ack-vor-Arbeit, Gates vor Ack, Idempotenz pro Tenant, deferWork-Fehlerpfade
└─ .github/workflows/ci.yml            # runs the gate on every push/PR
```
