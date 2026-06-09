# ergane

A **GDPR-native, multi-tenant (B2B) foundation**. This repo is **Phase 0–1 only**:
the tenant-first fundament. There are **no business features** — just tenancy,
auth/orgs, RBAC, an append-only audit log, and the isolation test gate that
guards them.

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
│  └─ seed.ts                          # two demo tenants (writes via withTenant)
├─ scripts/setup-local-db.sh           # no-Docker local DB helper
├─ src/
│  ├─ middleware.ts                    # Clerk: require user + active org
│  ├─ lib/
│  │  ├─ prisma.ts                     # app_user client singleton
│  │  ├─ uuid.ts                       # UUID validation + clerkOrgId→uuid (v5)
│  │  ├─ tenant.ts                     # withTenant() — THE tenant boundary
│  │  ├─ audit.ts                      # logAudit()
│  │  ├─ org.ts                        # mirror Clerk org + membership
│  │  └─ auth-context.ts               # requireTenant() — session → tenant context
│  └─ app/                             # minimal UI: sign-in/up, select-org, dashboard
├─ tests/isolation.test.ts             # THE 5-test isolation gate
└─ .github/workflows/ci.yml            # runs the gate on every push/PR
```
