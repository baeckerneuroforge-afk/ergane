// The three Slack entry points as plain (Request → Response) functions.
//
// The Next.js route files (src/app/api/slack/*/route.ts) export these directly;
// tests and `pnpm demo:slack` call them with hand-signed Requests — same code
// path, no HTTP server needed.
//
// Every handler follows the SAME hard sequence, in this order, fail-closed:
//   1. SIGNATURE  — verify X-Slack-Signature over the RAW body against
//                   SLACK_SIGNING_SECRET (±5 min replay window). Invalid ⇒ 401,
//                   nothing is parsed, nothing is processed.
//   2. TEAM → ORG — resolveSlackTeam(team_id). No mapping ⇒ 403. From here on
//                   EVERY data access runs through withTenant(orgId): the RLS
//                   floor applies to Slack exactly as it does to the UI.
//   3. USER → ROLE — getSlackUserLink(). No link ⇒ read-only behavior: open
//                   knowledge only, NEVER start skills, NEVER approve.
//   4. ACT via the EXISTING functions (answerQuestion / startRun / approve /
//                   reject) — Slack adds no business logic of its own.
//   5. AUDIT      — besides the audit entries the underlying functions write,
//                   the adapter records every Slack action as slack.* with
//                   detail { via: 'slack', slackTeamId, slackUserId, … }.
//
// 3-second rule: slash commands and interactions answer synchronously in the
// 200 body (fast paths — no LLM chain beyond one answer). Events (mentions)
// deliver the answer via chat.postMessage into the thread; the MVP computes it
// before acking — with real providers move the work behind the ack (waitUntil/
// queue), see README "Slack lokal testen".
import { logAudit } from '../audit';
import { answerQuestion } from '../rag';
import { approve, getSkill, reject, startRun, type SkillJson } from '../skills';
import { withTenant } from '../tenant';
import { postSlackMessage } from './client';
import { getSlackUserLink, resolveSlackTeam, type SlackUserIdentity } from './team';
import { verifySlackSignature } from './verify';

const USAGE =
  'Nutzung: `/ergane frage <deine Frage>` oder `/ergane skill <key> {"…":…}`\n' +
  'Beispiel: `/ergane skill beleg_kontieren {"beschreibung":"Lizenz","betragEur":1240}`';

const NOT_LINKED =
  'Dein Slack-Konto ist nicht mit einem Mitglied dieser Organisation verknüpft. ' +
  'Fragen zu offenem Wissen sind möglich — Skills starten oder freigeben nicht. ' +
  'Ein Admin kann dich unter Einstellungen → Slack verknüpfen.';

/** Slack actor id for audit entries — always marks the external origin. */
function slackActor(slackUserId: string | null | undefined): string {
  return `slack:${slackUserId ?? 'unknown'}`;
}

/** Adapter-level audit entry: every Slack action lands in the tenant's
 * append-only audit_log with the "via slack" marker in detail. */
async function auditSlack(
  orgId: string,
  slackUserId: string | null | undefined,
  action: string,
  target: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await withTenant(orgId, (tx) =>
    logAudit(tx, {
      orgId,
      actorId: slackActor(slackUserId),
      actorType: 'human',
      action,
      target,
      detail: { via: 'slack', ...detail },
    }),
  );
}

/** Gate 1: signature over the raw body. Returns the raw body on success or the
 * 401 Response on failure — callers parse only AFTER this passed. */
async function requireSignedBody(req: Request): Promise<{ rawBody: string } | Response> {
  const rawBody = await req.text();
  const ok = verifySlackSignature({
    signingSecret: process.env.SLACK_SIGNING_SECRET ?? '',
    rawBody,
    timestampHeader: req.headers.get('x-slack-request-timestamp'),
    signatureHeader: req.headers.get('x-slack-signature'),
  });
  if (!ok) return new Response('invalid slack signature', { status: 401 });
  return { rawBody };
}

/** Gate 2: team → org. Returns orgId or the 403 Response. */
async function requireTeamOrg(teamId: string | null | undefined): Promise<string | Response> {
  const installation = await resolveSlackTeam(teamId);
  if (!installation) {
    return new Response('slack team is not mapped to an organization', { status: 403 });
  }
  return installation.orgId;
}

/** Strip bot mentions like "<@U0BOT>" from an app_mention text. */
function stripMentions(text: string): string {
  return text.replace(/<@[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

// -----------------------------------------------------------------------------
// POST /api/slack/events — Events API (url_verification, app_mention, DM)
// -----------------------------------------------------------------------------

interface SlackEventPayload {
  type?: string;
  challenge?: string;
  team_id?: string;
  event?: {
    type?: string;
    subtype?: string;
    bot_id?: string;
    user?: string;
    text?: string;
    channel?: string;
    channel_type?: string;
    ts?: string;
    thread_ts?: string;
  };
}

export async function handleSlackEvents(req: Request): Promise<Response> {
  const signed = await requireSignedBody(req);
  if (signed instanceof Response) return signed;

  const payload = JSON.parse(signed.rawBody) as SlackEventPayload;

  // Slack's endpoint handshake — happens before any team mapping can exist.
  if (payload.type === 'url_verification') {
    return json({ challenge: payload.challenge ?? '' });
  }
  if (payload.type !== 'event_callback' || !payload.event) {
    return new Response('ignored', { status: 200 });
  }

  const orgId = await requireTeamOrg(payload.team_id);
  if (orgId instanceof Response) return orgId;

  const event = payload.event;
  const isMention = event.type === 'app_mention';
  const isDm = event.type === 'message' && event.channel_type === 'im';
  // Never react to bot messages or message subtypes (edits, joins, our own
  // replies) — the classic feedback-loop guard.
  if ((!isMention && !isDm) || event.bot_id || event.subtype || !event.user || !event.channel) {
    return new Response('ignored', { status: 200 });
  }

  const question = stripMentions(event.text ?? '');
  if (!question) return new Response('ignored', { status: 200 });

  // Role of the asker — no link ⇒ undefined ⇒ answerQuestion falls back to
  // 'open' documents only (the RAG layer's fail-closed disclosure default).
  const link = await getSlackUserLink(orgId, event.user);

  const result = await answerQuestion({
    orgId,
    actorId: slackActor(event.user),
    question,
    role: link?.role,
  });

  await auditSlack(orgId, event.user, 'slack.question_answered', question.slice(0, 120), {
    slackTeamId: payload.team_id,
    slackUserId: event.user,
    linked: Boolean(link),
    role: link?.role ?? null,
    sources: result.sources,
  });

  await postSlackMessage({
    channel: event.channel,
    thread_ts: event.thread_ts ?? event.ts,
    text: result.answer,
  });

  return new Response('ok', { status: 200 });
}

// -----------------------------------------------------------------------------
// POST /api/slack/commands — the /ergane slash command
// -----------------------------------------------------------------------------

/** Block Kit approval prompt for a paused run — the buttons carry the runId;
 * the interactions handler re-resolves team/user/role on click (fail-closed:
 * the value is treated as untrusted input, it only names WHICH run). */
export function approvalBlocks(skillKey: string, runId: string, reason: string): unknown[] {
  return [
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text:
          `:hourglass_flowing_sand: Skill *${skillKey}* wartet auf Freigabe.\n` +
          `Grund: ${reason}\nRun: \`${runId}\``,
      },
    },
    {
      type: 'actions',
      block_id: 'ergane_approval',
      elements: [
        {
          type: 'button',
          style: 'primary',
          action_id: 'ergane_approve',
          text: { type: 'plain_text', text: 'Freigeben' },
          value: runId,
        },
        {
          type: 'button',
          style: 'danger',
          action_id: 'ergane_reject',
          text: { type: 'plain_text', text: 'Ablehnen' },
          value: runId,
        },
      ],
    },
  ];
}

export async function handleSlackCommands(req: Request): Promise<Response> {
  const signed = await requireSignedBody(req);
  if (signed instanceof Response) return signed;

  const params = new URLSearchParams(signed.rawBody);
  const orgId = await requireTeamOrg(params.get('team_id'));
  if (orgId instanceof Response) return orgId;

  const slackUserId = params.get('user_id');
  const text = (params.get('text') ?? '').trim();
  const [subcommand, ...rest] = text.split(/\s+/);

  if (subcommand === 'frage') {
    const question = rest.join(' ').trim();
    if (!question) return json({ response_type: 'ephemeral', text: USAGE });

    const link = await getSlackUserLink(orgId, slackUserId);
    const result = await answerQuestion({
      orgId,
      actorId: slackActor(slackUserId),
      question,
      role: link?.role,
    });

    await auditSlack(orgId, slackUserId, 'slack.question_answered', question.slice(0, 120), {
      slackTeamId: params.get('team_id'),
      slackUserId,
      linked: Boolean(link),
      role: link?.role ?? null,
      sources: result.sources,
    });

    return json({ response_type: 'in_channel', text: result.answer });
  }

  if (subcommand === 'skill') {
    // Acting requires a linked membership — fail-closed for unknown users.
    const link = await getSlackUserLink(orgId, slackUserId);
    if (!link) return json({ response_type: 'ephemeral', text: NOT_LINKED });

    const skillKey = rest[0] ?? '';
    let skill;
    try {
      skill = getSkill(skillKey);
    } catch {
      return json({ response_type: 'ephemeral', text: `Unbekannter Skill: \`${skillKey}\`\n${USAGE}` });
    }

    const argsRaw = rest.slice(1).join(' ').trim();
    let input: SkillJson = {};
    if (argsRaw) {
      try {
        const parsed: unknown = JSON.parse(argsRaw);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new Error('not an object');
        }
        input = parsed as SkillJson;
      } catch {
        return json({
          response_type: 'ephemeral',
          text: `Argumente müssen ein JSON-Objekt sein.\n${USAGE}`,
        });
      }
    }
    // The trigger's role is injected SERVER-SIDE from the verified link —
    // exactly like the UI action does from the Clerk session; a "rolle" smuggled
    // into the JSON args is overwritten.
    input = { ...input, rolle: link.role };

    const handle = await startRun(orgId, skill.key, input);

    await auditSlack(orgId, slackUserId, 'slack.skill_started', `${skill.key}:${handle.runId}`, {
      slackTeamId: params.get('team_id'),
      slackUserId,
      userId: link.userId,
      role: link.role,
      status: handle.status,
    });

    if (handle.status === 'awaiting_approval') {
      const approval = await withTenant(orgId, (tx) =>
        tx.approval.findFirst({ where: { runId: handle.runId, status: 'pending' } }),
      );
      const reason = approval?.reason ?? 'Freigabe erforderlich';
      const requiredRole = approval?.requiredRole ? ` (Rolle: ${approval.requiredRole}+)` : '';
      return json({
        response_type: 'in_channel',
        text: `Skill ${skill.key} wartet auf Freigabe${requiredRole}: ${reason}`,
        blocks: approvalBlocks(skill.key, handle.runId, `${reason}${requiredRole}`),
      });
    }

    return json({
      response_type: 'in_channel',
      text: `Skill *${skill.key}* → Status: *${handle.status}* (Run \`${handle.runId}\`)`,
    });
  }

  return json({ response_type: 'ephemeral', text: USAGE });
}

// -----------------------------------------------------------------------------
// POST /api/slack/interactions — Block Kit button clicks (approve / reject)
// -----------------------------------------------------------------------------

interface SlackInteractionPayload {
  type?: string;
  team?: { id?: string };
  user?: { id?: string };
  channel?: { id?: string };
  message?: { ts?: string; thread_ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
}

export async function handleSlackInteractions(req: Request): Promise<Response> {
  const signed = await requireSignedBody(req);
  if (signed instanceof Response) return signed;

  const params = new URLSearchParams(signed.rawBody);
  const payloadRaw = params.get('payload');
  if (!payloadRaw) return new Response('missing payload', { status: 400 });
  const payload = JSON.parse(payloadRaw) as SlackInteractionPayload;

  if (payload.type !== 'block_actions') return new Response('ignored', { status: 200 });

  const orgId = await requireTeamOrg(payload.team?.id);
  if (orgId instanceof Response) return orgId;

  const action = payload.actions?.[0];
  const decision =
    action?.action_id === 'ergane_approve'
      ? ('approved' as const)
      : action?.action_id === 'ergane_reject'
        ? ('rejected' as const)
        : null;
  const runId = action?.value ?? '';
  if (!decision || !runId) return new Response('ignored', { status: 200 });

  const slackUserId = payload.user?.id;
  const channel = payload.channel?.id;
  const threadTs = payload.message?.thread_ts ?? payload.message?.ts;

  const respond = async (text: string, ephemeral: boolean): Promise<Response> => {
    if (channel) {
      await postSlackMessage({
        channel,
        thread_ts: threadTs,
        text,
        ...(ephemeral && slackUserId ? { ephemeralUserId: slackUserId } : {}),
      });
    }
    // Slack ignores this body (delivery happens via postSlackMessage above);
    // tests and the demo read it as the handler's outcome.
    return json({ response_type: ephemeral ? 'ephemeral' : 'in_channel', text });
  };

  // Fail-closed: only a LINKED Slack user may decide anything.
  const link = await getSlackUserLink(orgId, slackUserId);
  if (!link) {
    await auditSlack(orgId, slackUserId, 'slack.approval_denied', runId, {
      slackTeamId: payload.team?.id,
      slackUserId,
      decision,
      reason: 'slack user not linked to a membership',
    });
    return respond(NOT_LINKED, true);
  }

  try {
    // The engine's decide() enforces the approval's required_role against the
    // decider's CURRENT membership role — the role gate lives there, not here.
    const handle =
      decision === 'approved'
        ? await approve(orgId, runId, link.userId)
        : await reject(orgId, runId, link.userId);

    await auditSlack(orgId, slackUserId, `slack.approval_${decision}`, runId, {
      slackTeamId: payload.team?.id,
      slackUserId,
      userId: link.userId,
      role: link.role,
      resultStatus: handle.status,
    });

    const verb = decision === 'approved' ? 'freigegeben' : 'abgelehnt';
    return respond(
      `Run \`${runId}\` wurde von <@${slackUserId}> ${verb} → Status: *${handle.status}*`,
      false,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await auditSlack(orgId, slackUserId, 'slack.approval_denied', runId, {
      slackTeamId: payload.team?.id,
      slackUserId,
      userId: link.userId,
      role: link.role,
      decision,
      reason: message,
    });
    return respond(`Keine Berechtigung oder ungültiger Zustand: ${message}`, true);
  }
}
