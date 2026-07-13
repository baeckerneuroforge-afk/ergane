// GitHub App / OAuth install — signed state, encrypt token, store install id.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout } from '../../http-timeout';
import { upsertConnectorInstallation } from '../admin';
import { encryptConnectorToken } from '../crypto';

const STATE_TTL_SECONDS = 10 * 60;
// Read-oriented scopes (private repo contents need `repo` on classic OAuth apps;
// prefer fine-grained GitHub Apps in production). public_repo alone is too narrow
// for private monorepos; repo is kept but documented as the least GitHub allows
// for private read without an App.
const OAUTH_SCOPES = ['read:user', 'repo', 'read:org'];

function stateSecret(): string {
  const dedicated = process.env.GITHUB_OAUTH_STATE_SECRET?.trim();
  if (dedicated) return dedicated;
  const fallback =
    process.env.CONNECTOR_TOKEN_ENC_KEY?.trim() ||
    process.env.SLACK_OAUTH_STATE_SECRET?.trim() ||
    process.env.SLACK_SIGNING_SECRET?.trim();
  if (!fallback) {
    throw new Error(
      'github oauth: GITHUB_OAUTH_STATE_SECRET (or CONNECTOR_TOKEN_ENC_KEY) is not set.',
    );
  }
  return fallback;
}

function signState(orgId: string, expires: number): string {
  return createHmac('sha256', stateSecret()).update(`${orgId}.${expires}`).digest('hex');
}

export function makeGitHubOAuthState(
  orgId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const expires = nowSeconds + STATE_TTL_SECONDS;
  return `${orgId}.${expires}.${signState(orgId, expires)}`;
}

export function verifyGitHubOAuthState(
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

export function buildGitHubAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = process.env.GITHUB_CLIENT_ID;
  if (!clientId) throw new Error('github oauth: GITHUB_CLIENT_ID is not set.');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: OAUTH_SCOPES.join(' '),
    state,
  });
  return `https://github.com/login/oauth/authorize?${params.toString()}`;
}

export interface GitHubOAuthResult {
  accessToken: string;
  /** Stable workspace key stored as external_id (user or org login/id). */
  externalId: string;
  login?: string;
}

export type GitHubOAuthExchanger = (code: string, redirectUri: string) => Promise<GitHubOAuthResult>;

async function exchangeViaGitHubApi(
  code: string,
  redirectUri: string,
): Promise<GitHubOAuthResult> {
  const clientId = process.env.GITHUB_CLIENT_ID;
  const clientSecret = process.env.GITHUB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('github oauth: GITHUB_CLIENT_ID / GITHUB_CLIENT_SECRET are not set.');
  }
  const tokenRes = await fetchWithTimeout('https://github.com/login/oauth/access_token', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
    }),
  });
  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    throw new Error(
      `github oauth: token exchange failed: ${tokenData.error ?? 'malformed response'}`,
    );
  }

  const userRes = await fetchWithTimeout('https://api.github.com/user', {
    headers: {
      authorization: `Bearer ${tokenData.access_token}`,
      accept: 'application/vnd.github+json',
      'user-agent': 'helix-connector',
    },
  });
  const user = (await userRes.json()) as { id?: number; login?: string };
  if (user.id == null) {
    throw new Error('github oauth: could not resolve authenticated user id');
  }
  return {
    accessToken: tokenData.access_token,
    externalId: `user:${user.id}`,
    login: user.login,
  };
}

let exchanger: GitHubOAuthExchanger = exchangeViaGitHubApi;

export function setGitHubOAuthExchanger(next: GitHubOAuthExchanger | null): void {
  exchanger = next ?? exchangeViaGitHubApi;
}

export async function completeGitHubOAuth(input: {
  orgId: string;
  actorUserId: string;
  code: string;
  redirectUri: string;
}): Promise<{ externalId: string }> {
  const result = await exchanger(input.code, input.redirectUri);
  await upsertConnectorInstallation({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    provider: 'github',
    externalId: result.externalId,
    accessTokenRef: encryptConnectorToken(result.accessToken),
    meta: result.login ? { login: result.login } : undefined,
  });
  return { externalId: result.externalId };
}
