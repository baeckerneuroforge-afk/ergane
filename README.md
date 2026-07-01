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
├─ scripts/
│  ├─ setup-local-db.sh                # no-Docker local DB helper (builds pgvector if missing)
│  ├─ demo-rag.ts                      # pnpm demo:rag — full RAG pipeline without HTTP/login
│  ├─ demo-skill.ts                    # pnpm demo:skill — guardrail → approval → audit end-to-end
│  └─ demo-policies.ts                 # pnpm demo:policies — threshold, never-failsafe, disclosure, role gate
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
│  │  ├─ rag/                          # chunking, ingestDocument, retrieve (disclosure filter), answerQuestion
│  │  ├─ skills/                       # skill engine: types, engine (policy→guardrail→approval→audit), catalog/
│  │  └─ policies/                     # governance: approval policies, visibility grants (admin-only, audited)
│  └─ app/                             # minimal UI: sign-in/up, select-org, dashboard, knowledge, chat
├─ tests/
│  ├─ isolation.test.ts                # THE canonical isolation gate
│  ├─ rag-isolation.test.ts            # Phase-2 gate: new tables + vector retrieval + RAG flow
│  ├─ skill-isolation.test.ts          # Phase-3 gate: skill tables + guardrail/approval semantics
│  └─ policy.test.ts                   # Phase-4 gate: approval policies, disclosure, role gates, fail-closed
└─ .github/workflows/ci.yml            # runs the gate on every push/PR
```
