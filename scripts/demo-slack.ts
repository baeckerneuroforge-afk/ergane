// =============================================================================
// `pnpm demo:slack` — der Slack-Eingang end-to-end, OHNE echten Slack-Account.
//
// Baut signierte HTTP-Requests (mit einem Demo-Signing-Secret) und ruft damit
// GENAU die drei Route-Handler auf, die auch hinter /api/slack/* stehen.
// Ausgehende Slack-Nachrichten (chat.postMessage) werden über setSlackPoster()
// abgefangen und ausgegeben — kein Netzwerk, kein Bot-Token nötig.
//
// Gezeigt werden:
//   0. Sicherheits-Gates: ungültige Signatur ⇒ 401, fremdes Team ⇒ 403
//   1. Frage via @mention → Antwort mit kanonischer "Quellen:"-Zeile im Thread
//   2. /ergane skill … → awaiting_approval → Nachricht mit Freigeben/Ablehnen
//   3. Button-Klicks: unverlinkter Nutzer und member werden abgewiesen
//      (ephemer), lead gibt frei → Run completed. Alles auditiert "via slack".
// =============================================================================
import 'dotenv/config';

// Das Demo-Secret MUSS vor den Handler-Aufrufen stehen (Handler lesen es pro
// Request); ein echtes Secret aus .env wird hier bewusst überschrieben, damit
// die selbstgebauten Signaturen stimmen.
const DEMO_SECRET = 'demo-slack-signing-secret';
process.env.SLACK_SIGNING_SECRET = DEMO_SECRET;

import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { ingestDocument } from '../src/lib/rag';
import { computeSlackSignature } from '../src/lib/slack/verify';
import {
  handleSlackCommands,
  handleSlackEvents,
  handleSlackInteractions,
} from '../src/lib/slack/handlers';
import { setSlackPoster, type SlackOutgoingMessage } from '../src/lib/slack/client';

const DEMO_ORG = '33333333-3333-4333-8333-333333333333';
const TEAM = 'T_DEMO_ERGANE';
const LEAD = { userId: 'demo-lead-lena', slackId: 'U_LEAD_LENA' };
const MEMBER = { userId: 'demo-member-max', slackId: 'U_MEMBER_MAX' };
const STRANGER = 'U_FREMD_FRANZI'; // nicht verlinkt

// --- signierte Requests (identisch zu dem, was Slack senden würde) ------------

function signedRequest(body: string, contentType: string): Request {
  const timestamp = Math.floor(Date.now() / 1000);
  return new Request('http://localhost:3000/api/slack/demo', {
    method: 'POST',
    headers: {
      'content-type': contentType,
      'x-slack-request-timestamp': String(timestamp),
      'x-slack-signature': computeSlackSignature(DEMO_SECRET, timestamp, body),
    },
    body,
  });
}

function mentionEvent(teamId: string, slackUserId: string, text: string): Request {
  const body = JSON.stringify({
    type: 'event_callback',
    team_id: teamId,
    event: { type: 'app_mention', user: slackUserId, text, channel: 'C_DEMO', ts: '1000.0001' },
  });
  return signedRequest(body, 'application/json');
}

function command(slackUserId: string, text: string): Request {
  const body = new URLSearchParams({
    command: '/ergane',
    team_id: TEAM,
    user_id: slackUserId,
    channel_id: 'C_DEMO',
    text,
  }).toString();
  return signedRequest(body, 'application/x-www-form-urlencoded');
}

function buttonClick(slackUserId: string, actionId: string, runId: string): Request {
  const body = new URLSearchParams({
    payload: JSON.stringify({
      type: 'block_actions',
      team: { id: TEAM },
      user: { id: slackUserId },
      channel: { id: 'C_DEMO' },
      message: { ts: '1000.0001' },
      actions: [{ action_id: actionId, value: runId }],
    }),
  }).toString();
  return signedRequest(body, 'application/x-www-form-urlencoded');
}

// --- Ausgehende Slack-Nachrichten abfangen -------------------------------------

const outbox: SlackOutgoingMessage[] = [];
setSlackPoster(async (msg) => {
  outbox.push(msg);
  const kind = msg.ephemeralUserId ? `ephemer → ${msg.ephemeralUserId}` : `#${msg.channel}`;
  console.log(`   📤 Slack-Nachricht (${kind}):\n      ${msg.text.split('\n').join('\n      ')}`);
});

async function seed() {
  await withTenant(DEMO_ORG, async (tx) => {
    await tx.organization.upsert({
      where: { id: DEMO_ORG },
      create: { id: DEMO_ORG, clerkOrgId: 'demo_org_slack', name: 'Demo Org Slack' },
      update: {},
    });
    for (const m of [
      { userId: LEAD.userId, role: 'lead' as const },
      { userId: MEMBER.userId, role: 'member' as const },
    ]) {
      await tx.membership.upsert({
        where: { orgId_userId: { orgId: DEMO_ORG, userId: m.userId } },
        create: { orgId: DEMO_ORG, ...m },
        update: { role: m.role },
      });
    }
    const installation = await tx.slackInstallation.findFirst({ where: { slackTeamId: TEAM } });
    if (!installation) {
      await tx.slackInstallation.create({
        data: { orgId: DEMO_ORG, slackTeamId: TEAM, botTokenRef: 'env:SLACK_BOT_TOKEN' },
      });
    }
    for (const link of [
      { slackUserId: LEAD.slackId, userId: LEAD.userId },
      { slackUserId: MEMBER.slackId, userId: MEMBER.userId },
    ]) {
      const existing = await tx.slackUserLink.findUnique({
        where: { orgId_slackUserId: { orgId: DEMO_ORG, slackUserId: link.slackUserId } },
      });
      if (!existing) await tx.slackUserLink.create({ data: { orgId: DEMO_ORG, ...link } });
    }
    // Freigabe-Policy: beleg_kontieren braucht IMMER eine Freigabe durch lead+.
    await tx.approvalPolicy.upsert({
      where: { orgId_skillKey: { orgId: DEMO_ORG, skillKey: 'beleg_kontieren' } },
      create: { orgId: DEMO_ORG, skillKey: 'beleg_kontieren', mode: 'always', approverRole: 'lead' },
      update: { mode: 'always', approverRole: 'lead' },
    });
  });

  const doc = await withTenant(DEMO_ORG, (tx) =>
    tx.document.findFirst({ where: { title: 'Reisekostenrichtlinie' } }),
  );
  if (!doc) {
    await ingestDocument({
      orgId: DEMO_ORG,
      actorId: 'demo-slack-seed',
      title: 'Reisekostenrichtlinie',
      source: 'manual',
      text: 'Bahnfahrten zweiter Klasse werden vollständig erstattet. Hotelübernachtungen bis 120 Euro pro Nacht.',
    });
  }
}

async function main() {
  await seed();
  console.log(`Demo-Org: ${DEMO_ORG} — Slack-Team ${TEAM} gemappt, 2 Nutzer verlinkt.\n`);

  // ── 0) Sicherheits-Gates ────────────────────────────────────────────────────
  console.log('── 0) Sicherheits-Gates ──');
  const badSig = new Request('http://localhost:3000/api/slack/demo', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-slack-request-timestamp': String(Math.floor(Date.now() / 1000)),
      'x-slack-signature': 'v0=0000000000000000000000000000000000000000000000000000000000000000',
    },
    body: JSON.stringify({ type: 'url_verification', challenge: 'x' }),
  });
  console.log(`   Ungültige Signatur   → HTTP ${(await handleSlackEvents(badSig)).status} (erwartet 401)`);
  const foreign = await handleSlackEvents(mentionEvent('T_FREMDES_TEAM', LEAD.slackId, 'Hallo?'));
  console.log(`   Nicht gemapptes Team → HTTP ${foreign.status} (erwartet 403)`);

  // ── 1) Frage via @mention → Antwort mit Quelle im Thread ───────────────────
  console.log('\n── 1) Frage via @mention (Events API) ──');
  console.log(`   💬 ${LEAD.slackId}: "@ergane Werden Bahnfahrten zweiter Klasse erstattet?"`);
  const events = await handleSlackEvents(
    mentionEvent(TEAM, LEAD.slackId, '<@UBOT> Werden Bahnfahrten zweiter Klasse erstattet?'),
  );
  if (events.status !== 200) throw new Error(`DEMO FAILED: events → ${events.status}`);
  const answer = outbox.at(-1);
  if (!answer?.text.includes('Quellen:')) {
    throw new Error('DEMO FAILED: Antwort ohne kanonische Quellen-Zeile.');
  }

  // ── 2) /ergane skill → Guardrail/Policy pausiert, Buttons kommen ───────────
  console.log('\n── 2) /ergane skill beleg_kontieren (1.240 €) ──');
  const cmdRes = await handleSlackCommands(
    command(MEMBER.slackId, 'skill beleg_kontieren {"beschreibung":"Softwarelizenz Jahresvertrag","betragEur":1240}'),
  );
  const cmdBody = (await cmdRes.json()) as {
    text: string;
    blocks?: Array<{ elements?: Array<{ action_id: string; value: string; text: { text: string } }> }>;
  };
  console.log(`   📥 Antwort an den Kanal: ${cmdBody.text}`);
  const buttons = cmdBody.blocks?.find((b) => Array.isArray(b.elements))?.elements ?? [];
  const runId = buttons.find((b) => b.action_id === 'ergane_approve')?.value;
  if (!runId) throw new Error('DEMO FAILED: keine Freigabe-Buttons erhalten.');
  console.log(`   🔘 Buttons: ${buttons.map((b) => b.text.text).join(' / ')} (Run ${runId.slice(0, 8)}…)`);

  // ── 3) Button-Klicks: fail-closed, Rollen-Gate, Freigabe ───────────────────
  console.log('\n── 3a) Unverlinkter Nutzer klickt „Freigeben" (muss scheitern) ──');
  await handleSlackInteractions(buttonClick(STRANGER, 'ergane_approve', runId));

  console.log('\n── 3b) member klickt „Freigeben" — Policy verlangt lead (muss scheitern) ──');
  await handleSlackInteractions(buttonClick(MEMBER.slackId, 'ergane_approve', runId));

  const stillWaiting = await withTenant(DEMO_ORG, (tx) =>
    tx.skillRun.findUniqueOrThrow({ where: { id: runId } }),
  );
  if (stillWaiting.status !== 'awaiting_approval') {
    throw new Error(`DEMO FAILED: Run hätte awaiting_approval bleiben müssen (ist: ${stillWaiting.status}).`);
  }

  console.log('\n── 3c) lead klickt „Freigeben" (berechtigt) ──');
  await handleSlackInteractions(buttonClick(LEAD.slackId, 'ergane_approve', runId));
  const done = await withTenant(DEMO_ORG, (tx) =>
    tx.skillRun.findUniqueOrThrow({ where: { id: runId } }),
  );
  if (done.status !== 'completed') {
    throw new Error(`DEMO FAILED: erwartet completed, ist ${done.status}.`);
  }

  // ── Audit-Kette „via slack" ─────────────────────────────────────────────────
  const audit = await withTenant(DEMO_ORG, (tx) =>
    tx.auditLog.findMany({
      where: { action: { startsWith: 'slack.' } },
      orderBy: { createdAt: 'asc' },
    }),
  );
  console.log('\n🧾  Slack-Audit-Einträge (append-only, alle mit detail.via = "slack"):');
  for (const a of audit.slice(-8)) {
    console.log(`    ${a.createdAt.toISOString()}  ${a.actorType}/${a.actorId}  ${a.action}  → ${a.target ?? ''}`);
  }

  console.log(
    '\n✅  Demo erfolgreich: Signatur-Gate (401), Team-Gate (403), Antwort mit Quelle,' +
      '\n    Skill → awaiting_approval mit Buttons, fail-closed Klicks (unverlinkt/member),' +
      '\n    Freigabe durch lead → completed. Alles tenant-gebunden und auditiert.',
  );
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (err) => {
    console.error(err);
    await prisma.$disconnect();
    process.exit(1);
  });
