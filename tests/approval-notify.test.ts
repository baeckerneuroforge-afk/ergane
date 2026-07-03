// =============================================================================
// FREIGABE-BENACHRICHTIGUNG GATE
//
//   1. setApprovalNotifyEmail: Admin-Gate, Validierung, Audit {old,new},
//      ''/null schaltet ab.
//   2. Pausierender Run ⇒ GENAU EINE Mail an die konfigurierte Adresse —
//      und die Mechanik bleibt unabhängig: keine Adresse ⇒ keine Mail,
//      Mail-Fehler ⇒ Run pausiert trotzdem korrekt mit Approval-Zeile.
//   3. Freigegebener Re-Run verschickt KEINE weitere Benachrichtigung.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { setApprovalNotifyEmail } from '../src/lib/policies';
import { approve, startRun } from '../src/lib/skills';
import { getFakeEmailProvider } from '../src/lib/effects';

const ORG = 'f1f1f1f1-f1f1-4f1f-8f1f-f1f1f1f1f1f1';
const ADMIN = 'an_admin';
const MEMBER = 'an_member';
const APPROVER = 'an_lead';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'org_settings',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies', 'visibility_grants',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fake = getFakeEmailProvider();

// Angebot triggert die Guardrail IMMER (externe Wirkung) — idealer Testfall.
const INPUT = { kunde: 'Hanse Logistik GmbH', leistung: 'Beratung', betragEur: 100 };

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

beforeAll(async () => {
  delete process.env.RESEND_API_KEY;
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
    await tx.organization.create({ data: { id: ORG, clerkOrgId: 'org_an', name: 'Notify Org' } });
    await tx.membership.create({ data: { orgId: ORG, userId: ADMIN, role: 'admin' } });
    await tx.membership.create({ data: { orgId: ORG, userId: MEMBER, role: 'member' } });
    await tx.membership.create({ data: { orgId: ORG, userId: APPROVER, role: 'lead' } });
  });
});

describe('setApprovalNotifyEmail', () => {
  it('admin saves (audited); empty string disables', async () => {
    await setApprovalNotifyEmail({ orgId: ORG, actorUserId: ADMIN, email: 'team@firma.example' });
    let row = await withTenant(ORG, (tx) => tx.orgSettings.findUnique({ where: { orgId: ORG } }));
    expect(row?.approvalNotifyEmail).toBe('team@firma.example');

    await setApprovalNotifyEmail({ orgId: ORG, actorUserId: ADMIN, email: '' });
    row = await withTenant(ORG, (tx) => tx.orgSettings.findUnique({ where: { orgId: ORG } }));
    expect(row?.approvalNotifyEmail).toBeNull();

    const audit = await withTenant(ORG, (tx) =>
      tx.auditLog.findMany({
        where: { target: 'org_settings:approval_notify_email' },
        orderBy: { createdAt: 'asc' },
      }),
    );
    expect(audit).toHaveLength(2);
    expect(audit[1]!.detail).toMatchObject({ old: 'team@firma.example', new: null });
  });

  it('member is refused; invalid address gets a German error', async () => {
    await expect(
      setApprovalNotifyEmail({ orgId: ORG, actorUserId: MEMBER, email: 'x@y.example' }),
    ).rejects.toThrow(/admin required/);
    await expect(
      setApprovalNotifyEmail({ orgId: ORG, actorUserId: ADMIN, email: 'kein-at-zeichen' }),
    ).rejects.toThrow(/valid e-mail address/);
  });
});

describe('notification on awaiting_approval', () => {
  it('paused run sends exactly ONE mail with skill + reason; approval works as before', async () => {
    await setApprovalNotifyEmail({ orgId: ORG, actorUserId: ADMIN, email: 'team@firma.example' });

    const handle = await startRun(ORG, 'angebot_erstellen', INPUT);
    expect(handle.status).toBe('awaiting_approval');

    expect(fake.sent).toHaveLength(1);
    const mail = fake.sent[0]!;
    expect(mail.to).toBe('team@firma.example');
    expect(mail.subject).toContain('Approval requested');
    expect(mail.text).toContain('angebot_erstellen');
    expect(mail.text).toContain('External communication');
    expect(mail.text).toContain(handle.runId);

    // Freigabe + Abschluss unverändert; ohne input.email nur simulierter Versand.
    fake.reset();
    const resumed = await approve(ORG, handle.runId, APPROVER);
    expect(resumed.status).toBe('completed');
    expect(fake.sent).toHaveLength(0); // kein zweiter Notify, kein Kunden-Mail
  });

  it('no address configured ⇒ no mail, run pauses normally', async () => {
    const handle = await startRun(ORG, 'angebot_erstellen', INPUT);
    expect(handle.status).toBe('awaiting_approval');
    expect(fake.sent).toHaveLength(0);
  });

  it('mail failure never breaks the pause: approval row exists, run awaits', async () => {
    await setApprovalNotifyEmail({ orgId: ORG, actorUserId: ADMIN, email: 'team@firma.example' });
    fake.failNext('smtp down');

    const handle = await startRun(ORG, 'angebot_erstellen', INPUT);
    expect(handle.status).toBe('awaiting_approval');

    const approvals = await withTenant(ORG, (tx) =>
      tx.approval.findMany({ where: { runId: handle.runId, status: 'pending' } }),
    );
    expect(approvals).toHaveLength(1);
  });
});
