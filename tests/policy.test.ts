// =============================================================================
// GOVERNANCE-POLICY GATE (Phase 4)
//
// Extends — never replaces — the canonical gate. Runs as `app_user`; the owner
// connection is used ONLY to reset. Deterministic fakes, no network.
//
// What it proves:
//   1. Fail-closed: no policy ⇒ pre-policy approval behavior; no/unknown role ⇒
//      retrieval sees only 'open' documents.
//   2. 'never' on a handlesMoney skill is overridden at runtime (approval still
//      happens) and audit 'policy.overridden_failsafe' exists. 'threshold'
//      gates by amount and replaces the skill guardrail below the threshold.
//   3. Disclosure: member does NOT see confidential chunks in retrieve() (even
//      with a verbatim vector query); admin does; the no-knowledge answer for
//      member does not hint at the hidden document.
//   4. Role gates: approve() with an insufficient role fails; policy changes by
//      non-admins fail.
//   5. Cross-tenant stays sealed: B's policies/grants never influence A.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import { FakeChatProvider, FakeEmbeddingProvider } from '../src/lib/ai/fake';
import { answerQuestion, ingestDocument, NO_KNOWLEDGE_ANSWER, retrieve } from '../src/lib/rag';
import { approve, startRun } from '../src/lib/skills';
import { setApprovalPolicy, setDocumentVisibility, setVisibilityGrant } from '../src/lib/policies';

const ORG_A = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const ORG_B = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const NEW_TABLES = ['approval_policies', 'visibility_grants'];
const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals', ...NEW_TABLES,
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const embedder = new FakeEmbeddingProvider();
const chat = new FakeChatProvider();

const ADMIN_A = 'a_admin';
const LEAD_A = 'a_lead';
const MEMBER_A = 'a_member';

const SALARY_DOC = {
  title: 'Gehaltsband 2026',
  text: 'Gehaltsband Senior Engineer 2026: 90000 bis 120000 Euro Jahresgehalt.',
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrg(orgId: string, clerkOrgId: string, name: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
    await tx.membership.createMany({
      data: [
        { orgId, userId: orgId === ORG_A ? ADMIN_A : 'b_admin', role: 'admin' },
        { orgId, userId: orgId === ORG_A ? LEAD_A : 'b_lead', role: 'lead' },
        { orgId, userId: orgId === ORG_A ? MEMBER_A : 'b_member', role: 'member' },
      ],
    });
  });
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
  await seedOrg(ORG_A, 'org_pol_a', 'Policy Org A');
  await seedOrg(ORG_B, 'org_pol_b', 'Policy Org B');
});

describe('approval policies (configurable human-in-the-loop)', () => {
  it('regression guard: RLS is ENABLEd AND FORCEd on both new tables', async () => {
    const rows = await admin.$queryRaw<
      Array<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>
    >`SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class
      WHERE relname = ANY(${NEW_TABLES}) AND relkind = 'r'`;
    expect(rows).toHaveLength(NEW_TABLES.length);
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} RLS`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} FORCE`).toBe(true);
    }
  });

  it('fail-closed: without a policy the pre-policy behavior holds (guardrail at 1000)', async () => {
    const paused = await startRun(ORG_A, 'beleg_kontieren', {
      beschreibung: 'Software', betragEur: 1240,
    });
    expect(paused.status).toBe('awaiting_approval');

    // No policy → the approval carries no required_role → any decider works
    // (exactly the Phase-3 behavior the existing gate asserts).
    const approval = await withTenant(ORG_A, (tx) => tx.approval.findFirstOrThrow());
    expect(approval.requiredRole).toBeNull();
  });

  it("mode 'threshold' replaces the skill guardrail (below: through; at/above: pause)", async () => {
    await setApprovalPolicy({
      orgId: ORG_A, actorUserId: ADMIN_A, skillKey: 'beleg_kontieren',
      mode: 'threshold', thresholdAmount: 5000,
    });

    const below = await startRun(ORG_A, 'beleg_kontieren', {
      beschreibung: 'Software', betragEur: 1240,
    });
    expect(below.status).toBe('completed'); // skill guardrail (1000) is superseded

    const above = await startRun(ORG_A, 'beleg_kontieren', {
      beschreibung: 'Messestand', betragEur: 6000,
    });
    expect(above.status).toBe('awaiting_approval');
    const approval = await withTenant(ORG_A, (tx) =>
      tx.approval.findFirstOrThrow({ where: { runId: above.runId } }),
    );
    expect(approval.requiredRole).toBe('lead'); // policy default
  });

  it("'never' on a handlesMoney skill is overridden at runtime + audited (not disable-able)", async () => {
    await setApprovalPolicy({
      orgId: ORG_A, actorUserId: ADMIN_A, skillKey: 'beleg_kontieren', mode: 'never',
    });

    const run = await startRun(ORG_A, 'beleg_kontieren', {
      beschreibung: 'Beratung', betragEur: 1240, // over the skill guardrail
    });
    expect(run.status).toBe('awaiting_approval'); // approval happens anyway

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'policy.overridden_failsafe' } }),
    );
    expect(audit.length).toBeGreaterThan(0);

    // The acting step provably did not run.
    const steps = await withTenant(ORG_A, (tx) =>
      tx.skillStep.findMany({ where: { runId: run.runId } }),
    );
    expect(steps.some((s) => s.name === 'verbucht')).toBe(false);
  });

  it('role gate: approve() with an insufficient role fails; lead (and admin) succeed', async () => {
    await setApprovalPolicy({
      orgId: ORG_A, actorUserId: ADMIN_A, skillKey: 'beleg_kontieren',
      mode: 'always', approverRole: 'lead',
    });
    const run = await startRun(ORG_A, 'beleg_kontieren', {
      beschreibung: 'Bahnticket', betragEur: 50,
    });
    expect(run.status).toBe('awaiting_approval'); // mode always

    await expect(approve(ORG_A, run.runId, MEMBER_A)).rejects.toThrow(/may not decide/);
    await expect(approve(ORG_A, run.runId, 'nobody')).rejects.toThrow(/may not decide/);

    const resumed = await approve(ORG_A, run.runId, LEAD_A);
    expect(resumed.status).toBe('completed');
    const approval = await withTenant(ORG_A, (tx) => tx.approval.findFirstOrThrow());
    expect(approval.decidedBy).toBe(LEAD_A);
  });

  it('policy changes by non-admins fail; admin changes audit old+new', async () => {
    await expect(
      setApprovalPolicy({
        orgId: ORG_A, actorUserId: MEMBER_A, skillKey: 'beleg_kontieren', mode: 'always',
      }),
    ).rejects.toThrow(/admin required/);
    await expect(
      setApprovalPolicy({
        orgId: ORG_A, actorUserId: LEAD_A, skillKey: 'beleg_kontieren', mode: 'always',
      }),
    ).rejects.toThrow(/admin required/);

    await setApprovalPolicy({
      orgId: ORG_A, actorUserId: ADMIN_A, skillKey: 'beleg_kontieren',
      mode: 'threshold', thresholdAmount: 5000,
    });
    const entry = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findFirstOrThrow({ where: { action: 'policy.changed' } }),
    );
    expect(entry.actorType).toBe('human');
    expect(entry.detail).toMatchObject({
      old: null,
      new: { mode: 'threshold', thresholdAmount: 5000, approverRole: 'lead' },
    });
  });

  it("cross-tenant: B's policy does not influence A", async () => {
    // B allows everything up to 1M — A has no policy, so A's run still pauses.
    await setApprovalPolicy({
      orgId: ORG_B, actorUserId: 'b_admin', skillKey: 'beleg_kontieren',
      mode: 'threshold', thresholdAmount: 1_000_000,
    });

    const runA = await startRun(ORG_A, 'beleg_kontieren', {
      beschreibung: 'Software', betragEur: 1240,
    });
    expect(runA.status).toBe('awaiting_approval');

    // And A cannot even see B's policy.
    const fromA = await withTenant(ORG_A, (tx) => tx.approvalPolicy.findMany());
    expect(fromA).toHaveLength(0);
  });
});

describe('disclosure policies (knowledge visibility by role)', () => {
  beforeEach(async () => {
    // Grants: confidential → admin only (restricted unused here).
    await setVisibilityGrant({
      orgId: ORG_A, actorUserId: ADMIN_A, level: 'confidential', role: 'admin', allowed: true,
    });
    await ingestDocument({
      orgId: ORG_A, actorId: ADMIN_A, title: 'Handbuch', source: 'manual',
      text: 'Das Handbuch beschreibt Urlaubsanträge und Onboarding im HR-Portal.',
      visibility: 'open', embedder,
    });
    await ingestDocument({
      orgId: ORG_A, actorId: ADMIN_A, source: 'manual',
      visibility: 'confidential', embedder, ...SALARY_DOC,
    });
  });

  it('member does not see confidential chunks — even with a verbatim vector query', async () => {
    const asMember = await retrieve({
      orgId: ORG_A, query: SALARY_DOC.text, embedder, role: 'member',
    });
    expect(asMember.every((c) => c.documentTitle !== SALARY_DOC.title)).toBe(true);
    expect(asMember.every((c) => !c.content.includes('Gehaltsband'))).toBe(true);

    // Positive control: admin retrieves it with near-perfect similarity.
    const asAdmin = await retrieve({
      orgId: ORG_A, query: SALARY_DOC.text, embedder, role: 'admin',
    });
    expect(asAdmin[0]?.documentTitle).toBe(SALARY_DOC.title);
    expect(asAdmin[0]?.similarity).toBeGreaterThan(0.9);
  });

  it('no role / unknown role ⇒ only open documents (fail-closed)', async () => {
    const noRole = await retrieve({ orgId: ORG_A, query: SALARY_DOC.text, embedder });
    expect(noRole.every((c) => c.documentTitle === 'Handbuch')).toBe(true);
  });

  it('the honest no-knowledge answer for member does not hint at the hidden document', async () => {
    const frage = 'Wie hoch ist das Gehaltsband für Senior Engineers?';
    const asMember = await answerQuestion({
      orgId: ORG_A, actorId: MEMBER_A, question: frage, role: 'member', embedder, chat,
    });
    expect(asMember.answer).toBe(NO_KNOWLEDGE_ANSWER);
    expect(asMember.sources).toEqual([]);
    expect(asMember.answer).not.toContain(SALARY_DOC.title);

    const asAdmin = await answerQuestion({
      orgId: ORG_A, actorId: ADMIN_A, question: frage, role: 'admin', embedder, chat,
    });
    expect(asAdmin.sources).toContain(SALARY_DOC.title);
  });

  it('setDocumentVisibility flips access; non-admin cannot change it', async () => {
    const doc = await withTenant(ORG_A, (tx) =>
      tx.document.findFirstOrThrow({ where: { title: SALARY_DOC.title } }),
    );

    await expect(
      setDocumentVisibility({
        orgId: ORG_A, actorUserId: MEMBER_A, documentId: doc.id, visibility: 'open',
      }),
    ).rejects.toThrow(/admin required/);

    await setDocumentVisibility({
      orgId: ORG_A, actorUserId: ADMIN_A, documentId: doc.id, visibility: 'open',
    });
    const asMember = await retrieve({
      orgId: ORG_A, query: SALARY_DOC.text, embedder, role: 'member',
    });
    expect(asMember[0]?.documentTitle).toBe(SALARY_DOC.title);
  });

  it("cross-tenant: B's grants do not open A's documents", async () => {
    // B grants member access to confidential — meaningless for A's documents.
    await setVisibilityGrant({
      orgId: ORG_B, actorUserId: 'b_admin', level: 'confidential', role: 'member', allowed: true,
    });

    const asMemberA = await retrieve({
      orgId: ORG_A, query: SALARY_DOC.text, embedder, role: 'member',
    });
    expect(asMemberA.every((c) => c.documentTitle !== SALARY_DOC.title)).toBe(true);
  });
});
