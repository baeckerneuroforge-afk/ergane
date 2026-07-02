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
//   4. IDEMPOTENCY — claimSlackEvent() atomically claims the request's stable
//                   key (event_id / trigger_id). Already claimed ⇒ duplicate
//                   delivery ⇒ ack 200, do nothing (src/lib/slack/idempotency.ts).
//   5. ACK-THEN-WORK — only now the handler returns 200 and the actual work
//                   (answerQuestion / startRun / approve / reject) runs via
//                   deferWork() AFTER the response; results are delivered with
//                   the Slack poster (chat.postMessage), failures are logged
//                   and reported to the user in Slack (src/lib/slack/defer.ts).
//                   This honors Slack's 3-second rule: no LLM call ever blocks
//                   the ack, so Slack has no reason to redeliver.
//   6. AUDIT      — besides the audit entries the underlying functions write,
//                   the adapter records every Slack action as slack.* with
//                   detail { via: 'slack', slackTeamId, slackUserId, … }.
//
// Gates 1–4 stay IN FRONT of the ack on purpose: an unsigned/foreign request
// still gets its 401/403 immediately, never a premature 200. Only verified,
// tenant-resolved, first-delivery requests are acked and processed.
//
// The url_verification challenge (events) is the one synchronous exception —
// Slack needs the challenge value in the response body, there is no work to
// defer.
import { logAudit } from '../audit';
import { answerQuestion } from '../rag';
import { approve, getSkill, reject, startRun, type SkillJson } from '../skills';
import { withTenant } from '../tenant';
import { postSlackMessage } from './client';
import { deferWork } from './defer';
import { claimSlackEvent } from './idempotency';
import { getSlackUserLink, resolveSlackTeam } from './team';
import { verifySlackSignature } from './verify';

const USAGE =
  'Nutzung: `/ergane frage <deine Frage>` oder `/ergane skill <key> {"…":…}`\n' +
  'Beispiel: `/ergane skill beleg_kontieren {"beschreibung":"Lizenz","betragEur":1240}`';

const NOT_LINKED =
  'Dein Slack-Konto ist nicht mit einem Mitglied dieser Organisation verknüpft. ' +
  'Fragen zu offenem Wissen sind möglich — Skills starten oder freigeben nicht. ' +
  'Ein Admin kann dich unter Einstellungen → Slack verknüpfen.';

const WORK_FAILED =
  'Die Verarbeitung ist fehlgeschlagen. Bitte versuche es erneut oder wende dich an einen Admin.';

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
  event_id?: string;
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

  // Slack's endpoint handshake — synchronous by design: the response body must
  // carry the challenge, and there is no work to defer.
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

  // Gate 3 (before the ack): role of the asker — no link ⇒ undefined ⇒
  // answerQuestion falls back to 'open' documents only (fail-closed).
  const link = await getSlackUserLink(orgId, event.user);

  // Gate 4: claim this delivery. Slack's event_id is stable across retries of
  // the same event; the (team, ts) pair is the documented fallback.
  const eventKey = `events:${payload.event_id ?? `${payload.team_id}:${event.ts}`}`;
  if (!(await claimSlackEvent(orgId, eventKey))) {
    return new Response('duplicate delivery ignored', { status: 200 });
  }

  const channel = event.channel;
  const threadTs = event.thread_ts ?? event.ts;
  const slackUserId = event.user;
  const teamId = payload.team_id;

  // Ack-then-work: the answer (potentially a real LLM call) runs AFTER the 200.
  deferWork(
    async () => {
      const result = await answerQuestion({
        orgId,
        actorId: slackActor(slackUserId),
        question,
        role: link?.role,
      });

      await auditSlack(orgId, slackUserId, 'slack.question_answered', question.slice(0, 120), {
        slackTeamId: teamId,
        slackUserId,
        linked: Boolean(link),
        role: link?.role ?? null,
        sources: result.sources,
      });

      await postSlackMessage({ channel, thread_ts: threadTs, text: result.answer });
    },
    {
      label: 'events:answer',
      onFailure: () =>
        postSlackMessage({ channel, thread_ts: threadTs, text: WORK_FAILED, ephemeralUserId: slackUserId }),
    },
  );

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
  const teamId = params.get('team_id');
  const channel = params.get('channel_id') ?? '';
  const triggerId = params.get('trigger_id');
  const text = (params.get('text') ?? '').trim();
  const [subcommand, ...rest] = text.split(/\s+/);

  /** Gate 4 for commands: trigger_id is unique per invocation and identical on
   * retries of the SAME delivery. Missing (never with real Slack) ⇒ no claim. */
  const claimCommand = async (): Promise<boolean> =>
    triggerId ? claimSlackEvent(orgId, `commands:${triggerId}`) : true;

  if (subcommand === 'frage') {
    const question = rest.join(' ').trim();
    if (!question) return json({ response_type: 'ephemeral', text: USAGE });

    const link = await getSlackUserLink(orgId, slackUserId);
    if (!(await claimCommand())) {
      return json({ response_type: 'ephemeral', text: 'Diese Anfrage wird bereits verarbeitet.' });
    }

    // Ack-then-work: the immediate 200 body is the "in progress" note; the
    // answer follows via chat.postMessage into the channel.
    deferWork(
      async () => {
        const result = await answerQuestion({
          orgId,
          actorId: slackActor(slackUserId),
          question,
          role: link?.role,
        });

        await auditSlack(orgId, slackUserId, 'slack.question_answered', question.slice(0, 120), {
          slackTeamId: teamId,
          slackUserId,
          linked: Boolean(link),
          role: link?.role ?? null,
          sources: result.sources,
        });

        await postSlackMessage({ channel, text: result.answer });
      },
      {
        label: 'commands:frage',
        onFailure: () =>
          postSlackMessage({ channel, text: WORK_FAILED, ephemeralUserId: slackUserId ?? undefined }),
      },
    );

    return json({ response_type: 'ephemeral', text: '… deine Frage wird bearbeitet.' });
  }

  if (subcommand === 'skill') {
    // Acting requires a linked membership — fail-closed for unknown users.
    // Validation errors answer synchronously: there is no work to defer.
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

    if (!(await claimCommand())) {
      return json({ response_type: 'ephemeral', text: 'Diese Anfrage wird bereits verarbeitet.' });
    }

    // Ack-then-work: the run (guardrail, steps, possibly pausing) executes
    // after the 200; outcome or approval buttons arrive via chat.postMessage.
    deferWork(
      async () => {
        const handle = await startRun(orgId, skill.key, input);

        await auditSlack(orgId, slackUserId, 'slack.skill_started', `${skill.key}:${handle.runId}`, {
          slackTeamId: teamId,
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
          await postSlackMessage({
            channel,
            text: `Skill ${skill.key} wartet auf Freigabe${requiredRole}: ${reason}`,
            blocks: approvalBlocks(skill.key, handle.runId, `${reason}${requiredRole}`),
          });
          return;
        }

        await postSlackMessage({
          channel,
          text: `Skill *${skill.key}* → Status: *${handle.status}* (Run \`${handle.runId}\`)`,
        });
      },
      {
        label: 'commands:skill',
        onFailure: () =>
          postSlackMessage({ channel, text: WORK_FAILED, ephemeralUserId: slackUserId ?? undefined }),
      },
    );

    return json({ response_type: 'ephemeral', text: `… Skill \`${skill.key}\` wird gestartet.` });
  }

  return json({ response_type: 'ephemeral', text: USAGE });
}

// -----------------------------------------------------------------------------
// POST /api/slack/interactions — Block Kit button clicks (approve / reject)
// -----------------------------------------------------------------------------

interface SlackInteractionPayload {
  type?: string;
  trigger_id?: string;
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
  const teamId = payload.team?.id;
  const channel = payload.channel?.id;
  const threadTs = payload.message?.thread_ts ?? payload.message?.ts;

  const notify = async (text: string, ephemeral: boolean): Promise<void> => {
    if (!channel) return;
    await postSlackMessage({
      channel,
      thread_ts: threadTs,
      text,
      ...(ephemeral && slackUserId ? { ephemeralUserId: slackUserId } : {}),
    });
  };

  // Gate 3 (before the ack), fail-closed: only a LINKED Slack user may decide.
  const link = await getSlackUserLink(orgId, slackUserId);
  if (!link) {
    await auditSlack(orgId, slackUserId, 'slack.approval_denied', runId, {
      slackTeamId: teamId,
      slackUserId,
      decision,
      reason: 'slack user not linked to a membership',
    });
    await notify(NOT_LINKED, true);
    return json({ response_type: 'ephemeral', text: NOT_LINKED });
  }

  // Gate 4: one click = one decision attempt, even if Slack redelivers it.
  const eventKey = `interactions:${payload.trigger_id ?? `${teamId}:${slackUserId}:${decision}:${runId}`}`;
  if (!(await claimSlackEvent(orgId, eventKey))) {
    return new Response('duplicate delivery ignored', { status: 200 });
  }

  // Ack-then-work: the decision executes after the 200; outcome (or the role-
  // gate error from the engine) is delivered into the thread.
  deferWork(
    async () => {
      try {
        // The engine's decide() enforces the approval's required_role against
        // the decider's CURRENT membership role — the role gate lives there.
        const handle =
          decision === 'approved'
            ? await approve(orgId, runId, link.userId)
            : await reject(orgId, runId, link.userId);

        await auditSlack(orgId, slackUserId, `slack.approval_${decision}`, runId, {
          slackTeamId: teamId,
          slackUserId,
          userId: link.userId,
          role: link.role,
          resultStatus: handle.status,
        });

        const verb = decision === 'approved' ? 'freigegeben' : 'abgelehnt';
        await notify(
          `Run \`${runId}\` wurde von <@${slackUserId}> ${verb} → Status: *${handle.status}*`,
          false,
        );
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await auditSlack(orgId, slackUserId, 'slack.approval_denied', runId, {
          slackTeamId: teamId,
          slackUserId,
          userId: link.userId,
          role: link.role,
          decision,
          reason: message,
        });
        await notify(`Keine Berechtigung oder ungültiger Zustand: ${message}`, true);
      }
    },
    {
      label: 'interactions:decision',
      onFailure: () => notify(WORK_FAILED, true),
    },
  );

  return json({ ok: true });
}
