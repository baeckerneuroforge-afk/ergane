// =============================================================================
// TRANSKRIPT → FRAMEWORK: der erste GENERATIVE Deliverable-Skill (Etappe 1)
//
// Beweist die vier tragenden Eigenschaften (Definition of Done):
//
//   (a) der Skill erzeugt AUS TRANSKRIPT-KONTEXT ein strukturiertes Framework
//       (Markdown, mit sprachrichtiger Rahmung und kanonischer Quellen-Zeile,
//       gegründet auf die Transkripte).
//   (b) der LLM-Call läuft AUSSERHALB der withTenant-Transaktion (die nicht
//       verhandelbare Regel): zum Zeitpunkt des Calls ist KEIN Tenant-Tx-Kontext
//       gesetzt (app.current_org leer) UND die eine Test-Connection ist frei —
//       liefe der Call in der 15s-Tx, wäre die Connection gepinnt (Timeout-Risiko).
//   (c) der Lauf PAUSIERT zur menschlichen Freigabe (awaiting_approval, der
//       generative Output ist noch nicht final) und läuft nach approve() weiter
//       bis completed; reject() finalisiert nie.
//   (d) TENANT-ISOLIERT: der Skill sieht nur die eigenen Transkripte — das
//       Framework von Org A gründet nie auf den Transkripten von Org B.
//
// Harness wie skill-effects/skill-dry-run: läuft als `app_user`, Owner-Connection
// nur zum Reset. KEIN Netzwerk: der ChatProvider wird per __setChatProviderForTests
// durch einen deterministischen, instrumentierten Fake ersetzt (CI ruft nie eine
// echte API — unabhängig davon, ob ANTHROPIC_API_KEY gesetzt ist).
// =============================================================================
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { approve, reject, startRun } from '../src/lib/skills';
import { __setChatProviderForTests, type ChatCompletionRequest, type ChatProvider } from '../src/lib/ai';
import { ingestDocument } from '../src/lib/rag';
import { FRAMEWORK_GUARDRAIL_REASON } from '../src/lib/skills/catalog/transkript_zu_framework';

const ORG_A = 'fafafafa-fafa-4afa-8afa-fafafafafafa';
const ORG_B = 'fbfbfbfb-fbfb-4bfb-8bfb-fbfbfbfbfbfb';
const APPROVER = 'tf_lead';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

// Zwei thematisch klar getrennte Transkripte, damit das Bag-of-Words-Fake-
// Embedding echte Ähnlichkeit erzeugt (geteiltes Vokabular = höhere Cosine).
const TRANSCRIPT_A = [
  'Kickoff-Transkript Kunde Nordwind: der Kunde will die Produkteinführung seiner',
  'neuen Logistik-Software beschleunigen. Kernthema Onboarding der Lager-Teams,',
  'Automatisierung der Wareneingangs-Buchung und ein klarer Rollout-Plan.',
  'Der Kunde nannte drei Wünsche: Schulungen, Dashboards und einen Pilotstandort.',
].join(' ');

const TRANSCRIPT_B_OTHER_TENANT = [
  'Beratungsgespräch Firma Südstern über Krankenhaus-Hygiene und Sterilgut-Logistik.',
  'Völlig anderes Thema: OP-Bestecke, Sterilisation, Chargenverfolgung im Klinikum.',
].join(' ');

/**
 * Deterministischer, instrumentierter Fake-ChatProvider.
 *  - erzeugt STRUKTURIERTES Markdown (Executive Summary + drei "## "-Abschnitte),
 *    das die gelieferten Kontext-Titel spiegelt → prüfbare "aus Transkript"-Bindung.
 *  - beweist DIE REGEL: bei jedem complete() prüft er über den EIGENSTÄNDIGEN
 *    prisma-Client (nicht tx!), dass KEIN Tenant-Tx-Kontext gesetzt ist. Da der
 *    Call im prepare()-Hook VOR jeder withTenant-Tx läuft, ist app.current_org
 *    leer und die (in Tests einzige) Connection frei; liefe er in der Tx, würde
 *    diese Abfrage entweder den Org-Kontext sehen ODER auf der gepinnten
 *    Connection blockieren.
 */
class InstrumentedFakeChat implements ChatProvider {
  readonly name = 'instrumented-fake';
  /** Aufzeichnung pro complete(): war ein Tenant-Tx-Kontext aktiv? */
  readonly calls: Array<{ orgContextDuringCall: string | null; lastUser: string }> = [];

  reset(): void {
    this.calls.length = 0;
  }

  async complete(req: ChatCompletionRequest): Promise<string> {
    // BEWEIS (b): eine unabhängige Abfrage über den globalen Client. Läuft nur
    // durch, weil KEINE withTenant-Tx die einzige Test-Connection pinnt; und
    // sie sieht app.current_org NICHT, weil sie außerhalb jeder Tenant-Tx ist.
    const [{ org }] = await prisma.$queryRaw<Array<{ org: string | null }>>`
      SELECT current_setting('app.current_org', true) AS org
    `;
    const lastUser = [...req.messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    this.calls.push({ orgContextDuringCall: org && org.length > 0 ? org : null, lastUser });

    // Kontext-Titel aus den [Titel]-Präfixen der User-Nachricht ziehen und im
    // Framework spiegeln — so ist die "aus Transkript"-Bindung im Output prüfbar.
    const titles = [...lastUser.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1]);
    const firstTitle = titles[0] ?? 'transcript';
    return [
      `Executive summary: based on ${titles.length} transcript excerpt(s), here is the framework.`,
      '',
      '## Situation',
      `Grounded in ${firstTitle}.`,
      '',
      '## Key themes',
      '- Onboarding',
      '- Automation',
      '- Rollout',
      '',
      '## Recommendations / use cases',
      '1. Training',
      '2. Dashboards',
      '3. Pilot site',
    ].join('\n');
  }
}

const fakeChat = new InstrumentedFakeChat();

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrg(orgId: string, clerkOrgId: string, name: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
    await tx.membership.create({ data: { orgId, userId: APPROVER, role: 'lead' } });
  });
}

/** Detail eines benannten Steps als plain object (jsonb), für Assertions. */
async function stepDetail(orgId: string, runId: string, name: string): Promise<Record<string, unknown>> {
  const step = await withTenant(orgId, (tx) =>
    tx.skillStep.findFirstOrThrow({ where: { runId, name } }),
  );
  return (step.detail ?? {}) as Record<string, unknown>;
}

async function stepNames(orgId: string, runId: string): Promise<string[]> {
  const steps = await withTenant(orgId, (tx) =>
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
  // CI/offline: NIE die echte Anthropic-API. Der instrumentierte Fake ersetzt
  // den Provider unabhängig vom gesetzten ANTHROPIC_API_KEY.
  __setChatProviderForTests(fakeChat);
  await reset();
});

afterAll(async () => {
  __setChatProviderForTests(null); // Override zurücknehmen
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  fakeChat.reset();
  await reset();
  await seedOrg(ORG_A, 'org_tf_a', 'Framework Org A');
  await seedOrg(ORG_B, 'org_tf_b', 'Framework Org B');
});

afterEach(() => {
  fakeChat.reset();
});

// --- (a) strukturiertes Framework aus Transkript-Kontext --------------------------------

describe('(a) erzeugt aus Transkript-Kontext ein strukturiertes Framework', () => {
  it('lädt Transkript-Kontext, entwirft Markdown und rahmt es mit Kopf + kanonischer Quellen-Zeile', async () => {
    await ingestDocument({
      orgId: ORG_A,
      actorId: 'seed',
      title: 'Kickoff Nordwind',
      source: 'transcript',
      text: TRANSCRIPT_A,
    });

    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Produkteinführung Logistik-Software Nordwind',
      fokus: 'Produkteinführung',
    });
    // Generativer Deliverable ⇒ pausiert vor der finalen Ausgabe.
    expect(handle.status).toBe('awaiting_approval');

    // Der Kontext-Step hat Transkript-Treffer gefunden.
    const kontext = await stepDetail(ORG_A, handle.runId, 'transkript_kontext');
    expect(Number(kontext.trefferAnzahl)).toBeGreaterThan(0);
    expect(kontext.quellen).toContain('Kickoff Nordwind');

    // Der generative Step hat ein Framework erzeugt (VOR der Freigabe schon
    // entworfen; nur die finale Ausgabe wartet auf approve()).
    const entwurf = await stepDetail(ORG_A, handle.runId, 'framework_entworfen');
    expect(entwurf.generiert).toBe(true);
    const markdown = String(entwurf.markdown);
    expect(markdown).toContain('## Situation');
    expect(markdown).toContain('## Recommendations / use cases');
    expect(markdown).toContain('Executive summary');
    // Aus dem Transkript gegründet: der Titel des Transkripts taucht auf.
    expect(markdown).toContain('Kickoff Nordwind');
    expect(entwurf.quellen).toContain('Kickoff Nordwind');

    // Nach Freigabe: finale Ausgabe mit Kopf (Framework/Fokus) + Quellen-Zeile.
    const resumed = await approve(ORG_A, handle.runId, APPROVER);
    expect(resumed.status).toBe('completed');
    const out = await stepDetail(ORG_A, handle.runId, 'framework_ausgegeben');
    expect(out.generiert).toBe(true);
    const text = String(out.text);
    expect(text).toContain('Framework: Produkteinführung Logistik-Software Nordwind');
    expect(text).toContain('Focus: Produkteinführung');
    expect(text).toContain('## Key themes');
    expect(text.trimEnd().endsWith('Sources: Kickoff Nordwind')).toBe(true);
  });

  it('ohne Transkript-Kontext: ehrliche Notiz, KEIN LLM-Call, KEINE Quellen', async () => {
    // Kein Transkript ingestiert ⇒ Retrieval leer.
    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Thema ohne jegliche Grundlage im System',
      fokus: 'Beratungs-Framework',
    });
    expect(handle.status).toBe('awaiting_approval'); // Guardrail triggert dennoch immer

    const entwurf = await stepDetail(ORG_A, handle.runId, 'framework_entworfen');
    expect(entwurf.generiert).toBe(false);
    // Ehrlichkeits-Regel: ohne Kontext wurde der LLM NICHT aufgerufen.
    expect(fakeChat.calls).toHaveLength(0);

    const resumed = await approve(ORG_A, handle.runId, APPROVER);
    expect(resumed.status).toBe('completed');
    const out = await stepDetail(ORG_A, handle.runId, 'framework_ausgegeben');
    expect(out.generiert).toBe(false);
    expect(out.quellen).toEqual([]);
    expect(String(out.text)).not.toContain('Sources:');
  });
});

// --- (b) LLM läuft AUSSERHALB der withTenant-Transaktion -------------------------------

describe('(b) der LLM-Call läuft ausserhalb der Tenant-Transaktion (die nicht verhandelbare Regel)', () => {
  it('kein Tenant-Tx-Kontext während des Calls; und die generative skill_step existiert zum Call-Zeitpunkt noch nicht', async () => {
    await ingestDocument({
      orgId: ORG_A,
      actorId: 'seed',
      title: 'Kickoff Nordwind',
      source: 'transcript',
      text: TRANSCRIPT_A,
    });

    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Produkteinführung Nordwind',
      fokus: 'Produkteinführung',
    });
    expect(handle.status).toBe('awaiting_approval');

    // Der LLM wurde genau einmal aufgerufen …
    expect(fakeChat.calls).toHaveLength(1);
    // … UND währenddessen war KEIN app.current_org gesetzt: der Call lief nicht
    // in einer withTenant-Tx. (Liefe er drin, hätte die Abfrage über den
    // globalen Client die eine gepinnte Connection nicht bekommen oder — auf
    // demselben Backend — den Org-Kontext gesehen.)
    expect(fakeChat.calls[0]!.orgContextDuringCall).toBeNull();
    // Der Call sah wirklich den Transkript-Kontext (nicht leer).
    expect(fakeChat.calls[0]!.lastUser).toContain('Kickoff Nordwind');
  });

  it('Kontrolle: innerhalb einer withTenant-Tx IST app.current_org gesetzt (die Abfrage des Fakes ist also aussagekräftig)', async () => {
    const inside = await withTenant(ORG_A, async (tx) => {
      const [{ org }] = await tx.$queryRaw<Array<{ org: string | null }>>`
        SELECT current_setting('app.current_org', true) AS org
      `;
      return org;
    });
    // Positiv-Kontrolle: in einer Tenant-Tx trägt die GUC den Org-Wert — der
    // Null-Befund in (b) ist somit ein echter "keine Tx"-Beweis, kein Artefakt.
    expect(inside).toBe(ORG_A);
  });
});

// --- (c) Human-in-the-Loop: Pause zur Freigabe, Resume nach approve ---------------------

describe('(c) pausiert zur menschlichen Freigabe und läuft nach approve() weiter', () => {
  it('awaiting_approval mit Guardrail-Grund; die finale Ausgabe fehlt bis zur Freigabe', async () => {
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Kickoff Nordwind', source: 'transcript', text: TRANSCRIPT_A,
    });

    const handle = await startRun(ORG_A, 'transkript_zu_framework', { thema: 'Nordwind Rollout', fokus: '' });
    expect(handle.status).toBe('awaiting_approval');

    const { run, approvals, names } = await withTenant(ORG_A, async (tx) => ({
      run: await tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }),
      approvals: await tx.approval.findMany({ where: { runId: handle.runId } }),
      names: (await tx.skillStep.findMany({ where: { runId: handle.runId }, orderBy: { idx: 'asc' } })).map((s) => s.name),
    }));
    expect(run.status).toBe('awaiting_approval');
    expect(run.result).toBeNull(); // nichts finalisiert, solange pausiert
    expect(approvals).toHaveLength(1);
    expect(approvals[0]!.status).toBe('pending');
    expect(approvals[0]!.reason).toBe(FRAMEWORK_GUARDRAIL_REASON);
    // Die read-only + generativen Steps liefen; der HANDELNDE Ausgabe-Step nicht.
    expect(names).toEqual(['transkript_kontext', 'framework_entworfen']);
    expect(names).not.toContain('framework_ausgegeben');

    // Freigabe → Resume bis completed, jetzt existiert der Ausgabe-Step.
    const resumed = await approve(ORG_A, handle.runId, APPROVER);
    expect(resumed.status).toBe('completed');
    expect(await stepNames(ORG_A, handle.runId)).toEqual([
      'transkript_kontext', 'framework_entworfen', 'framework_ausgegeben',
    ]);
    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ orderBy: { createdAt: 'asc' } }),
    );
    expect(audit.some((a) => a.action === 'guardrail.triggered')).toBe(true);
    const approved = audit.find((a) => a.action === 'approval.approved');
    expect(approved?.actorType).toBe('human');
    expect(approved?.actorId).toBe(APPROVER);
    expect(audit.some((a) => a.action === 'skill.completed')).toBe(true);
  });

  it('reject() beendet den Lauf als rejected; die finale Ausgabe entsteht nie', async () => {
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Kickoff Nordwind', source: 'transcript', text: TRANSCRIPT_A,
    });
    const handle = await startRun(ORG_A, 'transkript_zu_framework', { thema: 'Nordwind Rollout', fokus: '' });
    const denied = await reject(ORG_A, handle.runId, APPROVER);
    expect(denied.status).toBe('rejected');

    const { run, names } = await withTenant(ORG_A, async (tx) => ({
      run: await tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }),
      names: (await tx.skillStep.findMany({ where: { runId: handle.runId } })).map((s) => s.name),
    }));
    expect(run.status).toBe('rejected');
    expect(run.result).toBeNull();
    expect(names).not.toContain('framework_ausgegeben');
  });
});

// --- (d) Tenant-Isolation: nur eigene Transkripte --------------------------------------

describe('(d) tenant-isoliert: das Framework gründet nur auf den eigenen Transkripten', () => {
  it('Org A sieht die Transkripte von Org B nicht — der LLM-Kontext von A enthält NIE Bs Inhalte', async () => {
    // B ingestiert ein völlig anderes Transkript; A ingestiert seines.
    await ingestDocument({
      orgId: ORG_B, actorId: 'seed', title: 'Südstern Klinik', source: 'transcript', text: TRANSCRIPT_B_OTHER_TENANT,
    });
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Kickoff Nordwind', source: 'transcript', text: TRANSCRIPT_A,
    });

    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Produkteinführung Nordwind Logistik',
      fokus: 'Produkteinführung',
    });
    expect(handle.status).toBe('awaiting_approval');

    // Der Kontext-Step von A enthält NUR A-Quellen.
    const kontext = await stepDetail(ORG_A, handle.runId, 'transkript_kontext');
    expect(kontext.quellen).toContain('Kickoff Nordwind');
    expect(kontext.quellen).not.toContain('Südstern Klinik');

    // Und der LLM-Kontext (was wirklich ans Modell ging) enthält NIE Bs Text.
    expect(fakeChat.calls).toHaveLength(1);
    const promptToModel = fakeChat.calls[0]!.lastUser;
    expect(promptToModel).toContain('Kickoff Nordwind');
    expect(promptToModel).not.toContain('Südstern');
    expect(promptToModel).not.toContain('Klinikum');

    // B kann Läufe/Steps von A ohnehin nicht sehen (RLS-Regression).
    const bSeesA = await withTenant(ORG_B, async (tx) => ({
      run: await tx.skillRun.findUnique({ where: { id: handle.runId } }),
      steps: await tx.skillStep.count({ where: { runId: handle.runId } }),
    }));
    expect(bSeesA.run).toBeNull();
    expect(bSeesA.steps).toBe(0);
  });

  it('source-Filter greift: nur Transkripte, kein upload-Dokument im Kontext', async () => {
    // Ein NICHT-Transkript-Dokument mit demselben Vokabular wie das Thema …
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Upload Nordwind Notizen', source: 'upload',
      text: 'Produkteinführung Logistik-Software Nordwind Rollout Onboarding Dashboards Pilotstandort.',
    });
    // … und ein echtes Transkript.
    await ingestDocument({
      orgId: ORG_A, actorId: 'seed', title: 'Kickoff Nordwind', source: 'transcript', text: TRANSCRIPT_A,
    });

    const handle = await startRun(ORG_A, 'transkript_zu_framework', {
      thema: 'Produkteinführung Nordwind',
      fokus: 'Produkteinführung',
    });
    const kontext = await stepDetail(ORG_A, handle.runId, 'transkript_kontext');
    const quellen = (kontext.quellen ?? []) as string[];
    // Nur die Transkript-Quelle, nie das upload-Dokument (source-Filter).
    expect(quellen).toContain('Kickoff Nordwind');
    expect(quellen).not.toContain('Upload Nordwind Notizen');
  });
});
