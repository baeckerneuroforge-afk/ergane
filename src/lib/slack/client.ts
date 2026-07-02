// Outgoing Slack messages behind a swappable transport.
//
// Default transport: Slack Web API (chat.postMessage / chat.postEphemeral)
// with SLACK_BOT_TOKEN from the environment. Tests and `pnpm demo:slack`
// inject a capture transport via setSlackPoster() — no network, and the
// asserted output is exactly what would have been sent to Slack.
//
// Secrets: the token is read from the environment at SEND time only; nothing
// here (or in the DB — slack_installations stores only a bot_token_ref) ever
// persists it.

export interface SlackOutgoingMessage {
  channel: string;
  text: string;
  /** Block Kit blocks (e.g. approval buttons); text stays as the fallback. */
  blocks?: unknown[];
  /** Post into this thread (parent message ts). */
  thread_ts?: string;
  /** When set, send as an EPHEMERAL message visible only to this Slack user. */
  ephemeralUserId?: string;
}

export type SlackPoster = (message: SlackOutgoingMessage) => Promise<void>;

async function postViaSlackApi(message: SlackOutgoingMessage): Promise<void> {
  const token = process.env.SLACK_BOT_TOKEN;
  if (!token) {
    throw new Error('postSlackMessage: SLACK_BOT_TOKEN is not set — cannot reach the Slack API.');
  }
  const { ephemeralUserId, ...payload } = message;
  const method = ephemeralUserId ? 'chat.postEphemeral' : 'chat.postMessage';
  const body = ephemeralUserId ? { ...payload, user: ephemeralUserId } : payload;

  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) {
    throw new Error(`postSlackMessage: Slack API ${method} failed: ${data.error ?? 'unknown'}`);
  }
}

let poster: SlackPoster = postViaSlackApi;

/** Swap the transport (tests/demo). Pass null to restore the real Slack API. */
export function setSlackPoster(next: SlackPoster | null): void {
  poster = next ?? postViaSlackApi;
}

export function postSlackMessage(message: SlackOutgoingMessage): Promise<void> {
  return poster(message);
}
