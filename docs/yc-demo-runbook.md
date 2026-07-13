# YC demo runbook (helix)

Operational script for a **6–8 minute live pitch**. Aligns with the product as shipped; no invented features.

## Before every call (15 min)

```
[ ] pnpm dev or staging up
[ ] Clerk login as demo user (org slug demo / nordwind, or DEMO_ORG_SLUGS)
[ ] Optional: pnpm seed:demo  (Nordwind data + client "Hanse Logistik GmbH")
[ ] Cockpit shows "YC demo path" card if org is allowlisted
[ ] If AI keys unset: amber banner "Demo / offline AI providers" is expected
[ ] Fallback tab: /demo/isolation + /dashboard/approvals + /dashboard/audit
```

### Clerk allowlist for demo UI + isolation

Built-in: `demo`, `nordwind`, `demo_org_a`, `demo_org_b`, `demo_org_nordwind`.  
Add your live Clerk org: `DEMO_ORG_SLUGS=your-slug` or set org slug to `demo`.

Seed org constants (`scripts/seed-demo.ts`):

| Field | Value |
|--------|--------|
| Internal UUID | `99999999-9999-4999-8999-999999999999` |
| clerkOrgId | `demo_org_nordwind` |
| Name | Nordwind GmbH |
| Demo client | Hanse Logistik GmbH |

**Note:** Seed writes DB rows under that fixed org id. Your Clerk session maps to an org via `ensureOrgAndMembership` + `clerkOrgIdToUuid`. For UI + seed data to match, either point Clerk at the same derived UUID workflow used in production, or re-ingest demo content under your live Clerk org. Isolation demo uses **separate** fixed orgs A/B (`demo_org_a` / `demo_org_b`).

### Clerk ↔ seed bridge (how to see Nordwind in the UI)

1. Create a Clerk Organization with slug `demo` or `nordwind` (or set `DEMO_ORG_SLUGS=your-slug`).
2. In Clerk Dashboard, note the org id (`org_…`).
3. helix stores orgs as **UUID v5** of that Clerk id (`clerkOrgIdToUuid` in `src/lib/uuid.ts`).
4. **One-command seed into your live Clerk org** (no code edits):

```bash
# Recommended: seed into the org your session uses
export DEMO_CLERK_ORG_ID=org_xxxxxxxx          # real Clerk org id
# optional display name:
export DEMO_ORG_NAME="Nordwind GmbH"
pnpm seed:demo
```

Optional overrides:

| Env | Effect |
|-----|--------|
| `DEMO_CLERK_ORG_ID` or `DEMO_CLERK_ORG` | Clerk org id; internal UUID is derived automatically |
| `DEMO_ORG_ID` | Force internal org UUID (must be a UUID) |
| `DEMO_ORG_NAME` | Organization display name in seed |

Without env vars, seed uses the built-in Nordwind constants (`demo_org_nordwind` + fixed UUID) for CLI/screenshots.

5. Isolation proof: open `/demo/isolation` only when the session org is allowlisted — the demo guidance card includes that step only for demo orgs.

### Guaranteed approve moment

Seed always leaves at least one **pending** approval (e.g. `angebot_erstellen` for Hanse Logistik and a high `beleg_kontieren` / open invoice). On `/dashboard/approvals` you should see pending cards after seed without extra clicks.

## 7-minute click path

| Min | Route | Say | Show |
|-----|--------|-----|------|
| 0:00 | Opening | Company brain that acts — isolation in Postgres, not app discipline | — |
| 0:30 | `/dashboard/knowledge` | Tenant + role visibility | Docs, open/restricted/confidential |
| 1:30 | `/dashboard/chat` | Answers with sources only | Source chips, answer trace |
| 2:30 | Disclosure (explain or role switch) | Salary bands stay confidential for members | SQL filter before LLM |
| 3:30 | `/dashboard/skills` | Optional client link | Hanse Logistik if seeded |
| 4:00 | High-value skill | e.g. offer / receipt over threshold | `awaiting_approval` |
| 4:45 | `/dashboard/approvals` | Four-eyes, then resume | Approve → completed |
| 5:30 | `/dashboard/clients` | Tracker: runs per client | Linked run for Hanse |
| 6:15 | `/demo/isolation` | Cross-tenant blocked by RLS | Live probe |
| 6:45 | Close | Pilot 2026 | `/pilot` |

## Fallback matrix

| Failure | Do instead |
|---------|------------|
| No AI keys / fake banner | State offline fakes; keep Knowledge, Approvals, Clients, Isolation |
| Chat/skill API timeout | Pre-seeded runs from `pnpm seed:demo`; show timeline + audit |
| Isolation 404 | Org not allowlisted — use Security page + audit + README architecture |
| Empty tenant | Re-run seed or paste sample docs from seed script |
| Connectors question | Honest: not shipped; Slack + skills + knowledge live today |

## Offline / fake AI

`isUsingFakeAiProviders()` is true when `ANTHROPIC_API_KEY` or `VOYAGE_API_KEY` is missing (dev). Production refuses fakes. Banner appears in the dashboard chrome automatically.

## Commands

| Purpose | Command |
|---------|---------|
| Demo seed | `pnpm seed:demo` |
| App | `pnpm dev` |
| Tests | `pnpm test` |
| Isolation (demo org only) | `/demo/isolation` |

## Do not overclaim

- Connectors page is coming soon — not live Linear/GitHub.
- Some skill effects may be simulated (no DATEV) unless Resend/Blob configured.
- Legal pages are pilot-stage; full imprint registry data is TBD.

## Story one-liners

1. Problem: knowledge and work live in tools; ungoverned AI is not enterprise.  
2. Product: knowledge → skills with approval → audit, multi-tenant by database.  
3. Moat: RLS + FORCE + governance, not the model.  
4. Ask: pilot seats 2026 (`/pilot`, pilot@helix.ai).
