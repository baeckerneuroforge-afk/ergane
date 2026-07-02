// =============================================================================
// `pnpm seed:demo` — Demo-Daten für Screenshots: die "Nordwind GmbH".
//
// Legt an: 4 Wissens-Dokumente (verschiedene Sichtbarkeiten), 2 Chat-Verläufe,
// 5 skill_runs in verschiedenen Zuständen (completed, awaiting_approval mit
// 1.240 €, rejected) samt passenden approvals — alles über die BESTEHENDEN
// Funktionen (ingestDocument, answerQuestion, startRun, approve, reject),
// nicht per Raw-Insert, damit die Audit-Kette echt ist.
//
// Idempotent: vor dem Anlegen werden die Daten der Demo-Org gelöscht. Das darf
// nur die Owner-Verbindung (DIRECT_DATABASE_URL): audit_log ist append-only
// (Trigger), deshalb läuft das Aufräumen mit session_replication_role=replica
// in EINER Transaktion — exakt das Muster der Test-Suite (dort via TRUNCATE).
//
// Provider: mit VOYAGE_API_KEY/ANTHROPIC_API_KEY die echten, sonst die
// deterministischen Fakes (kein Netzwerk nötig) — Auswahl wie überall via
// src/lib/ai.
// =============================================================================
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { answerQuestion, ingestDocument } from '../src/lib/rag';
import { approve, reject, startRun } from '../src/lib/skills';

const DEMO_ORG = '99999999-9999-4999-8999-999999999999';
const DEMO_CLERK_ORG = 'demo_org_nordwind';
const DEMO_ORG_NAME = 'Nordwind GmbH';

const ADMIN = 'demo-admin';
const LEAD = 'demo-lead';
const MEMBER = 'demo-member';

const DOCUMENTS = [
  {
    title: 'Urlaubsrichtlinie 2026',
    visibility: 'open' as const,
    text: [
      'Alle Mitarbeitenden der Nordwind GmbH haben Anspruch auf 30 Urlaubstage pro Kalenderjahr.',
      'Resturlaub muss bis zum 31. März des Folgejahres genommen werden, danach verfällt er.',
      'Urlaubsanträge werden über das HR-Portal gestellt und von der Teamleitung freigegeben.',
    ].join('\n\n'),
  },
  {
    title: 'Reisekostenrichtlinie',
    visibility: 'open' as const,
    text: [
      'Dienstreisen sind vor Antritt über das Reiseportal zu genehmigen.',
      'Bahnfahrten werden in der 2. Klasse erstattet, ab vier Stunden Fahrzeit in der 1. Klasse.',
      'Die Verpflegungspauschale beträgt 28 Euro pro vollem Reisetag innerhalb Deutschlands.',
    ].join('\n\n'),
  },
  {
    title: 'Kundenkonditionen Q3',
    visibility: 'restricted' as const,
    text: [
      'Rahmenvertragskunden erhalten im dritten Quartal einen Projektrabatt von 8 Prozent.',
      'Zahlungsziel für Bestandskunden: 30 Tage netto; Neukunden: 14 Tage netto.',
    ].join('\n\n'),
  },
  {
    title: 'Gehaltsbänder 2026',
    visibility: 'confidential' as const,
    text: [
      'Gehaltsband Junior: 42.000 bis 54.000 Euro. Gehaltsband Senior: 62.000 bis 84.000 Euro.',
      'Anpassungen erfolgen jährlich zum 1. April auf Basis der Leistungsbeurteilung.',
    ].join('\n\n'),
  },
];

// Owner-Verbindung NUR fürs idempotente Aufräumen (wie tests/*).
const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function wipeDemoOrg() {
  await admin.$transaction(async (tx) => {
    // Superuser + replica-Modus: der Append-only-Trigger auf audit_log feuert
    // nicht. Replica deaktiviert aber auch die FK-Trigger (kein CASCADE!),
    // deshalb werden alle Tenant-Tabellen explizit gelöscht — Kinder zuerst.
    await tx.$executeRawUnsafe(`SET session_replication_role = replica`);
    const where = { orgId: DEMO_ORG };
    await tx.chunk.deleteMany({ where });
    await tx.chatMessage.deleteMany({ where });
    await tx.skillStep.deleteMany({ where });
    await tx.approval.deleteMany({ where });
    await tx.skillRun.deleteMany({ where });
    await tx.approvalPolicy.deleteMany({ where });
    await tx.visibilityGrant.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.knowledgeItem.deleteMany({ where });
    await tx.document.deleteMany({ where });
    await tx.membership.deleteMany({ where });
    await tx.organization.deleteMany({ where: { id: DEMO_ORG } });
    await tx.$executeRawUnsafe(`SET session_replication_role = DEFAULT`);
  });
}

async function main() {
  if (!process.env.DIRECT_DATABASE_URL) {
    throw new Error('seed-demo: DIRECT_DATABASE_URL ist nicht gesetzt (Owner-Verbindung).');
  }

  console.log(`— Räume Demo-Org "${DEMO_ORG_NAME}" auf (idempotent)…`);
  await wipeDemoOrg();

  // Org + Mitglieder (Seed-Muster: withTenant, RLS-konform).
  await withTenant(DEMO_ORG, async (tx) => {
    await tx.organization.create({
      data: { id: DEMO_ORG, clerkOrgId: DEMO_CLERK_ORG, name: DEMO_ORG_NAME },
    });
    await tx.membership.createMany({
      data: [
        { orgId: DEMO_ORG, userId: ADMIN, role: 'admin' },
        { orgId: DEMO_ORG, userId: LEAD, role: 'lead' },
        { orgId: DEMO_ORG, userId: MEMBER, role: 'member' },
      ],
    });
    // Disclosure-Defaults wie prisma/seed.ts: restricted → lead+admin,
    // confidential → admin.
    await tx.visibilityGrant.createMany({
      data: [
        { orgId: DEMO_ORG, level: 'restricted', role: 'lead' },
        { orgId: DEMO_ORG, level: 'restricted', role: 'admin' },
        { orgId: DEMO_ORG, level: 'confidential', role: 'admin' },
      ],
    });
  });
  console.log(`— Org "${DEMO_ORG_NAME}" mit 3 Mitgliedschaften angelegt.`);

  // 4 Wissens-Dokumente über die echte Ingestion (Chunks + Embeddings + Audit).
  for (const doc of DOCUMENTS) {
    const { chunkCount } = await ingestDocument({
      orgId: DEMO_ORG,
      actorId: ADMIN,
      title: doc.title,
      source: 'manual',
      text: doc.text,
      visibility: doc.visibility,
    });
    console.log(`— Ingestiert: "${doc.title}" (${doc.visibility}, ${chunkCount} Chunks)`);
  }

  // 2 Chat-Verläufe (+ eine ehrliche Kein-Wissen-Antwort für den Hinweis-Stil).
  const QUESTIONS = [
    'Wie viele Urlaubstage haben Mitarbeitende pro Jahr?',
    'Welche Klasse wird bei Bahnfahrten erstattet?',
    'Wie lautet das WLAN-Passwort im Büro Hamburg?',
  ];
  for (const question of QUESTIONS) {
    const { sources } = await answerQuestion({
      orgId: DEMO_ORG,
      actorId: ADMIN,
      question,
      role: 'admin',
    });
    console.log(`— Chat: "${question}" → ${sources.length ? `Quellen: ${sources.join(', ')}` : 'kein Wissen'}`);
  }

  // 5 Skill-Runs in verschiedenen Zuständen — komplett über die Engine.
  const r1 = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Bahnticket München–Hamburg, Kundentermin',
    betragEur: 187.5,
    belegNummer: 'B-2026-0311',
  });
  const r2 = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Bürobedarf: Toner und Papier',
    betragEur: 89.9,
    belegNummer: 'B-2026-0312',
  });

  const r3 = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Softwarelizenz Jahresvertrag CRM',
    betragEur: 1490,
    belegNummer: 'B-2026-0313',
  });
  if (r3.status !== 'awaiting_approval') {
    throw new Error(`seed-demo: erwartet awaiting_approval, erhalten ${r3.status}`);
  }
  const r3Done = await approve(DEMO_ORG, r3.runId, LEAD);

  const r4 = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Serverhardware für Staging-Umgebung',
    betragEur: 1240,
    belegNummer: 'B-2026-0314',
  });

  const r5 = await startRun(DEMO_ORG, 'beleg_kontieren', {
    beschreibung: 'Bewirtung Team-Offsite',
    betragEur: 1120,
    belegNummer: 'B-2026-0315',
  });
  const r5Done = await reject(DEMO_ORG, r5.runId, LEAD);

  console.log(`— Runs: ${r1.status}, ${r2.status}, ${r3Done.status} (nach approve), ${r4.status} (1.240 €), ${r5Done.status} (nach reject)`);

  const { runs, approvals, audits } = await withTenant(DEMO_ORG, async (tx) => ({
    runs: await tx.skillRun.count(),
    approvals: await tx.approval.count(),
    audits: await tx.auditLog.count(),
  }));
  console.log(`\n✅  Demo-Seed fertig: ${DOCUMENTS.length} Dokumente, ${QUESTIONS.length} Chat-Fragen, ${runs} Runs, ${approvals} Approvals, ${audits} Audit-Einträge.`);
}

main()
  .then(async () => {
    await prisma.$disconnect();
    await admin.$disconnect();
  })
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    await admin.$disconnect();
    process.exit(1);
  });
