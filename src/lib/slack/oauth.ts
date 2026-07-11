// Slack OAuth install flow (v2) — replaces the manual team-id mapping.
//
// Flow: an ADMIN clicks "Mit Slack verbinden" in the settings →
// GET /api/slack/oauth/start builds the authorize URL with a SIGNED state
// (orgId + expiry, HMAC with SLACK_SIGNING_SECRET — stateless CSRF binding) →
// Slack redirects back to GET /api/slack/oauth/callback?code&state → the
// callback verifies the Clerk session AND the state, exchanges the code
// (oauth.v2.access), ENCRYPTS the bot token (AES-GCM, SLACK_TOKEN_ENC_KEY)
// and stores it as bot_token_ref 'enc:<payload>' via createSlackInstallation
// (admin gate + audit + global team unique live there).
//
// The token exchange is injectable (setSlackOAuthExchanger) so tests and the
// demo never talk to Slack. completeSlackOAuth() is the testable core; the
// route handlers only add session plumbing.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { encryptString } from '../crypto';
import { fetchWithTimeout } from '../http-timeout';
import { createSlackInstallation } from './admin';

export const OAUTH_SCOPES = ['app_mentions:read', 'chat:write', 'commands', 'im:history'];

const STATE_TTL_SECONDS = 10 * 60;

function stateSecret(): string {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) throw new Error('slack oauth: SLACK_SIGNING_SECRET is not set.');
  return secret;
}

function signState(orgId: string, expires: number): string {
  return createHmac('sha256', stateSecret()).update(`${orgId}.${expires}`).digest('hex');
}

/** Stateless, signed OAuth state: binds the callback to ONE org and expires. */
export function makeOAuthState(orgId: string, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const expires = nowSeconds + STATE_TTL_SECONDS;
  return `${orgId}.${expires}.${signState(orgId, expires)}`;
}

/** Returns the orgId the state was issued for, or null (invalid/expired). */
export function verifyOAuthState(
  state: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1000),
): string | null {
  if (!state) return null;
  const [orgId, expiresRaw, signature] = state.split('.');
  if (!orgId || !expiresRaw || !signature || !/^\d+$/.test(expiresRaw)) return null;
  const expires = Number(expiresRaw);
  if (expires < nowSeconds) return null;
  const expected = Buffer.from(signState(orgId, expires));
  const received = Buffer.from(signature);
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
  return orgId;
}

export function buildAuthorizeUrl(state: string): string {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error('slack oauth: SLACK_CLIENT_ID is not set.');
  const params = new URLSearchParams({
    client_id: clientId,
    scope: OAUTH_SCOPES.join(','),
    state,
  });
  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export interface SlackOAuthResult {
  teamId: string;
  botToken: string;
}

export type SlackOAuthExchanger = (code: string) => Promise<SlackOAuthResult>;

async function exchangeViaSlackApi(code: string): Promise<SlackOAuthResult> {
  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('slack oauth: SLACK_CLIENT_ID / SLACK_CLIENT_SECRET are not set.');
  }
  const res = await fetchWithTimeout('https://slack.com/api/oauth.v2.access', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret }),
  });
  const data = (await res.json()) as {
    ok: boolean;
    error?: string;
    access_token?: string;
    team?: { id?: string };
  };
  if (!data.ok || !data.access_token || !data.team?.id) {
    throw new Error(`slack oauth: token exchange failed: ${data.error ?? 'malformed response'}`);
  }
  return { teamId: data.team.id, botToken: data.access_token };
}

let exchanger: SlackOAuthExchanger = exchangeViaSlackApi;

/** Swap the exchange (tests/demo). Pass null to restore the real Slack API. */
export function setSlackOAuthExchanger(next: SlackOAuthExchanger | null): void {
  exchanger = next ?? exchangeViaSlackApi;
}

export interface CompleteSlackOAuthInput {
  orgId: string;
  actorUserId: string;
  code: string;
}

/** Testable core of the callback: exchange → encrypt → store installation. */
export async function completeSlackOAuth(input: CompleteSlackOAuthInput): Promise<{ teamId: string }> {
  const { teamId, botToken } = await exchanger(input.code);
  const botTokenRef = `enc:${encryptString(botToken)}`;
  await createSlackInstallation({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    slackTeamId: teamId,
    botTokenRef,
  });
  return { teamId };
}
