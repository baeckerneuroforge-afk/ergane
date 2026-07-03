// =============================================================================
// SKILL-KATALOG GATE ("ein Motor, viele Skills")
//
// Extends — never replaces — the canonical gates. Same harness as
// policy.test.ts: runs as `app_user`, owner connection only to reset,
// deterministic fakes, no network. NOTHING here touches the engine — the three
// new skills are pure SkillDef data; this suite proves the ENGINE's existing
// semantics carry them:
//
//   1. wissen_zusammenfassen (read-only): NEVER pauses for approval, always
//      reaches completed; retrieval respects disclosure (member does not see
//      confidential — and the result does not leak the hidden document);
//      grounded results carry the canonical sources format.
//   2. angebot_erstellen (external effect): ALWAYS pauses in awaiting_approval
//      — even for a tiny amount — because the guardrail reason is external
//      communication, not money. Without approval nothing is "versendet".
//   3. rechnung_erstellen (money): amount guardrail like beleg_kontieren —
//      below the limit straight through, above it approval first.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import { ingestDocument, NO_KNOWLEDGE_ANSWER, SOURCES_MARKER } from '../src/lib/rag';
import { approve, startRun } from '../src/lib/skills';
import { RECHNUNG_GUARDRAIL_LIMIT_EUR } from '../src/lib/skills/catalog/rechnung_erstellen';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

const ADMIN_A = 'a_admin';
const LEAD_A = 'a_lead';

const HANDBUCH = {
  title: 'Urlaubshandbuch',
  text: 'Mitarbeitende haben Anspruch auf 30 Urlaubstage pro Kalenderjahr laut Urlaubsrichtlinie.',
};
const SALARY_DOC = {
  title: 'Gehaltsband 2026',
  text: 'Gehaltsband Senior Engineer 2026: 90000 bis 120000 Euro Jahresgehalt.',
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrg() {
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({
      data: { id: ORG_A, clerkOrgId: 'org_cat_a', name: 'Catalog Org A' },
    });
    await tx.membership.createMany({
      data: [
        { orgId: ORG_A, userId: ADMIN_A, role: 'admin' },
        { orgId: ORG_A, userId: LEAD_A, role: 'lead' },
        { orgId: ORG_A, userId: 'a_member', role: 'member' },
      ],
    });
    // Disclosure wie policy.test.ts: confidential → nur admin.
    await tx.visibilityGrant.create({
      data: { orgId: ORG_A, level: 'confidential', role: 'admin' },
    });
  });
  await ingestDocument({
    orgId: ORG_A, actorId: ADMIN_A, source: 'manual', visibility: 'open', ...HANDBUCH,
  });
  await ingestDocument({
    orgId: ORG_A, actorId: ADMIN_A, source: 'manual', visibility: 'confidential', ...SALARY_DOC,
  });
}

async function stepsOf(runId: string) {
  return withTenant(ORG_A, (tx) =>
    tx.skillStep.findMany({ where: { runId }, orderBy: { idx: 'asc' } }),
  );
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  await seedOrg();
});

describe('wissen_zusammenfassen (read-only: nie Freigabe, Disclosure gilt)', () => {
  it('reaches completed directly, creates NO approval, and carries canonical sources', async () => {
    const run = await startRun(ORG_A, 'wissen_zusammenfassen', {
      frage: 'Wie viele Urlaubstage pro Kalenderjahr laut Urlaubsrichtlinie?',
      rolle: 'member',
    });
    expect(run.status).toBe('completed');

    // Strukturell freigabefrei: kein approval, kein awaiting-Zwischenzustand.
    const approvals = await withTenant(ORG_A, (tx) => tx.approval.findMany());
    expect(approvals).toHaveLength(0);

    const result = await withTenant(ORG_A, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: run.runId } }),
    );
    const ausgabe = (result.result as Record<string, { text?: string; quellen?: string[] }>)
      .ausgegeben;
    expect(ausgabe?.quellen).toContain(HANDBUCH.title);
    // Kanonisches Quellen-Format des RAG-Layers.
    expect(ausgabe?.text).toContain(`${SOURCES_MARKER} ${HANDBUCH.title}`);
  });

  it('member does NOT see confidential knowledge — honest no-knowledge answer, no leak', async () => {
    // Verbatim-Query auf das confidential-Dokument: als member unsichtbar.
    const run = await startRun(ORG_A, 'wissen_zusammenfassen', {
      frage: SALARY_DOC.text,
      rolle: 'member',
    });
    expect(run.status).toBe('completed'); // read-only: auch "kein Wissen" pausiert nie

    const result = await withTenant(ORG_A, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: run.runId } }),
    );
    const state = result.result as Record<string, Record<string, unknown>>;
    const text = String(state.ausgegeben?.text ?? '');
    expect(text).toContain(NO_KNOWLEDGE_ANSWER);
    expect(text).not.toContain(SALARY_DOC.title);
    expect(text).not.toContain('Gehaltsband');
    expect(state.ausgegeben?.quellen).toEqual([]);

    // Positive Kontrolle: admin (mit Grant) sieht das Dokument über denselben Skill.
    const asAdmin = await startRun(ORG_A, 'wissen_zusammenfassen', {
      frage: SALARY_DOC.text,
      rolle: 'admin',
    });
    const adminResult = await withTenant(ORG_A, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: asAdmin.runId } }),
    );
    const adminState = adminResult.result as Record<string, Record<string, unknown>>;
    expect(adminState.ausgegeben?.quellen).toContain(SALARY_DOC.title);
  });

  it('missing/unknown rolle ⇒ fail-closed: only open documents', async () => {
    const run = await startRun(ORG_A, 'wissen_zusammenfassen', {
      frage: SALARY_DOC.text,
      // keine rolle
    });
    expect(run.status).toBe('completed');
    const result = await withTenant(ORG_A, (tx) =>
      tx.skillRun.findUniqueOrThrow({ where: { id: run.runId } }),
    );
    const state = result.result as Record<string, Record<string, unknown>>;
    expect(String(state.ausgegeben?.text ?? '')).not.toContain('Gehaltsband');
  });
});

describe('angebot_erstellen (externe Wirkung: IMMER Freigabe, unabhängig vom Betrag)', () => {
  it('pauses in awaiting_approval even for a tiny amount; nothing is versendet', async () => {
    const run = await startRun(ORG_A, 'angebot_erstellen', {
      kunde: 'Testkunde GmbH',
      leistung: 'Kleinauftrag',
      betragEur: 1, // weit unter jeder Geld-Schwelle — Grund ist die externe Wirkung
      rolle: 'lead',
    });
    expect(run.status).toBe('awaiting_approval');

    const approval = await withTenant(ORG_A, (tx) =>
      tx.approval.findFirstOrThrow({ where: { runId: run.runId } }),
    );
    expect(approval.reason).toMatch(/[Ee]xternal communication/);

    // Die lesenden Schritte liefen, der handelnde nicht.
    const steps = await stepsOf(run.runId);
    expect(steps.map((s) => s.name)).toEqual(['konditionen_geholt', 'angebot_entworfen']);
    expect(steps.some((s) => s.name === 'versendet')).toBe(false);
  });

  it('after approve the run completes and versendet exists (simuliert)', async () => {
    const run = await startRun(ORG_A, 'angebot_erstellen', {
      kunde: 'Hanse Logistik GmbH',
      leistung: 'Projektunterstützung',
      betragEur: 4800,
      rolle: 'lead',
    });
    expect(run.status).toBe('awaiting_approval');

    const resumed = await approve(ORG_A, run.runId, LEAD_A);
    expect(resumed.status).toBe('completed');

    const steps = await stepsOf(run.runId);
    const versendet = steps.find((s) => s.name === 'versendet');
    expect(versendet?.status).toBe('done');
    expect(versendet?.detail).toMatchObject({ versendet: true, simuliert: true });
  });
});

describe('rechnung_erstellen (Geld: Betrag-Guardrail wie beleg_kontieren)', () => {
  it('below the limit runs straight through to completed', async () => {
    const run = await startRun(ORG_A, 'rechnung_erstellen', {
      kunde: 'Baltic Trading UG',
      positionen: [{ bezeichnung: 'Workshoptag', betragEur: RECHNUNG_GUARDRAIL_LIMIT_EUR - 100 }],
      rolle: 'lead',
    });
    expect(run.status).toBe('completed');

    const steps = await stepsOf(run.runId);
    expect(steps.map((s) => s.name)).toEqual([
      'stammdaten_geprueft', 'rechnung_erzeugt', 'gebucht_versendet',
    ]);
  });

  it('above the limit pauses; approve resumes to completed', async () => {
    const run = await startRun(ORG_A, 'rechnung_erstellen', {
      kunde: 'Möbelwerk Nord GmbH',
      positionen: [
        { bezeichnung: 'Beratungsleistung', betragEur: 1800 },
        { bezeichnung: 'Workshoptag', betragEur: 950 },
      ],
      rolle: 'lead',
    });
    expect(run.status).toBe('awaiting_approval');

    // Der handelnde Schritt lief nachweislich nicht.
    let steps = await stepsOf(run.runId);
    expect(steps.some((s) => s.name === 'gebucht_versendet')).toBe(false);

    const resumed = await approve(ORG_A, run.runId, LEAD_A);
    expect(resumed.status).toBe('completed');
    steps = await stepsOf(run.runId);
    expect(steps.find((s) => s.name === 'gebucht_versendet')?.detail).toMatchObject({
      gebucht: true,
      summeEur: 2750,
      simuliert: true,
    });
  });

  it('a summeEur that contradicts the positions fails the run before anything acts', async () => {
    const run = await startRun(ORG_A, 'rechnung_erstellen', {
      kunde: 'Baltic Trading UG',
      positionen: [{ bezeichnung: 'Workshoptag', betragEur: 500 }],
      summeEur: 400, // widerspricht den Positionen
      rolle: 'lead',
    });
    expect(run.status).toBe('failed');

    const steps = await stepsOf(run.runId);
    expect(steps[0]?.name).toBe('stammdaten_geprueft');
    expect(steps[0]?.status).toBe('failed');
    expect(steps.some((s) => s.name === 'gebucht_versendet')).toBe(false);
  });
});
