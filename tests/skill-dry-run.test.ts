// =============================================================================
// SKILL DRY-RUN / SIMULATION GATE ("Probelauf")
//
// A run started with mode='simulation' must walk the WHOLE skill exactly like a
// live run — retrieval, context, guardrail evaluation and the approval-need
// check all run and are recorded — but every ACTING step is SIMULATED instead
// of executed: nothing leaves the system and the run NEVER pauses. This suite
// proves the four load-bearing properties (Definition of Done):
//
//   (a) an acting step is NOT executed in a dry-run (no e-mail leaves; the real
//       step.run() never runs — only a simulated record with what WOULD happen).
//   (b) the guardrail is STILL evaluated in a dry-run and its verdict is shown —
//       incl. the MONEY failsafe: >1,000 EUR shows "would require approval".
//   (c) the audit marks a simulation as mode='simulation' (live stays unchanged).
//   (d) a simulation is never counted as a live run (mode-filtered aggregation).
//
// Same harness as skill-effects.test.ts: runs as `app_user`, owner connection
// only to reset, deterministic fake e-mail provider, no network.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { approve, startRun } from '../src/lib/skills';
import { getFakeEmailProvider } from '../src/lib/effects';
import { GUARDRAIL_REASON } from '../src/lib/skills/catalog/beleg_kontieren';

const ORG = 'd1d1d1d1-d1d1-4d1d-8d1d-d1d1d1d1d1d1';
const APPROVER = 'dr_lead';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fake = getFakeEmailProvider();

const ANGEBOT_INPUT = {
  kunde: 'Hanse Logistik GmbH',
  leistung: 'Projektunterstützung Q3',
  betragEur: 4800,
  email: 'einkauf@kunde.example',
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

/** Detail of a named step as a plain object (jsonb), for assertions. */
async function stepDetail(runId: string, name: string): Promise<Record<string, unknown>> {
  const step = await withTenant(ORG, (tx) =>
    tx.skillStep.findFirstOrThrow({ where: { runId, name } }),
  );
  return (step.detail ?? {}) as Record<string, unknown>;
}

async function stepNames(runId: string): Promise<string[]> {
  const steps = await withTenant(ORG, (tx) =>
    tx.skillStep.findMany({ where: { runId }, orderBy: { idx: 'asc' } }),
  );
  return steps.map((s) => s.name);
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  delete process.env.RESEND_API_KEY; // fake provider, no network — always
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  fake.reset();
  await reset();
  await withTenant(ORG, async (tx) => {
    await tx.organization.create({ data: { id: ORG, clerkOrgId: 'org_dr', name: 'Dry-run Org' } });
    await tx.membership.create({ data: { orgId: ORG, userId: APPROVER, role: 'lead' } });
  });
});

// --- (a) acting steps are simulated, never executed ------------------------------------

describe('(a) a dry-run simulates acting steps — nothing acts', () => {
  it('angebot_erstellen: NO e-mail leaves, the run completes without an approval, and the acting step is recorded as simulated (real run() never ran)', async () => {
    const handle = await startRun(ORG, 'angebot_erstellen', ANGEBOT_INPUT, { mode: 'simulation' });

    // A simulation walks to the end; it never pauses in awaiting_approval.
    expect(handle.status).toBe('completed');
    expect(fake.sent).toHaveLength(0); // (a) the effect NEVER fired

    const run = await withTenant(ORG, (tx) => tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }));
    expect(run.mode).toBe('simulation');

    // A dry-run must NOT create a real, human-clearable approval.
    const approvals = await withTenant(ORG, (tx) => tx.approval.findMany({ where: { runId: handle.runId } }));
    expect(approvals).toHaveLength(0);

    // Read-only steps ran for real; the acting step is present but simulated.
    expect(await stepNames(handle.runId)).toEqual(['konditionen_geholt', 'angebot_entworfen', 'versendet']);
    const versendet = await stepDetail(handle.runId, 'versendet');
    expect(versendet).toMatchObject({ simulated: true, acts: true });
    // Proof the real run() did NOT run: none of its result keys are present.
    expect(versendet).not.toHaveProperty('emailProvider');
    expect(versendet).not.toHaveProperty('emailId');
    expect(versendet).not.toHaveProperty('simuliert');
    // But the preview says what WOULD have happened.
    expect(versendet.effectPreview).toMatchObject({
      empfaengerEmail: 'einkauf@kunde.example',
      wuerdeEchtVersenden: true,
    });
  });

  it('contrast — the SAME input as a LIVE run pauses for approval and, after approve, sends exactly one mail', async () => {
    const live = await startRun(ORG, 'angebot_erstellen', ANGEBOT_INPUT, { mode: 'live' });
    expect(live.status).toBe('awaiting_approval');
    expect(fake.sent).toHaveLength(0);

    const resumed = await approve(ORG, live.runId, APPROVER);
    expect(resumed.status).toBe('completed');
    expect(fake.sent).toHaveLength(1); // live really acts — proves the dry-run diverged
  });
});

// --- (b) guardrails still fire in a dry-run (money failsafe stays visible) --------------

describe('(b) guardrails are still evaluated in a dry-run', () => {
  it('beleg_kontieren over 1,000 EUR: the acting step is NOT executed, yet the MONEY guardrail is shown as "would require approval" with the same reason a live run would show', async () => {
    const handle = await startRun(
      ORG,
      'beleg_kontieren',
      { beschreibung: 'Messestand Hannover', betragEur: 1500 },
      { mode: 'simulation' },
    );
    expect(handle.status).toBe('completed'); // simulation walks through; never pauses

    // The read-only steps ran normally (retrieval/context "laufen normal").
    expect(await stepNames(handle.runId)).toEqual([
      'beleg_gelesen', 'konto_vorgeschlagen', 'buchung_vorbereitet', 'verbucht',
    ]);
    const konto = await stepDetail(handle.runId, 'konto_vorgeschlagen');
    expect(konto.konto).toBeDefined(); // a read step actually computed something

    const verbucht = await stepDetail(handle.runId, 'verbucht');
    // Acting step simulated; the real effect (verbucht: true) never ran.
    expect(verbucht).toMatchObject({ simulated: true, acts: true, wouldRequireApproval: true });
    expect(verbucht).not.toHaveProperty('verbucht');
    // The MONEY guardrail is visible — exactly the reason a live run would show.
    expect(String(verbucht.gateReason)).toContain('1,000 EUR');
    expect(verbucht.gateReason).toBe(GUARDRAIL_REASON);
    // And the audit records the simulated act with the guardrail verdict.
    const audit = await withTenant(ORG, (tx) =>
      tx.auditLog.findMany({ where: { action: 'skill.simulated_act' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.detail).toMatchObject({ mode: 'simulation', wouldRequireApproval: true });
    // No real approval row was created for the simulation.
    const approvals = await withTenant(ORG, (tx) => tx.approval.findMany({ where: { runId: handle.runId } }));
    expect(approvals).toHaveLength(0);
  });

  it('below the limit: the guardrail is evaluated but not triggered (wouldRequireApproval=false)', async () => {
    const handle = await startRun(
      ORG,
      'beleg_kontieren',
      { beschreibung: 'Bürobedarf Toner', betragEur: 200 },
      { mode: 'simulation' },
    );
    expect(handle.status).toBe('completed');
    const verbucht = await stepDetail(handle.runId, 'verbucht');
    expect(verbucht).toMatchObject({ simulated: true, wouldRequireApproval: false });
  });
});

// --- (c) audit clearly distinguishes a simulation --------------------------------------

describe('(c) a simulation is clearly marked in the audit trail', () => {
  it('skill.started and skill.completed carry mode=simulation', async () => {
    const handle = await startRun(
      ORG,
      'beleg_kontieren',
      { beschreibung: 'Bürobedarf', betragEur: 200 },
      { mode: 'simulation' },
    );
    const audit = await withTenant(ORG, (tx) =>
      tx.auditLog.findMany({ where: { action: { startsWith: 'skill.' } }, orderBy: { createdAt: 'asc' } }),
    );
    const started = audit.find((a) => a.action === 'skill.started');
    const completed = audit.find((a) => a.action === 'skill.completed');
    expect(started?.detail).toMatchObject({ mode: 'simulation' });
    expect(completed?.detail).toMatchObject({ mode: 'simulation' });
    void handle;
  });

  it('a LIVE run is unchanged: its audit entries carry no mode detail', async () => {
    await startRun(ORG, 'beleg_kontieren', { beschreibung: 'Bürobedarf', betragEur: 200 }, { mode: 'live' });
    const started = await withTenant(ORG, (tx) =>
      tx.auditLog.findFirstOrThrow({ where: { action: 'skill.started' } }),
    );
    expect(started.detail).toBeNull();
  });
});

// --- (d) a simulation is never a live run ----------------------------------------------

describe('(d) a simulation never counts as a live run', () => {
  it('mode-filtered aggregations exclude simulation runs', async () => {
    // One live run (200 EUR < limit ⇒ completes) and one simulation.
    await startRun(ORG, 'beleg_kontieren', { beschreibung: 'Bürobedarf', betragEur: 200 }, { mode: 'live' });
    await startRun(ORG, 'beleg_kontieren', { beschreibung: 'Bürobedarf', betragEur: 200 }, { mode: 'simulation' });

    const counts = await withTenant(ORG, async (tx) => ({
      total: await tx.skillRun.count(),
      live: await tx.skillRun.count({ where: { mode: 'live' } }),
      simulation: await tx.skillRun.count({ where: { mode: 'simulation' } }),
    }));
    expect(counts.total).toBe(2);
    expect(counts.live).toBe(1); // the simulation is NOT counted as a live run
    expect(counts.simulation).toBe(1);
  });

  it('mode defaults to live when startRun is called without options (backward compatible)', async () => {
    const handle = await startRun(ORG, 'beleg_kontieren', { beschreibung: 'Bürobedarf', betragEur: 200 });
    const run = await withTenant(ORG, (tx) => tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }));
    expect(run.mode).toBe('live');
  });
});
