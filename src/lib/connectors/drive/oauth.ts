// Google OAuth for Drive read — signed state, encrypt token.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { fetchWithTimeout } from '../../http-timeout';
import { upsertConnectorInstallation } from '../admin';
import { encryptConnectorToken } from '../crypto';

const STATE_TTL_SECONDS = 10 * 60;
const OAUTH_SCOPES = ['https://www.googleapis.com/auth/drive.readonly'];

function stateSecret(): string {
  const dedicated = process.env.DRIVE_OAUTH_STATE_SECRET?.trim();
  if (dedicated) return dedicated;
  const fallback =
    process.env.CONNECTOR_TOKEN_ENC_KEY?.trim() ||
    process.env.SLACK_OAUTH_STATE_SECRET?.trim() ||
    process.env.SLACK_SIGNING_SECRET?.trim();
  if (!fallback) {
    throw new Error(
      'drive oauth: DRIVE_OAUTH_STATE_SECRET (or CONNECTOR_TOKEN_ENC_KEY) is not set.',
    );
  }
  return fallback;
}

function signState(orgId: string, expires: number): string {
  return createHmac('sha256', stateSecret()).update(`${orgId}.${expires}`).digest('hex');
}

export function makeDriveOAuthState(
  orgId: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const expires = nowSeconds + STATE_TTL_SECONDS;
  return `${orgId}.${expires}.${signState(orgId, expires)}`;
}

export function verifyDriveOAuthState(
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

export function buildDriveAuthorizeUrl(state: string, redirectUri: string): string {
  const clientId = process.env.DRIVE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('drive oauth: DRIVE_CLIENT_ID / GOOGLE_CLIENT_ID is not set.');
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: OAUTH_SCOPES.join(' '),
    access_type: 'offline',
    prompt: 'consent',
    state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

export interface DriveOAuthResult {
  accessToken: string;
  externalId: string;
  email?: string;
}

export type DriveOAuthExchanger = (code: string, redirectUri: string) => Promise<DriveOAuthResult>;

async function exchangeViaGoogleApi(
  code: string,
  redirectUri: string,
): Promise<DriveOAuthResult> {
  const clientId = process.env.DRIVE_CLIENT_ID ?? process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.DRIVE_CLIENT_SECRET ?? process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('drive oauth: client id/secret are not set.');
  }
  const tokenRes = await fetchWithTimeout('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenData = (await tokenRes.json()) as {
    access_token?: string;
    error?: string;
  };
  if (!tokenData.access_token) {
    throw new Error(
      `drive oauth: token exchange failed: ${tokenData.error ?? 'malformed response'}`,
    );
  }

  const userRes = await fetchWithTimeout('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { authorization: `Bearer ${tokenData.access_token}` },
  });
  const user = (await userRes.json()) as { id?: string; email?: string };
  if (!user.id) throw new Error('drive oauth: could not resolve Google user id');
  return {
    accessToken: tokenData.access_token,
    externalId: `user:${user.id}`,
    email: user.email,
  };
}

let exchanger: DriveOAuthExchanger = exchangeViaGoogleApi;

export function setDriveOAuthExchanger(next: DriveOAuthExchanger | null): void {
  exchanger = next ?? exchangeViaGoogleApi;
}

export async function completeDriveOAuth(input: {
  orgId: string;
  actorUserId: string;
  code: string;
  redirectUri: string;
}): Promise<{ externalId: string }> {
  const result = await exchanger(input.code, input.redirectUri);
  await upsertConnectorInstallation({
    orgId: input.orgId,
    actorUserId: input.actorUserId,
    provider: 'drive',
    externalId: result.externalId,
    accessTokenRef: encryptConnectorToken(result.accessToken),
    meta: result.email ? { email: result.email } : undefined,
  });
  return { externalId: result.externalId };
}
