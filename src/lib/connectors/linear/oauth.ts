// Linear OAuth install — mirrors Slack OAuth (signed state, encrypt token).
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout } from '../../http-timeout';
import { upsertConnectorInstallation } from '../admin';
import { encryptConnectorToken } from '../crypto';

const STATE_TTL_SECONDS = 10 * 60;
/**
 * OAuth scopes for Linear install.
 * - `read`: ingest issues (webhook + knowledge base)
 * - `comments:create`: skill `linear_kommentar` posts comments (P3-A write)
 * - `write`: broader write (fallback if app only exposes classic scopes)
 *
 * Existing installs that only consented to `read` MUST re-connect Linear
 * (Connectors → disconnect/reconnect or re-run OAuth) before live comments work.
 * Writes still require HELIX_LINEAR_WRITE=1|true in production.
 */
export const LINEAR_OAUTH_SCOPES = ['read', 'comments:create', 'write'] as const;
const OAUTH_SCOPES: readonly string[] = LINEAR_OAUTH_SCOPES;

export function linearStateSecret(): string {
  const dedicated = process.env.LINEAR_OAUTH_STATE_SECRET?.trim();
  if (dedicated) return dedicated;
  const fallback =
    process.env.CONNECTOR_TOKEN_ENC_KEY?.trim() ||
    process.env.SLACK_OAUTH_STATE_SECRET?.trim() ||
    process.env.SLACK_SIGNING_SECRET?.trim();
  if (!fallback) {
    throw new Error(
      'linear oauth: LINEAR_OAUTH_STATE_SECRET (or CONNECTOR_TOKEN_ENC_KEY / SLACK_OAUTH_STATE_SECRET) is not set.',
    );
  }
  return fallback;
}

function signState(orgId: string, expires: number): string {
  return createHmac('sha256', linearStateSecret()).update(`${orgId}.${expires}`).digest('hex');
}

export function makeLinearOAuthState(
  orgId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const expires = nowSeconds + STATE_TTL_SECONDS;
  return `${orgId}.${expires}.${signState(orgId, expires)}`;
}

export function verifyLinearOAuthState(
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

export function buildLinearAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = process.env.LINEAR_CLIENT_ID;
  if (!clientId) throw new Error('linear oauth: LINEAR_CLIENT_ID is not set.');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(','),
    state,
    prompt: 'consent',
  });
  return `https://linear.app/oauth/authorize?${params.toString()}`;
}

export interface LinearOAuthResult {
  accessToken: string;
  organizationId: string;
  organizationName?: string;
}

export type LinearOAuthExchanger = (code: string, redirectUri: string) => Promise<LinearOAuthResult>;

async function exchangeViaLinearApi(code: string, redirectUri: string): Promise<LinearOAuthResult> {
  const clientId = process.env.LINEAR_CLIENT_ID;
  const clientSecret = process.env.LINEAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('linear oauth: LINEAR_CLIENT_ID / LINEAR_CLIENT_SECRET are not set.');
  }

  const tokenRes = await fetchWithTimeout('https://api.linear.app/oauth/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      redirect_uri: redirectUri,
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    throw new Error(
      `linear oauth: token exchange failed: ${tokenData.error ?? 'malformed response'}`,
    );
  }

  // Resolve organization id for workspace → org mapping.
  const gqlRes = await fetchWithTimeout('https://api.linear.app/graphql', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: tokenData.access_token,
    },
    body: JSON.stringify({
      query: '{ organization { id name } }',
    }),
  });
  const gql = (await gqlRes.json()) as {
    data?: { organization?: { id?: string; name?: string } };
    errors?: Array<{ message?: string }>;
  };
  const orgId = gql.data?.organization?.id;
  if (!orgId) {
    throw new Error(
      `linear oauth: could not resolve organization: ${gql.errors?.[0]?.message ?? 'empty'}`,
    );
  }

  return {
    accessToken: tokenData.access_token,
    organizationId: orgId,
    organizationName: gql.data?.organization?.name,
  };
}

let exchanger: LinearOAuthExchanger = exchangeViaLinearApi;

export function setLinearOAuthExchanger(next: LinearOAuthExchanger | null): void {
  exchanger = next ?? exchangeViaLinearApi;
}

export interface CompleteLinearOAuthInput {
  orgId: string;
  actorUserId: string;
  code: string;
  redirectUri: string;
}

export async function completeLinearOAuth(
  input: CompleteLinearOAuthInput,
): Promise<{ externalId: string }> {
  const result = await exchanger(input.code, input.redirectUri);
  const accessTokenRef = encryptConnectorToken(result.accessToken);
  await upsertConnectorInstallation({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    provider: 'linear',
    externalId: result.organizationId,
    accessTokenRef,
    meta: result.organizationName ? { name: result.organizationName } : undefined,
  });
  return { externalId: result.organizationId };
}
