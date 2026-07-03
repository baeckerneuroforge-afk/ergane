// =============================================================================
// SKILL EFFECTS GATE (Phase 11)
//
// The catalog's acting steps gain a REAL effect (email with PDF attachment)
// — this suite proves the effect NEVER weakens the approval mechanics:
//
//   1. With input.email: the mail leaves EXACTLY once, only AFTER approval;
//      before approval (awaiting_approval) nothing was sent. reject ⇒ never.
//   2. Without input.email: previous simulated behavior, byte-for-byte
//      compatible (simuliert: true), no mail.
//   3. Effect failure ⇒ step failed ⇒ run failed + audit — and NO retry loop.
//   4. The PDF renderer produces a structurally valid PDF (header, xref,
//      escaped text, umlauts via WinAnsi).
//   5. Factory: fake without key; production without key throws.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { approve, reject, startRun } from '../src/lib/skills';
import { getEmailProvider, getFakeEmailProvider, renderSimplePdf } from '../src/lib/effects';

const ORG = 'acacacac-acac-4cac-8cac-acacacacacac';
const APPROVER = 'fx_lead';

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
    await tx.organization.create({ data: { id: ORG, clerkOrgId: 'org_fx', name: 'Effects Org' } });
    await tx.membership.create({ data: { orgId: ORG, userId: APPROVER, role: 'lead' } });
  });
});

// --- 1. effect strictly behind the approval -------------------------------------------

describe('email effect is gated by the approval', () => {
  it('nothing is sent while awaiting_approval; after approve exactly ONE mail with PDF', async () => {
    const handle = await startRun(ORG, 'angebot_erstellen', ANGEBOT_INPUT);
    expect(handle.status).toBe('awaiting_approval');
    expect(fake.sent).toHaveLength(0); // paused ⇒ the effect has NOT fired

    const resumed = await approve(ORG, handle.runId, APPROVER);
    expect(resumed.status).toBe('completed');
    expect(fake.sent).toHaveLength(1); // exactly once

    const mail = fake.sent[0]!;
    expect(mail.to).toBe('einkauf@kunde.example');
    expect(mail.subject).toContain('4.800,00 EUR');
    expect(mail.attachment?.filename).toBe('angebot.pdf');
    expect(Buffer.from(mail.attachment!.content.slice(0, 5)).toString()).toBe('%PDF-');

    const step = await withTenant(ORG, (tx) =>
      tx.skillStep.findFirstOrThrow({ where: { runId: handle.runId, name: 'versendet' } }),
    );
    expect(step.detail).toMatchObject({
      simuliert: false,
      empfaengerEmail: 'einkauf@kunde.example',
      emailProvider: 'fake',
    });
  });

  it('reject ⇒ the mail NEVER leaves', async () => {
    const handle = await startRun(ORG, 'angebot_erstellen', ANGEBOT_INPUT);
    await reject(ORG, handle.runId, APPROVER);
    expect(fake.sent).toHaveLength(0);
  });

  it('rechnung_erstellen over the threshold: same gating, PDF invoice', async () => {
    const handle = await startRun(ORG, 'rechnung_erstellen', {
      kunde: 'Möbelwerk Nord',
      positionen: [{ bezeichnung: 'Beratung März', betragEur: 1500 }],
      email: 'buchhaltung@kunde.example',
    });
    expect(handle.status).toBe('awaiting_approval'); // 1500 > 1000
    expect(fake.sent).toHaveLength(0);

    await approve(ORG, handle.runId, APPROVER);
    expect(fake.sent).toHaveLength(1);
    expect(fake.sent[0]!.attachment?.filename).toBe('rechnung.pdf');
    expect(fake.sent[0]!.text).toContain('1.500,00 EUR');
  });
});

// --- 2. backwards compatible without email ---------------------------------------------

describe('without input.email the previous simulated behavior holds', () => {
  it('angebot: simuliert true, no mail', async () => {
    const { email: _e, ...inputOhneEmail } = ANGEBOT_INPUT;
    const handle = await startRun(ORG, 'angebot_erstellen', inputOhneEmail);
    await approve(ORG, handle.runId, APPROVER);

    expect(fake.sent).toHaveLength(0);
    const step = await withTenant(ORG, (tx) =>
      tx.skillStep.findFirstOrThrow({ where: { runId: handle.runId, name: 'versendet' } }),
    );
    expect(step.detail).toMatchObject({ versendet: true, simuliert: true });
  });

  it('an implausible email is treated as absent (fail-closed to simulated)', async () => {
    const handle = await startRun(ORG, 'angebot_erstellen', {
      ...ANGEBOT_INPUT,
      email: 'kein-at-zeichen',
    });
    await approve(ORG, handle.runId, APPROVER);
    expect(fake.sent).toHaveLength(0);
  });
});

// --- 3. effect failure -------------------------------------------------------------------

describe('effect failure fails the run cleanly', () => {
  it('a rejected send ⇒ step failed, run failed, audit skill.failed — and no ghost mail', async () => {
    fake.failNext('SMTP down');
    const handle = await startRun(ORG, 'angebot_erstellen', ANGEBOT_INPUT);
    const resumed = await approve(ORG, handle.runId, APPROVER);
    expect(resumed.status).toBe('failed');

    const { run, steps, audit } = await withTenant(ORG, async (tx) => ({
      run: await tx.skillRun.findUniqueOrThrow({ where: { id: handle.runId } }),
      steps: await tx.skillStep.findMany({ where: { runId: handle.runId } }),
      audit: await tx.auditLog.findMany({ where: { action: 'skill.failed' } }),
    }));
    expect(run.status).toBe('failed');
    expect(steps.find((s) => s.name === 'versendet')?.status).toBe('failed');
    expect(audit).toHaveLength(1);
    expect(fake.sent).toHaveLength(0);
  });
});

// --- 4. pdf renderer ----------------------------------------------------------------------

describe('renderSimplePdf', () => {
  it('produces a structurally valid one-page PDF with escaped text and umlauts', () => {
    const pdf = Buffer.from(
      renderSimplePdf('Angebot (Entwurf) für Müller & Söhne', [
        'Zeile mit (Klammern) und \\ Backslash',
        'Umlaute: äöüß',
      ]),
    );
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text).toContain('xref');
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('\\(Klammern\\)');
    expect(text).toContain('äöüß'); // WinAnsi/latin1 keeps umlauts
    // The xref offset points at the actual 'xref' keyword.
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(pdf.subarray(startxref, startxref + 4).toString('latin1')).toBe('xref');
  });
});

// --- 5. factory ------------------------------------------------------------------------------

describe('effect provider factory', () => {
  it('falls back to the fake without a key (dev/test) and throws in production', () => {
    expect(getEmailProvider().name).toBe('fake');

    const savedEnv = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = 'production';
    expect(() => getEmailProvider()).toThrow(/RESEND_API_KEY/);
    (process.env as Record<string, string>).NODE_ENV = savedEnv ?? 'test';
  });
});
