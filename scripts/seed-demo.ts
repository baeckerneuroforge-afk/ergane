// =============================================================================
// `pnpm seed:demo` — Demo-Daten für Screenshots: die "Nordwind GmbH".
//
// Legt an: 6 Wissens-/Firmenwissen-Dokumente (verschiedene Sichtbarkeiten),
// 2 fiktive Kundengespräch-Transkripte (source 'transcript', restricted) als
// Rohmaterial für den `transkript_zu_framework`-Skill, mehrere Chat-Verläufe,
// 9 skill_runs in verschiedenen Zuständen (completed, awaiting_approval mit
// 1.240 €, rejected, plus je ein Run pro Katalog-Skill: read-only completed,
// Angebot awaiting wegen externer Wirkung, Rechnung approved + awaiting)
// samt passenden approvals — alles über die BESTEHENDEN
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
import { createClient } from '../src/lib/clients';
import { answerQuestion, ingestDocument } from '../src/lib/rag';
import { approve, reject, startRun } from '../src/lib/skills';

const DEMO_ORG = '99999999-9999-4999-8999-999999999999';
const DEMO_CLERK_ORG = 'demo_org_nordwind';
const DEMO_ORG_NAME = 'Nordwind GmbH';
/** Demo customer for client-tracker surfaces after seed. */
const DEMO_CLIENT_NAME = 'Hanse Logistik GmbH';

const ADMIN = 'demo-admin';
const LEAD = 'demo-lead';
const MEMBER = 'demo-member';

// Wissens-Dokumente + Firmenwissen der Nordwind GmbH (source 'manual').
const DOCUMENTS = [
  {
    title: 'Urlaubsrichtlinie 2026',
    source: 'manual' as const,
    visibility: 'open' as const,
    text: [
      'Alle Mitarbeitenden der Nordwind GmbH haben Anspruch auf 30 Urlaubstage pro Kalenderjahr.',
      'Resturlaub muss bis zum 31. März des Folgejahres genommen werden, danach verfällt er.',
      'Urlaubsanträge werden über das HR-Portal gestellt und von der Teamleitung freigegeben.',
    ].join('\n\n'),
  },
  {
    title: 'Reisekostenrichtlinie',
    source: 'manual' as const,
    visibility: 'open' as const,
    text: [
      'Dienstreisen sind vor Antritt über das Reiseportal zu genehmigen.',
      'Bahnfahrten werden in der 2. Klasse erstattet, ab vier Stunden Fahrzeit in der 1. Klasse.',
      'Die Verpflegungspauschale beträgt 28 Euro pro vollem Reisetag innerhalb Deutschlands.',
    ].join('\n\n'),
  },
  {
    title: 'Kundenkonditionen Q3',
    source: 'manual' as const,
    visibility: 'restricted' as const,
    text: [
      'Rahmenvertragskunden erhalten im dritten Quartal einen Projektrabatt von 8 Prozent.',
      'Zahlungsziel für Bestandskunden: 30 Tage netto; Neukunden: 14 Tage netto.',
    ].join('\n\n'),
  },
  {
    title: 'Gehaltsbänder 2026',
    source: 'manual' as const,
    visibility: 'confidential' as const,
    text: [
      'Gehaltsband Junior: 42.000 bis 54.000 Euro. Gehaltsband Senior: 62.000 bis 84.000 Euro.',
      'Anpassungen erfolgen jährlich zum 1. April auf Basis der Leistungsbeurteilung.',
    ].join('\n\n'),
  },
  // --- Firmenwissen: Nordwinds eigene Methodik, damit ein aus einem Transkript
  //     abgeleitetes Framework mit dem Vorgehen des Hauses angereichert werden
  //     kann (open — für alle Rollen sichtbar). Fiktiv.
  {
    title: 'Nordwind Beratungsmethodik: Discovery-to-Framework',
    source: 'manual' as const,
    visibility: 'open' as const,
    text: [
      'Die Nordwind GmbH führt Einführungsprojekte in vier Phasen: Discovery, Framework, Pilot, Rollout. ' +
        'Jede Phase endet mit einem definierten Ergebnis und einer Freigabe durch die Kundenseite.',
      'In der Discovery-Phase werden in strukturierten Gesprächen die Pain Points, die Ziele, die betroffenen ' +
        'Stakeholder sowie die technischen und organisatorischen Rahmenbedingungen des Kunden erhoben. ' +
        'Grundsatz: Jede spätere Empfehlung muss auf eine konkrete Aussage aus der Discovery zurückführbar sein.',
      'In der Framework-Phase werden die Erkenntnisse zu Handlungsfeldern verdichtet. Ein belastbares Framework ' +
        'enthält mindestens drei priorisierte Use Cases, je einen messbaren Zielwert pro Use Case, eine grobe ' +
        'Aufwandsschätzung sowie eine Executive Summary für die Entscheiderebene.',
      'Priorisiert wird nach Wirkung und Umsetzbarkeit: hoher Nutzen bei geringem Aufwand zuerst (Quick Wins), ' +
        'aufwändige Grundlagenthemen als Fundament parallel, aber getrennt ausgewiesen.',
    ].join('\n\n'),
  },
  {
    title: 'Nordwind Leistungsportfolio 2026',
    source: 'manual' as const,
    visibility: 'open' as const,
    text: [
      'Die Nordwind GmbH begleitet mittelständische Unternehmen bei der Einführung datengetriebener Prozesse. ' +
        'Schwerpunkte sind Prozessanalyse, Anforderungsmanagement, Lösungsarchitektur und Change-Begleitung.',
      'Typische Engagements: ein zeitlich befristetes Discovery-Assessment (zwei bis vier Wochen), die Erstellung ' +
        'eines Einführungs-Frameworks als Entscheidungsgrundlage, sowie die fachliche Begleitung eines Pilotprojekts.',
      'Abrechnung erfolgt wahlweise als Festpreis je Phase oder auf Tagessatzbasis. Für Rahmenvertragskunden gelten ' +
        'die jeweils gültigen Projektkonditionen.',
    ].join('\n\n'),
  },
];

// =============================================================================
// Kundengespräch-Transkripte (source 'transcript') — FIKTIVE Demo-Daten.
//
// Rohmaterial für den kommenden `transkript_zu_framework`-Skill (Etappe 1):
// realistische Discovery-Calls mit benannten Pain Points, Zielen, Stakeholdern,
// Rahmenbedingungen, Zeitrahmen und Budget-Signalen — genug Substanz, dass sich
// ein Einführungs-Framework mit mehreren Use Cases daraus ableiten ließe.
//
// Alle Personen und Firmen (außer der Beraterseite "Nordwind") sind erfunden;
// keine echten Namen, Firmen oder Daten. Sichtbarkeit 'restricted': ein
// Vertriebs-/Kundengespräch ist internes Material (Nordwind gewährt
// restricted → lead + admin).
// =============================================================================
const TRANSCRIPT_DISCOVERY = [
  'Transkript — Discovery-Call · Küstenlicht Energie GmbH × Nordwind GmbH',
  'Datum: 12.06.2026 · Dauer: 48 Minuten · Aufzeichnung mit Einverständnis beider Seiten',
  'Teilnehmende: Frau Dr. Marek (Leiterin Kundenservice, Küstenlicht), Herr Voss (IT-Leiter, Küstenlicht), Frau Ohlsen (Beraterin, Nordwind)',
  '',
  'Ohlsen: Vielen Dank, dass Sie sich die Zeit nehmen. Damit ich Ihr Anliegen richtig verstehe: Wo drückt der Schuh im Moment am meisten?',
  'Dr. Marek: Am deutlichsten im Kundenservice. Wir sind ein regionaler Energieversorger mit rund achtzigtausend Privatkunden. Unser Serviceteam ertrinkt in wiederkehrenden Anfragen — Zählerstände, Abschlagsänderungen, Rechnungsfragen. Achtzig Prozent der Tickets sind Varianten derselben zehn Fragen.',
  'Ohlsen: Können Sie das in Zahlen fassen?',
  'Dr. Marek: Wir bekommen etwa neunhundert Kontakte pro Woche, verteilt auf Telefon, E-Mail und ein Kontaktformular. Die durchschnittliche Bearbeitungszeit liegt bei knapp einem Tag, in Spitzenzeiten — Jahresabrechnung im Frühjahr — sind es drei bis vier Tage. Das führt zu Beschwerden und bindet mein ganzes Team.',
  'Voss: Und die Daten liegen verstreut. Zählerstände im Abrechnungssystem, Kundenkommunikation im Ticketsystem, Vertragsdaten in einer dritten Anwendung. Wenn ein Mitarbeiter eine Frage beantwortet, klickt er sich durch drei Systeme.',
  'Ohlsen: Verstanden. Was wäre für Sie ein Erfolg — woran würden Sie in sechs Monaten merken, dass sich etwas verbessert hat?',
  'Dr. Marek: Erstens: Die Standardanfragen sollten die Kunden selbst lösen können, ohne uns. Zweitens: Wenn ein Mitarbeiter doch ran muss, will ich, dass er die Antwort in einer Ansicht hat, nicht in dreien. Drittens: Die Bearbeitungszeit für die einfachen Fälle soll unter zwei Stunden fallen.',
  'Ohlsen: Gibt es Rahmenbedingungen, die ich kennen muss? Technisch oder organisatorisch?',
  'Voss: Ja, mehrere. Das Abrechnungssystem ist ein Altsystem, an das wir nur über eine schmale Schnittstelle herankommen — Nur-Lese-Zugriff, nächtlicher Export. Ein direkter Schreibzugriff ist tabu, da hängt die Regulierung dran. Und wir sind an Datenschutz gebunden; Kundendaten dürfen die EU nicht verlassen.',
  'Dr. Marek: Organisatorisch: Mein Team ist skeptisch. Es gab vor zwei Jahren ein Digitalisierungsprojekt, das im Sand verlaufen ist. Wenn wir das machen, muss es kleine, sichtbare Erfolge geben, nicht erst nach einem Jahr.',
  'Ohlsen: Das ist ein wichtiger Punkt. Wer entscheidet am Ende über das Budget?',
  'Dr. Marek: Die Freigabe liegt bei der Geschäftsführung, konkret bei unserem CFO. Für einen Piloten habe ich ein eigenes Budget im niedrigen fünfstelligen Bereich, ohne dass ich groß fragen muss. Für einen Rollout bräuchte ich einen Business Case, den der CFO sieht.',
  'Ohlsen: Und ein zeitlicher Rahmen?',
  'Dr. Marek: Vor der nächsten Jahresabrechnung im März muss spürbar etwas stehen. Ideal wäre ein Pilot im vierten Quartal, damit wir zur Spitzenlast im Frühjahr entlastet sind.',
  'Voss: Von meiner Seite: Ich kann Ressourcen für die Schnittstellen bereitstellen, aber nicht unbegrenzt. Ein halber Entwicklertag pro Woche über das Quartal ist realistisch, mehr nicht.',
  'Ohlsen: Sehr hilfreich. Lassen Sie mich zusammenfassen, was ich mitnehme: Der größte Hebel ist die Selbstbedienung für die zehn häufigsten Anfragen. Der zweite ist eine zusammengeführte Ansicht für die Mitarbeiter, damit sie nicht drei Systeme durchsuchen. Rahmen: Nur-Lese-Zugriff auf das Altsystem, EU-Datenhaltung, ein skeptisches Team, das frühe Erfolge braucht, ein Pilotbudget im niedrigen fünfstelligen Bereich und ein Zeitfenster bis März.',
  'Dr. Marek: Das trifft es. Wenn Sie mir daraus einen klaren Fahrplan machen können — welche Use Cases zuerst, was sie bringen, was sie kosten — dann habe ich etwas, das ich dem CFO vorlegen kann.',
  'Ohlsen: Genau das ist der nächste Schritt. Ich bereite ein Framework auf: priorisierte Use Cases mit Zielwerten und grober Aufwandsschätzung, plus eine Executive Summary für Ihren CFO. Melden würde ich mich nächste Woche.',
  'Dr. Marek: Perfekt. Vielen Dank.',
].join('\n');

const TRANSCRIPT_FOLLOWUP = [
  'Transkript — Kurzes Abstimmungsgespräch · Küstenlicht Energie GmbH × Nordwind GmbH',
  'Datum: 19.06.2026 · Dauer: 17 Minuten',
  'Teilnehmende: Herr Voss (IT-Leiter, Küstenlicht), Frau Ohlsen (Beraterin, Nordwind)',
  '',
  'Ohlsen: Danke, dass Sie kurz Zeit haben. Ich möchte vor dem Framework zwei technische Punkte absichern.',
  'Voss: Gern.',
  'Ohlsen: Erstens der nächtliche Export aus dem Abrechnungssystem — in welchem Format liegt der vor, und wie aktuell sind die Zählerstände darin?',
  'Voss: Es ist ein CSV-Export, jede Nacht um zwei Uhr. Die Zählerstände sind damit maximal einen Tag alt. Für Abschlags- und Rechnungsfragen reicht das völlig; das ändert sich ja nicht stündlich.',
  'Ohlsen: Gut, das heißt, für die Selbstbedienung können wir auf diesem Tagesstand aufsetzen, ohne den Live-Zugriff zu brauchen. Zweitens: Wenn ein Kunde im Self-Service nicht weiterkommt und an einen Mitarbeiter übergeben wird — dürfen wir den bisherigen Verlauf mitgeben?',
  'Voss: Ja, solange es innerhalb unserer Systeme bleibt und die EU-Datenhaltung gewahrt ist. Was nicht geht, ist, die Daten an einen externen Dienst außerhalb der EU zu schicken.',
  'Ohlsen: Verstanden, das halte ich als harte Rahmenbedingung fest. Letzte Frage: Gibt es eine Kennzahl, an der Ihre Geschäftsführung den Erfolg festmachen wird?',
  'Voss: Der CFO schaut auf zwei Dinge: die Zahl der Kontakte, die das Team überhaupt erreichen, und die durchschnittliche Bearbeitungszeit. Wenn beide sichtbar sinken, ist er überzeugt.',
  'Ohlsen: Damit kann ich arbeiten. Ich baue diese beiden Kennzahlen als Zielwerte ins Framework ein. Danke, Herr Voss.',
  'Voss: Danke Ihnen.',
].join('\n');

const TRANSCRIPTS = [
  {
    title: 'Discovery-Call Küstenlicht Energie (Transkript)',
    text: TRANSCRIPT_DISCOVERY,
  },
  {
    title: 'Abstimmung Küstenlicht Energie (Transkript)',
    text: TRANSCRIPT_FOLLOWUP,
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
    await tx.chatFeedback.deleteMany({ where }).catch(() => {});
    await tx.skillStep.deleteMany({ where });
    await tx.approval.deleteMany({ where });
    await tx.skillRun.deleteMany({ where });
    await tx.artifact.deleteMany({ where }).catch(() => {});
    await tx.client.deleteMany({ where }).catch(() => {});
    await tx.approvalPolicy.deleteMany({ where });
    await tx.visibilityGrant.deleteMany({ where });
    await tx.auditLog.deleteMany({ where });
    await tx.knowledgeItem.deleteMany({ where });
    await tx.document.deleteMany({ where });
    await tx.orgSettings.deleteMany({ where }).catch(() => {});
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

  // Wissens- & Firmenwissen-Dokumente über die echte Ingestion (Chunks + Embeddings + Audit).
  for (const doc of DOCUMENTS) {
    const { chunkCount } = await ingestDocument({
      orgId: DEMO_ORG,
      actorId: ADMIN,
      title: doc.title,
      source: doc.source,
      text: doc.text,
      visibility: doc.visibility,
    });
    console.log(`— Ingestiert: "${doc.title}" (${doc.source}, ${doc.visibility}, ${chunkCount} Chunks)`);
  }

  // Kundengespräch-Transkripte über dieselbe Ingestion — source 'transcript',
  // restricted. Genau das Rohmaterial, das der `transkript_zu_framework`-Skill
  // (Etappe 1) aufnimmt und zu einem Framework verdichtet.
  for (const t of TRANSCRIPTS) {
    const { chunkCount } = await ingestDocument({
      orgId: DEMO_ORG,
      actorId: ADMIN,
      title: t.title,
      source: 'transcript',
      text: t.text,
      visibility: 'restricted',
    });
    console.log(`— Transkript ingestiert: "${t.title}" (transcript, restricted, ${chunkCount} Chunks)`);
  }

  // Chat-Verläufe (+ eine ehrliche Kein-Wissen-Antwort für den Hinweis-Stil,
  // + eine Frage, deren Antwort nur im Discovery-Transkript steht — zeigt, dass
  // das Transkript als Wissen retrieval-bar ist).
  const QUESTIONS = [
    'Wie viele Urlaubstage haben Mitarbeitende pro Jahr?',
    'Welche Klasse wird bei Bahnfahrten erstattet?',
    'Welche Rahmenbedingungen nannte Küstenlicht Energie im Discovery-Call?',
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

  // 5 beleg_kontieren-Runs in verschiedenen Zuständen — komplett über die Engine.
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

  // Client hub demo: one named customer + clientId on subsequent runs.
  const demoClient = await createClient({
    orgId: DEMO_ORG,
    actorUserId: ADMIN,
    name: DEMO_CLIENT_NAME,
    notes: 'Demo customer — discovery + offer path for YC walkthrough.',
  });
  console.log(`— Client "${demoClient.name}" (${demoClient.id}) angelegt.`);

  // Katalog-Skills (je ein Beispiel-Run pro neuem Skill, über die Engine):
  // read-only läuft direkt durch; Angebot pausiert wegen externer Wirkung;
  // Rechnung einmal freigegeben, einmal wartend. `rolle` ist die Rolle des
  // Auslösers (Disclosure-Filter des Wissens-Retrievals in den Steps).
  const r6 = await startRun(
    DEMO_ORG,
    'wissen_zusammenfassen',
    {
      frage: 'Wie viele Urlaubstage haben Mitarbeitende pro Kalenderjahr?',
      rolle: 'member',
    },
    { clientId: demoClient.id },
  );
  if (r6.status !== 'completed') {
    throw new Error(`seed-demo: wissen_zusammenfassen erwartet completed, erhalten ${r6.status}`);
  }

  const r7 = await startRun(
    DEMO_ORG,
    'angebot_erstellen',
    {
      kunde: DEMO_CLIENT_NAME,
      leistung: 'Projektunterstützung Rahmenvertrag Q3',
      betragEur: 4800,
      rolle: 'lead',
    },
    { clientId: demoClient.id },
  );
  if (r7.status !== 'awaiting_approval') {
    throw new Error(`seed-demo: angebot_erstellen erwartet awaiting_approval, erhalten ${r7.status}`);
  }

  const r8 = await startRun(DEMO_ORG, 'rechnung_erstellen', {
    kunde: 'Möbelwerk Nord GmbH',
    positionen: [
      { bezeichnung: 'Beratungsleistung März', betragEur: 1800 },
      { bezeichnung: 'Workshoptag vor Ort', betragEur: 950 },
    ],
    rolle: 'lead',
  });
  if (r8.status !== 'awaiting_approval') {
    throw new Error(`seed-demo: rechnung_erstellen erwartet awaiting_approval, erhalten ${r8.status}`);
  }
  const r8Done = await approve(DEMO_ORG, r8.runId, LEAD);

  const r9 = await startRun(DEMO_ORG, 'rechnung_erstellen', {
    kunde: 'Baltic Trading UG',
    positionen: [{ bezeichnung: 'Wartungsvertrag Jahrespauschale', betragEur: 2400 }],
    rolle: 'lead',
  });

  console.log(
    `— Katalog-Runs: wissen_zusammenfassen ${r6.status} (client-linked), angebot_erstellen ${r7.status} (externe Wirkung, client-linked), ` +
      `rechnung_erstellen ${r8Done.status} (nach approve) + ${r9.status} (2.400 €)`,
  );

  const { runs, approvals, audits, linkedRuns } = await withTenant(DEMO_ORG, async (tx) => ({
    runs: await tx.skillRun.count(),
    approvals: await tx.approval.count(),
    audits: await tx.auditLog.count(),
    linkedRuns: await tx.skillRun.count({ where: { clientId: demoClient.id } }),
  }));
  console.log(
    `\n✅  Demo-Seed fertig: ${DOCUMENTS.length} Dokumente + ${TRANSCRIPTS.length} Transkripte, ` +
      `${QUESTIONS.length} Chat-Fragen, ${runs} Runs (${linkedRuns} mit Client "${DEMO_CLIENT_NAME}"), ` +
      `${approvals} Approvals, ${audits} Audit-Einträge.`,
  );
  const pendingApprovals = await withTenant(DEMO_ORG, (tx) =>
    tx.approval.count({ where: { status: 'pending' } }),
  );
  if (pendingApprovals < 1) {
    throw new Error('seed-demo: expected at least one pending approval for the demo approve moment');
  }
  console.log(`— Pending approvals for live demo: ${pendingApprovals} (open /dashboard/approvals)`);

  console.log(
    `\nDemo tips:\n` +
      `  • Clerk org: set slug "demo" or "nordwind", or DEMO_ORG_SLUGS / clerk id "${DEMO_CLERK_ORG}"\n` +
      `  • Seed tenant UUID is FIXED (${DEMO_ORG}); UI org UUID = clerkOrgIdToUuid(your Clerk org id)\n` +
      `    → to share data with a live Clerk session, set DEMO_CLERK_ORG + DEMO_ORG accordingly (see docs/yc-demo-runbook.md)\n` +
      `  • Client hub: /dashboard/clients (Hanse Logistik)\n` +
      `  • Pending approve moment: ${pendingApprovals} approval(s) — angebot for ${DEMO_CLIENT_NAME}\n` +
      `  • Isolation demo: /demo/isolation (demo org only)\n` +
      `  • Full script: docs/yc-demo-runbook.md\n`,
  );
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
