// =============================================================================
// SLACK PRODUCTION GATE (Phase 9)
//
//   1. Per-installation tokens: resolveBotToken handles 'env:'/'enc:' and
//      fails closed on anything else; handlers thread the installation's
//      bot_token_ref into every outgoing message (multi-workspace works).
//   2. Crypto: AES-GCM roundtrip; tampering throws (auth tag).
//   3. OAuth: signed state binds callback to ONE org and expires;
//      completeSlackOAuth stores the ENCRYPTED token via the admin function
//      (never plaintext, global team-unique enforced).
//   4. Rate limit: request N+1 within a minute ⇒ 429 BEFORE signature work;
//      per-key isolation; window reset.
//   5. Claim cleanup: old idempotency claims are purged opportunistically
//      after new claims.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { decryptString, encryptString } from '../src/lib/crypto';
import { resolveBotToken, setSlackPoster, type SlackOutgoingMessage } from '../src/lib/slack/client';
import { drainDeferredWork } from '../src/lib/slack/defer';
import { handleSlackCommands } from '../src/lib/slack/handlers';
import {
  RATE_LIMIT_PER_MINUTE,
  checkRateLimit,
  resetRateLimiter,
} from '../src/lib/slack/ratelimit';
import {
  completeSlackOAuth,
  makeOAuthState,
  setSlackOAuthExchanger,
  verifyOAuthState,
} from '../src/lib/slack/oauth';
import { computeSlackSignature } from '../src/lib/slack/verify';

const ORG_A = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const ORG_B = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const TEAM_A = 'T_PROD_A';
const TEAM_B = 'T_PROD_B';
const SECRET = 'slack-prod-test-secret';
const ADMIN = 'sp_admin';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  'slack_installations', 'slack_user_links', 'slack_processed_events',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

let posted: SlackOutgoingMessage[] = [];

function commandRequest(teamId: string, text: string, triggerId: string, ip = '10.0.0.1'): Request {
  const body = new URLSearchParams({
    command: '/ergane', team_id: teamId, user_id: 'U_SP', channel_id: 'C_SP',
    trigger_id: triggerId, text,
  }).toString();
  const ts = Math.floor(Date.now() / 1000);
  return new Request('http://localhost/api/slack/commands', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'x-slack-request-timestamp': String(ts),
      'x-slack-signature': computeSlackSignature(SECRET, ts, body),
      'x-forwarded-for': ip,
    },
    body,
  });
}

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  await withTenant(ORG_A, async (tx) => {
    await tx.organization.create({ data: { id: ORG_A, clerkOrgId: 'org_sp_a', name: 'Prod A' } });
    await tx.membership.create({ data: { orgId: ORG_A, userId: ADMIN, role: 'admin' } });
    await tx.slackInstallation.create({
      data: { orgId: ORG_A, slackTeamId: TEAM_A, botTokenRef: 'env:SLACK_BOT_TOKEN_A' },
    });
  });
  await withTenant(ORG_B, async (tx) => {
    await tx.organization.create({ data: { id: ORG_B, clerkOrgId: 'org_sp_b', name: 'Prod B' } });
    await tx.membership.create({ data: { orgId: ORG_B, userId: ADMIN, role: 'admin' } });
    await tx.slackInstallation.create({
      data: { orgId: ORG_B, slackTeamId: TEAM_B, botTokenRef: 'env:SLACK_BOT_TOKEN_B' },
    });
  });
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  process.env.SLACK_SIGNING_SECRET = SECRET;
  process.env.SLACK_TOKEN_ENC_KEY = Buffer.alloc(32, 7).toString('base64');
  await reset();
});

afterAll(async () => {
  setSlackPoster(null);
  setSlackOAuthExchanger(null);
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await drainDeferredWork();
  resetRateLimiter();
  posted = [];
  setSlackPoster(async (msg) => {
    posted.push(msg);
  });
  await reset();
  await seed();
});

// --- 1. per-installation tokens ------------------------------------------------------

describe('per-installation bot tokens', () => {
  it('resolveBotToken: env-scheme, enc-scheme, fallback, fail-closed', () => {
    process.env.MY_TEST_TOKEN = 'xoxb-resolved';
    expect(resolveBotToken('env:MY_TEST_TOKEN')).toBe('xoxb-resolved');
    delete process.env.MY_TEST_TOKEN;
    expect(() => resolveBotToken('env:MY_TEST_TOKEN')).toThrow(/not set/);

    const enc = `enc:${encryptString('xoxb-secret-token')}`;
    expect(resolveBotToken(enc)).toBe('xoxb-secret-token');

    expect(() => resolveBotToken('vault:foo')).toThrow(/unknown bot_token_ref scheme/);

    process.env.SLACK_BOT_TOKEN = 'xoxb-default';
    expect(resolveBotToken(null)).toBe('xoxb-default');
    delete process.env.SLACK_BOT_TOKEN;
  });

  it('handlers thread each installation’s token ref into outgoing messages', async () => {
    await handleSlackCommands(commandRequest(TEAM_A, 'frage Wie geht es?', 'trig_tok_a'));
    await handleSlackCommands(commandRequest(TEAM_B, 'frage Wie geht es?', 'trig_tok_b'));
    await drainDeferredWork();

    const refs = posted.map((m) => m.botTokenRef);
    expect(refs).toContain('env:SLACK_BOT_TOKEN_A');
    expect(refs).toContain('env:SLACK_BOT_TOKEN_B');
  });
});

// --- 2. crypto -----------------------------------------------------------------------

describe('crypto (AES-256-GCM)', () => {
  it('roundtrips and rejects tampering', () => {
    const payload = encryptString('geheimer-token');
    expect(decryptString(payload)).toBe('geheimer-token');

    const [iv, ct, tag] = payload.split('.');
    const flipped = Buffer.from(ct!, 'base64');
    flipped[0] = flipped[0]! ^ 0xff;
    expect(() => decryptString(`${iv}.${flipped.toString('base64')}.${tag}`)).toThrow();
  });

  it('fails closed without a key', () => {
    const saved = process.env.SLACK_TOKEN_ENC_KEY;
    delete process.env.SLACK_TOKEN_ENC_KEY;
    expect(() => encryptString('x')).toThrow(/not set/);
    process.env.SLACK_TOKEN_ENC_KEY = saved;
  });
});

// --- 3. oauth ------------------------------------------------------------------------

describe('oauth install flow', () => {
  it('the signed state binds to one org and expires', () => {
    const state = makeOAuthState(ORG_A);
    expect(verifyOAuthState(state)).toBe(ORG_A);
    expect(verifyOAuthState(state.replace(ORG_A, ORG_B))).toBeNull(); // re-bound → invalid
    expect(verifyOAuthState(`${state}x`)).toBeNull(); // tampered signature
    const expired = makeOAuthState(ORG_A, Math.floor(Date.now() / 1000) - 3600);
    expect(verifyOAuthState(expired)).toBeNull();
  });

  it('completeSlackOAuth stores the ENCRYPTED token, never plaintext', async () => {
    setSlackOAuthExchanger(async (code) => {
      expect(code).toBe('demo-code');
      return { teamId: 'T_OAUTH_NEW', botToken: 'xoxb-super-secret' };
    });

    const { teamId } = await completeSlackOAuth({
      orgId: ORG_A, actorUserId: ADMIN, code: 'demo-code',
    });
    expect(teamId).toBe('T_OAUTH_NEW');

    const installation = await withTenant(ORG_A, (tx) =>
      tx.slackInstallation.findFirstOrThrow({ where: { slackTeamId: 'T_OAUTH_NEW' } }),
    );
    expect(installation.botTokenRef).toMatch(/^enc:/);
    expect(installation.botTokenRef).not.toContain('xoxb');
    expect(resolveBotToken(installation.botTokenRef)).toBe('xoxb-super-secret');
  });

  it('a team already mapped to another org is rejected (global unique)', async () => {
    setSlackOAuthExchanger(async () => ({ teamId: TEAM_B, botToken: 'xoxb-x' }));
    await expect(
      completeSlackOAuth({ orgId: ORG_A, actorUserId: ADMIN, code: 'c' }),
    ).rejects.toThrow(/already mapped/);
  });
});

// --- 4. rate limit --------------------------------------------------------------------

describe('rate limiting on the public endpoints', () => {
  it('unit: allows LIMIT per window, blocks after, resets next window', () => {
    const t0 = 1_000_000;
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i++) {
      expect(checkRateLimit('ip-1', t0 + i)).toBe(true);
    }
    expect(checkRateLimit('ip-1', t0 + 100)).toBe(false); // over the limit
    expect(checkRateLimit('ip-2', t0 + 100)).toBe(true); // other key unaffected
    expect(checkRateLimit('ip-1', t0 + 61_000)).toBe(true); // next window
  });

  it('endpoint: request over the limit gets 429 before any processing', async () => {
    resetRateLimiter();
    let last: Response | null = null;
    for (let i = 0; i <= RATE_LIMIT_PER_MINUTE; i++) {
      last = await handleSlackCommands(commandRequest(TEAM_A, 'hilfe', `trig_rl_${i}`, '10.9.9.9'));
    }
    expect(last!.status).toBe(429);
    // The flood left no trace: no claims for those rejected requests.
    await drainDeferredWork();
  });
});

// --- 5. claim cleanup -----------------------------------------------------------------

describe('idempotency claim cleanup', () => {
  it('claims older than 24h are purged after a new claim is processed', async () => {
    await withTenant(ORG_A, (tx) =>
      tx.slackProcessedEvent.create({ data: { orgId: ORG_A, eventKey: 'ancient' } }),
    );
    await admin.$executeRaw`UPDATE "slack_processed_events"
      SET "created_at" = now() - interval '25 hours' WHERE "event_key" = 'ancient'`;

    await handleSlackCommands(commandRequest(TEAM_A, 'frage Hallo?', 'trig_clean_1'));
    await drainDeferredWork();

    const keys = await withTenant(ORG_A, (tx) => tx.slackProcessedEvent.findMany());
    expect(keys.some((k) => k.eventKey === 'ancient')).toBe(false);
    expect(keys.some((k) => k.eventKey === 'commands:trig_clean_1')).toBe(true);
  });
});
