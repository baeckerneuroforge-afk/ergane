// =============================================================================
// `pnpm demo:policies` — Governance-Schicht end-to-end, OHNE Auth/HTTP, mit
// Fake-Providern (kein API-Key nötig).
//
//  a) approval_policy threshold=5000 auf beleg_kontieren:
//     1.240 € läuft OHNE Freigabe durch (Policy schlägt Skill-Guardrail),
//     6.000 € pausiert awaiting_approval.
//  b) Policy 'never' auf beleg_kontieren (handlesMoney) ⇒ Failsafe überschreibt
//     zur Laufzeit, Freigabe kommt trotzdem, Audit 'policy.overridden_failsafe'.
//  c) Disclosure: "Handbuch" (open) vs. "Gehaltsband 2026" (confidential).
//     Frage als member ⇒ ehrliche Kein-Wissen-Antwort ohne Leak; als admin ⇒
//     Antwort mit Quelle.
//  d) Rollen-Gate: approve() als member (required_role lead) ⇒ Fehler;
//     als lead ⇒ completed.
// =============================================================================
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { FakeChatProvider, FakeEmbeddingProvider } from '../src/lib/ai/fake';
import { answerQuestion, ingestDocument, NO_KNOWLEDGE_ANSWER } from '../src/lib/rag';
import { approve, startRun } from '../src/lib/skills';
import { setApprovalPolicy, setVisibilityGrant } from '../src/lib/policies';

const DEMO_ORG = '99999999-9999-4999-8999-999999999999';
const ADMIN = 'demo-admin';
const LEAD = 'demo-lead';
const MEMBER = 'demo-member';

const embedder = new FakeEmbeddingProvider();
const chat = new FakeChatProvider();

function fail(msg: string): never {
  throw new Error(`DEMO FAILED: ${msg}`);
}

async function setup() {
  await withTenant(DEMO_ORG, async (tx) => {
    await tx.organization.upsert({
      where: { id: DEMO_ORG },
      create: { id: DEMO_ORG, clerkOrgId: 'demo_org_policies', name: 'Demo Org Policies' },
      update: {},
    });
    for (const [userId, role] of [[ADMIN, 'admin'], [LEAD, 'lead'], [MEMBER, 'member']] as const) {
      await tx.membership.upsert({
        where: { orgId_userId: { orgId: DEMO_ORG, userId } },
        create: { orgId: DEMO_ORG, userId, role },
        update: { role },
      });
    }
  });
}

async function scenarioA() {
  console.log('\n═ a) Policy threshold=5000 statt Skill-Guardrail (1.000) ═');
  await setApprovalPolicy({
    orgId: DEMO_ORG, actorUserId: ADMIN, skillKey: 'beleg_kontieren',
    mode: 'threshold', thresholdAmount: 5000, approverRole: 'lead',
  });

  const small = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Softwarelizenz Team', betragEur: 1240,
  });
  console.log(`   1.240 € → ${small.status} (Skill-Guardrail läge bei 1.000 € — die Policy gilt)`);
  if (small.status !== 'completed') fail(`1240 should complete under threshold policy, got ${small.status}`);

  const big = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Messestand Hannover', betragEur: 6000,
  });
  console.log(`   6.000 € → ${big.status}`);
  if (big.status !== 'awaiting_approval') fail(`6000 should pause, got ${big.status}`);
  return big.runId;
}

async function scenarioB() {
  console.log('\n═ b) Policy "never" auf einem Geld-Skill ⇒ Failsafe ═');
  await setApprovalPolicy({
    orgId: DEMO_ORG, actorUserId: ADMIN, skillKey: 'beleg_kontieren', mode: 'never',
  });

  const run = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Beratungsleistung', betragEur: 1240,
  });
  console.log(`   1.240 € trotz "never" → ${run.status} (Freigabe-Pflicht nicht abschaltbar)`);
  if (run.status !== 'awaiting_approval') fail(`never must be overridden, got ${run.status}`);

  const overridden = await withTenant(DEMO_ORG, (tx) =>
    tx.auditLog.findFirst({ where: { action: 'policy.overridden_failsafe' } }),
  );
  if (!overridden) fail('audit policy.overridden_failsafe missing');
  console.log(`   Audit: ${overridden.action} → ${overridden.target}`);
}

async function scenarioC() {
  console.log('\n═ c) Disclosure: confidential nur für admin sichtbar ═');
  await setVisibilityGrant({
    orgId: DEMO_ORG, actorUserId: ADMIN, level: 'confidential', role: 'admin', allowed: true,
  });

  const existing = await withTenant(DEMO_ORG, (tx) =>
    tx.document.findFirst({ where: { title: 'Gehaltsband 2026' } }),
  );
  if (!existing) {
    await ingestDocument({
      orgId: DEMO_ORG, actorId: ADMIN, title: 'Handbuch', source: 'manual',
      text: 'Das Handbuch beschreibt Urlaubsanträge und Onboarding-Prozesse im HR-Portal.',
      visibility: 'open', embedder,
    });
    await ingestDocument({
      orgId: DEMO_ORG, actorId: ADMIN, title: 'Gehaltsband 2026', source: 'manual',
      text: 'Gehaltsband Senior Engineer 2026: 90000 bis 120000 Euro Jahresgehalt.',
      visibility: 'confidential', embedder,
    });
  }

  const frage = 'Wie hoch ist das Gehaltsband für Senior Engineers?';
  const asMember = await answerQuestion({
    orgId: DEMO_ORG, actorId: MEMBER, question: frage, role: 'member', embedder, chat,
  });
  console.log(`   member: ${asMember.answer}`);
  if (asMember.answer !== NO_KNOWLEDGE_ANSWER) fail('member must get the honest no-knowledge answer');
  if (asMember.answer.includes('Gehaltsband')) fail('no-knowledge answer must not leak the hidden doc');

  const asAdmin = await answerQuestion({
    orgId: DEMO_ORG, actorId: ADMIN, question: frage, role: 'admin', embedder, chat,
  });
  console.log(`   admin:  ${asAdmin.answer.split('\n').join(' / ')}`);
  if (!asAdmin.sources.includes('Gehaltsband 2026')) fail('admin must get the source Gehaltsband 2026');
}

async function scenarioD(pausedRunId: string) {
  console.log('\n═ d) Rollen-Gate an der Freigabe (required_role: lead) ═');
  try {
    await approve(DEMO_ORG, pausedRunId, MEMBER);
    fail('approve as member must throw');
  } catch (err) {
    console.log(`   approve als member → Fehler: ${(err as Error).message.slice(0, 80)}…`);
  }

  const resumed = await approve(DEMO_ORG, pausedRunId, LEAD);
  console.log(`   approve als lead → ${resumed.status}`);
  if (resumed.status !== 'completed') fail(`lead approve should complete, got ${resumed.status}`);
}

async function main() {
  await setup();
  const pausedRunId = await scenarioA();
  await scenarioB();
  await scenarioC();
  await scenarioD(pausedRunId);

  const policyAudit = await withTenant(DEMO_ORG, (tx) =>
    tx.auditLog.findMany({ where: { action: 'policy.changed' }, orderBy: { createdAt: 'asc' } }),
  );
  console.log(`\n🧾  ${policyAudit.length} × policy.changed im Audit (mit old/new im detail-jsonb).`);
  console.log('\n✅  Demo erfolgreich: Policy-Threshold, Never-Failsafe, Disclosure ohne Leak, Rollen-Gate.');
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
