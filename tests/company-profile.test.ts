// =============================================================================
// FIRMENDATEN + BUSINESS-PDF GATE
//
// 1. setCompanyProfile: Admin-Gate (member wird abgewiesen), Normalisierung
//    ('' → null, trim), Längen-Limit mit deutscher Meldung, Audit-Eintrag
//    'policy.changed' mit { old, new }.
// 2. getCompanyProfile: Roundtrip; fremder Tenant sieht NICHTS (RLS).
// 3. renderBusinessPdf: strukturell valides PDF, Briefkopf/Fußzeile enthalten
//    Firmendaten, Summen deutsch formatiert, >1 Seite bei vielen Positionen,
//    Seitenzahl auf jeder Seite.
// 4. Skill-Integration: Angebot nach Freigabe trägt den Briefkopf im PDF.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { getCompanyProfile, setCompanyProfile } from '../src/lib/company';
import { formatEur, getFakeEmailProvider, renderBusinessPdf } from '../src/lib/effects';
import { approve, startRun } from '../src/lib/skills';

const ORG = 'cbcbcbcb-cbcb-4bcb-8bcb-cbcbcbcbcbcb';
const OTHER_ORG = 'cdcdcdcd-cdcd-4dcd-8dcd-cdcdcdcdcdcd';
const ADMIN = 'cp_admin';
const MEMBER = 'cp_member';
const APPROVER = 'cp_lead';

const ALL_TABLES = [
  'organizations', 'memberships', 'audit_log', 'org_settings',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals', 'approval_policies', 'visibility_grants',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });
const fake = getFakeEmailProvider();

const PROFILE = {
  name: 'Hephaistos Systems GmbH',
  address: 'Musterstraße 1\n20095 Hamburg',
  vatId: 'DE123456789',
  bank: 'Musterbank\nIBAN: DE00 0000 0000 0000 0000 00',
};

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

function pdfText(pdf: Uint8Array): string {
  return Buffer.from(pdf).toString('latin1');
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
    await tx.organization.create({ data: { id: ORG, clerkOrgId: 'org_cp', name: 'Company Org' } });
    await tx.membership.create({ data: { orgId: ORG, userId: ADMIN, role: 'admin' } });
    await tx.membership.create({ data: { orgId: ORG, userId: MEMBER, role: 'member' } });
    await tx.membership.create({ data: { orgId: ORG, userId: APPROVER, role: 'lead' } });
  });
  await withTenant(OTHER_ORG, async (tx) => {
    await tx.organization.create({
      data: { id: OTHER_ORG, clerkOrgId: 'org_cp_other', name: 'Other Org' },
    });
  });
});

describe('setCompanyProfile / getCompanyProfile', () => {
  it('admin saves; roundtrip returns normalized values; audit entry written', async () => {
    const saved = await setCompanyProfile({
      orgId: ORG,
      actorUserId: ADMIN,
      profile: { ...PROFILE, name: `  ${PROFILE.name}  `, vatId: '' },
    });
    expect(saved.name).toBe(PROFILE.name); // trimmed
    expect(saved.vatId).toBeNull(); // '' → null

    const read = await withTenant(ORG, (tx) => getCompanyProfile(tx, ORG));
    expect(read).toEqual({ ...PROFILE, name: PROFILE.name, vatId: null });

    const audit = await withTenant(ORG, (tx) =>
      tx.auditLog.findMany({ where: { action: 'policy.changed' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.target).toBe('org_settings:company_profile');
    expect(audit[0]!.detail).toMatchObject({
      old: { name: null },
      new: { name: PROFILE.name },
    });
  });

  it('member is refused (admin gate) and nothing is written', async () => {
    await expect(
      setCompanyProfile({ orgId: ORG, actorUserId: MEMBER, profile: { ...PROFILE } }),
    ).rejects.toThrow(/admin required/);
    const read = await withTenant(ORG, (tx) => getCompanyProfile(tx, ORG));
    expect(read.name).toBeNull();
  });

  it('over-limit field throws a German message before any DB write', async () => {
    await expect(
      setCompanyProfile({
        orgId: ORG,
        actorUserId: ADMIN,
        profile: { ...PROFILE, vatId: 'X'.repeat(51) },
      }),
    ).rejects.toThrow(/VAT ID must be at most 50 characters/);
  });

  it('another tenant reads only nulls (RLS: settings are invisible)', async () => {
    await setCompanyProfile({ orgId: ORG, actorUserId: ADMIN, profile: { ...PROFILE } });
    const foreign = await withTenant(OTHER_ORG, (tx) => getCompanyProfile(tx, ORG));
    expect(foreign).toEqual({ name: null, address: null, vatId: null, bank: null });
  });
});

describe('renderBusinessPdf', () => {
  it('valid PDF with letterhead, positions, totals and footer (en default; de labels via locale)', () => {
    const pdf = renderBusinessPdf({
      title: 'Angebot',
      sender: { ...PROFILE },
      recipient: ['Hanse Logistik GmbH'],
      meta: [['Datum', '03.07.2026']],
      body: ['Sehr geehrte Damen und Herren,'],
      positions: [
        { beschreibung: 'Projektunterstützung Q3', betragEur: 4800 },
        { beschreibung: 'Workshoptag', betragEur: 480.5 },
      ],
      totalLabel: 'Angebotssumme',
      closing: ['Mit freundlichen Grüßen'],
    });
    const text = pdfText(pdf);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('Hephaistos Systems GmbH'); // Briefkopf
    expect(text).toContain('VAT ID: DE123456789'); // footer (en default)
    expect(text).toContain('4,800.00 EUR');
    expect(text).toContain('5,280.50 EUR'); // total
    expect(text).toContain('Page 1/1');
    expect(text).toContain('Helvetica-Bold');
    // xref offset zeigt auf das 'xref'-Keyword.
    const startxref = Number(text.match(/startxref\n(\d+)/)![1]);
    expect(Buffer.from(pdf).subarray(startxref, startxref + 4).toString('latin1')).toBe('xref');
  });

  it('many positions break onto multiple pages with page numbers', () => {
    const pdf = renderBusinessPdf({
      title: 'Rechnung',
      positions: Array.from({ length: 60 }, (_, i) => ({
        beschreibung: `Position ${i + 1}`,
        betragEur: 100,
      })),
    });
    const text = pdfText(pdf);
    expect(text).toContain('/Count 2');
    expect(text).toContain('Page 1/2');
    expect(text).toContain('Page 2/2');
    expect(text).toContain('6,000.00 EUR');
  });

  it('formatEur groups thousands per locale (en default, de opt-in)', () => {
    expect(formatEur(0)).toBe('0.00 EUR');
    expect(formatEur(1234.5)).toBe('1,234.50 EUR');
    expect(formatEur(1234567.89)).toBe('1,234,567.89 EUR');
    expect(formatEur(-950)).toBe('-950.00 EUR');
    expect(formatEur(1234.5, 'de')).toBe('1.234,50 EUR');
    expect(formatEur(-950, 'de')).toBe('-950,00 EUR');
  });

  it('de locale renders German table/footer labels', () => {
    const pdf = renderBusinessPdf({
      title: 'Angebot',
      locale: 'de',
      sender: { ...PROFILE },
      positions: [{ beschreibung: 'Workshoptag', betragEur: 480.5 }],
    });
    const text = pdfText(pdf);
    expect(text).toContain('USt-IdNr.: DE123456789');
    expect(text).toContain('Seite 1/1');
    expect(text).toContain('480,50 EUR');
    expect(text).toContain('Gesamtsumme');
  });
});

describe('skill integration', () => {
  it('approved Angebot carries the company letterhead in the PDF', async () => {
    await setCompanyProfile({ orgId: ORG, actorUserId: ADMIN, profile: { ...PROFILE } });

    const handle = await startRun(ORG, 'angebot_erstellen', {
      kunde: 'Hanse Logistik GmbH',
      leistung: 'Projektunterstützung Q3',
      betragEur: 4800,
      email: 'einkauf@kunde.example',
    });
    expect(handle.status).toBe('awaiting_approval');
    await approve(ORG, handle.runId, APPROVER);

    expect(fake.sent).toHaveLength(1);
    const mail = fake.sent[0]!;
    const text = pdfText(mail.attachment!.content);
    expect(text).toContain('Hephaistos Systems GmbH');
    expect(text).toContain('VAT ID: DE123456789');
    expect(text).toContain('4,800.00 EUR');
    expect(mail.text).toContain('Kind regards\nHephaistos Systems GmbH');
  });
});
