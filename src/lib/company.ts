// Firmendaten (company profile) — Briefkopf & Fußzeile der erzeugten
// Angebots-/Rechnungs-PDFs, gepflegt in den Einstellungen.
//
// Gleiche Form wie src/lib/policies/ und setChatRetention: Schreiben läuft in
// withTenant() mit serverseitigem Admin-Gate und Audit ('policy.changed' mit
// { old, new }); Lesen geschieht in der Transaktion des AUFRUFERS (die Skills
// lesen das Profil in ihrem eigenen Step-Tx). Alle Felder optional — ein
// leeres Profil ist gültig und heißt "neutraler Briefkopf", nie erfundene
// Stammdaten.
import type { Role } from '@prisma/client';
import { logAudit } from './audit';
import { getMemberRole } from './policies';
import { withTenant, type Tx } from './tenant';

const ADMIN_ROLES: Role[] = ['admin', 'owner'];

export interface CompanyProfile {
  /** Firmenname im Briefkopf. */
  name: string | null;
  /** Anschrift, mehrzeilig (Straße\nPLZ Ort). */
  address: string | null;
  /** USt-IdNr. für die Fußzeile. */
  vatId: string | null;
  /** Bankverbindung, mehrzeilig (Bank\nIBAN\nBIC), Fußzeile. */
  bank: string | null;
}

export const EMPTY_COMPANY_PROFILE: CompanyProfile = {
  name: null,
  address: null,
  vatId: null,
  bank: null,
};

/** Feld-Limits — Spiegel der CHECK-Constraints aus Migration 0015, damit der
 * Nutzer eine deutsche Meldung sieht statt eines DB-Fehlers. */
const FIELD_LIMITS: Record<keyof CompanyProfile, { label: string; max: number }> = {
  name: { label: 'Firmenname', max: 200 },
  address: { label: 'Anschrift', max: 500 },
  vatId: { label: 'USt-IdNr.', max: 50 },
  bank: { label: 'Bankverbindung', max: 500 },
};

/** '' / whitespace → null; sonst getrimmter Wert. Längen-Check fail-closed. */
function normalizeField(field: keyof CompanyProfile, value: string | null): string | null {
  const trimmed = value?.trim() ?? '';
  if (trimmed === '') return null;
  const { label, max } = FIELD_LIMITS[field];
  if (trimmed.length > max) {
    throw new Error(`${label} darf höchstens ${max} Zeichen lang sein.`);
  }
  return trimmed;
}

/** Profil im Tx des Aufrufers lesen (Skills, Settings-Seite). Keine Zeile oder
 * leere Felder ⇒ EMPTY_COMPANY_PROFILE-Form mit nulls. */
export async function getCompanyProfile(tx: Tx, orgId: string): Promise<CompanyProfile> {
  const row = await tx.orgSettings.findUnique({ where: { orgId } });
  return {
    name: row?.companyName ?? null,
    address: row?.companyAddress ?? null,
    vatId: row?.companyVatId ?? null,
    bank: row?.companyBank ?? null,
  };
}

export interface SetCompanyProfileInput {
  orgId: string;
  /** Der ändernde Mensch — muss Admin dieses Tenants sein. */
  actorUserId: string;
  profile: CompanyProfile;
}

export async function setCompanyProfile(input: SetCompanyProfileInput): Promise<CompanyProfile> {
  const next: CompanyProfile = {
    name: normalizeField('name', input.profile.name),
    address: normalizeField('address', input.profile.address),
    vatId: normalizeField('vatId', input.profile.vatId),
    bank: normalizeField('bank', input.profile.bank),
  };

  return withTenant(input.orgId, async (tx) => {
    const role = await getMemberRole(tx, input.actorUserId);
    if (!role || !ADMIN_ROLES.includes(role)) {
      throw new Error(
        `company: user ${JSON.stringify(input.actorUserId)} (role: ${role ?? 'none'}) may not change the company profile — admin required.`,
      );
    }

    const old = await getCompanyProfile(tx, input.orgId);
    await tx.orgSettings.upsert({
      where: { orgId: input.orgId },
      create: {
        orgId: input.orgId,
        companyName: next.name,
        companyAddress: next.address,
        companyVatId: next.vatId,
        companyBank: next.bank,
      },
      update: {
        companyName: next.name,
        companyAddress: next.address,
        companyVatId: next.vatId,
        companyBank: next.bank,
      },
    });

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'policy.changed',
      target: 'org_settings:company_profile',
      detail: { old, new: next },
    });
    return next;
  });
}
