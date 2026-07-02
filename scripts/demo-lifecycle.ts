// =============================================================================
// `pnpm demo:lifecycle` — Datenlebenszyklus & DSGVO end-to-end, OHNE Auth/HTTP.
//
// Zeigt an einer Wegwerf-Demo-Org:
//   1. Anlegen + Ingestieren → Frage wird beantwortet
//   2. Vollexport (Art. 20) → Zeilenzahlen
//   3. Dokument löschen → dieselbe Frage ist ehrlich unbeantwortbar
//   4. Audit-Pseudonymisierung (Art. 17 für eine Person) — alte Kennung ist
//      danach nirgends mehr im Audit-Trail
//   5. Tenant-Offboarding: Organisation vollständig löschen (inkl. Audit via
//      dem geschützten delete_organization()), Löschnachweis wird ausgegeben
// =============================================================================
import 'dotenv/config';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { answerQuestion, ingestDocument, NO_KNOWLEDGE_ANSWER } from '../src/lib/rag';
import {
  deleteDocument,
  deleteOrganization,
  exportOrgData,
  pseudonymizeAuditActor,
} from '../src/lib/lifecycle';

const DEMO_ORG = '22222222-2222-4222-8222-222222222222';
const ORG_NAME = 'Demo Org Lifecycle';
const ADMIN = 'demo-lc-admin';

async function main() {
  // 0. Frisch anlegen (falls ein früherer Lauf abgebrochen wurde: erst weg damit).
  const existing = await withTenant(DEMO_ORG, (tx) =>
    tx.organization.findUnique({ where: { id: DEMO_ORG } }),
  );
  if (existing) {
    await withTenant(DEMO_ORG, (tx) => tx.$executeRaw`SELECT delete_organization(${DEMO_ORG}::uuid)`);
  }
  await withTenant(DEMO_ORG, async (tx) => {
    await tx.organization.create({
      data: { id: DEMO_ORG, clerkOrgId: 'demo_org_lifecycle', name: ORG_NAME },
    });
    await tx.membership.create({ data: { orgId: DEMO_ORG, userId: ADMIN, role: 'admin' } });
  });

  // 1. Wissen anlegen und beweisen, dass es wirkt.
  const { documentId } = await ingestDocument({
    orgId: DEMO_ORG,
    actorId: ADMIN,
    title: 'Homeoffice-Regelung',
    source: 'manual',
    text: 'Mitarbeitende dürfen bis zu drei Tage pro Woche im Homeoffice arbeiten.',
  });
  const before = await answerQuestion({
    orgId: DEMO_ORG, actorId: ADMIN, question: 'Wie viele Tage Homeoffice pro Woche sind erlaubt?',
  });
  console.log(`1️⃣  Antwort mit Wissen: ${before.answer.split('\n')[0]}`);

  // 2. Vollexport.
  const data = await exportOrgData({ orgId: DEMO_ORG, actorUserId: ADMIN });
  const counts = Object.entries(data)
    .filter(([, v]) => Array.isArray(v))
    .map(([k, v]) => `${k}=${(v as unknown[]).length}`)
    .join(', ');
  console.log(`\n2️⃣  Export (Art. 20): ${counts}`);

  // 3. Dokument löschen → ehrliche Kein-Wissen-Antwort.
  const del = await deleteDocument({ orgId: DEMO_ORG, actorUserId: ADMIN, documentId });
  const after = await answerQuestion({
    orgId: DEMO_ORG, actorId: ADMIN, question: 'Wie viele Tage Homeoffice pro Woche sind erlaubt?',
  });
  if (after.answer !== NO_KNOWLEDGE_ANSWER) throw new Error('DEMO FAILED: Wissen nicht gelöscht.');
  console.log(`\n3️⃣  "${del.title}" gelöscht (${del.chunkCount} Chunks) → Antwort jetzt: ${after.answer}`);

  // 4. Person aus dem Audit-Trail pseudonymisieren.
  const rewritten = await pseudonymizeAuditActor({
    orgId: DEMO_ORG, actorUserId: ADMIN, oldActorId: ADMIN, newActorId: 'erased-person-1',
  });
  const leak = await withTenant(DEMO_ORG, (tx) =>
    tx.auditLog.count({ where: { actorId: ADMIN } }),
  );
  if (leak !== 0) throw new Error('DEMO FAILED: alte Kennung noch im Audit.');
  console.log(
    `\n4️⃣  Pseudonymisiert: ${rewritten.actorRows} Akteur-Einträge + ${rewritten.detailRows} Detail-Payloads, alte Kennung 0× vorhanden.`,
  );

  // 5. Tenant-Offboarding mit Löschnachweis. (Die Pseudonymisierung betrifft
  // nur den Audit-Trail — die Membership des Admins besteht weiter.)
  const proof = await deleteOrganization({
    orgId: DEMO_ORG, actorUserId: ADMIN, confirmName: ORG_NAME,
  });
  console.log('\n5️⃣  Organisation gelöscht. Löschnachweis:');
  console.log(`    ${JSON.stringify(proof.counts)}`);

  const gone = await withTenant(DEMO_ORG, (tx) => tx.organization.count());
  if (gone !== 0) throw new Error('DEMO FAILED: Organisation existiert noch.');
  console.log(
    '\n✅  Demo erfolgreich: Export → Dokument-Löschung → Pseudonymisierung → Offboarding,' +
      '\n    alles tenant-gebunden; der Audit-Trail blieb bis zur Org-Löschung append-only.',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
