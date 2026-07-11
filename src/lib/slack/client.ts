// Outgoing Slack messages behind a swappable transport.
//
// Default transport: Slack Web API (chat.postMessage / chat.postEphemeral).
// The token is resolved PER MESSAGE from the installation's bot_token_ref:
//   'env:<NAME>'    → process.env[NAME]           (manual mapping, default)
//   'enc:<payload>' → AES-GCM decrypt with SLACK_TOKEN_ENC_KEY (OAuth install)
//   unset           → env:SLACK_BOT_TOKEN         (single-workspace fallback)
// Fail-closed: unknown scheme / missing env / bad ciphertext ⇒ throw, never a
// silent wrong-workspace post.
//
// Tests and `pnpm demo:slack` inject a capture transport via setSlackPoster()
// — no network, and the asserted output is exactly what would have been sent.
//
// Secrets: tokens are resolved at SEND time only; the DB holds refs or
// ciphertext (slack_installations.bot_token_ref), never a plaintext token.
import { decryptString } from '../crypto';
import { fetchWithTimeout } from '../http-timeout';

export interface SlackOutgoingMessage {
  channel: string;
  text: string;
  /** Block Kit blocks (e.g. approval buttons); text stays as the fallback. */
  blocks?: unknown[];
  /** Post into this thread (parent message ts). */
  thread_ts?: string;
  /** When set, send as an EPHEMERAL message visible only to this Slack user. */
  ephemeralUserId?: string;
  /** The installation's bot_token_ref ('env:…' | 'enc:…'); the default
   * transport resolves it, capture transports may assert on it. */
  botTokenRef?: string | null;
}

export type SlackPoster = (message: SlackOutgoingMessage) => Promise<void>;

/** Resolve a bot_token_ref to the actual token. Exported for tests. */
export function resolveBotToken(botTokenRef: string | null | undefined): string {
  const ref = botTokenRef ?? 'env:SLACK_BOT_TOKEN';
  if (ref.startsWith('env:')) {
    const name = ref.slice(4);
    const token = process.env[name];
    if (!token) {
      throw new Error(`resolveBotToken: env var ${JSON.stringify(name)} is not set.`);
    }
    return token;
  }
  if (ref.startsWith('enc:')) {
    return decryptString(ref.slice(4));
  }
  throw new Error(
    `resolveBotToken: unknown bot_token_ref scheme ${JSON.stringify(ref.split(':')[0])} — expected 'env:' or 'enc:'.`,
  );
}

async function postViaSlackApi(message: SlackOutgoingMessage): Promise<void> {
  const token = resolveBotToken(message.botTokenRef);
  const { ephemeralUserId, botTokenRef: _ref, ...payload } = message;
  const method = ephemeralUserId ? 'chat.postEphemeral' : 'chat.postMessage';
  const body = ephemeralUserId ? { ...payload, user: ephemeralUserId } : payload;

  const res = await fetchWithTimeout(`https://slack.com/api/${method}`, {
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
