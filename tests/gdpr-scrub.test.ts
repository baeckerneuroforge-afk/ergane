// =============================================================================
// GDPR DETAIL-SCRUB GATE (Phase 14)
//
// Closes the last documented Art.-17 gap: identifiers inside audit_log.detail.
//
//   1. pseudonymizeAuditActor rewrites actor_id AND every EXACT string value
//      in detail JSON — nested keys, arrays, everywhere in the tenant.
//   2. Exact-token semantics: substrings inside longer values stay untouched;
//      similar-but-different ids stay untouched.
//   3. Tenant-bound: the same identifier in org B survives.
//   4. Append-only regression: the widened trigger exception still rejects
//      any UPDATE that changes MORE than actor_id-only or detail-only, or
//      that runs without the GUC (i.e. outside the SECURITY DEFINER path).
//   5. End-to-end: after the clerk user.deleted webhook, NO identifier shape
//      of the person (clerk id, slack id, 'slack:<id>') remains anywhere in
//      the tenant's audit trail — actor_id or detail.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma';
import { withTenant } from '../src/lib/tenant';
import { pseudonymizeAuditActor } from '../src/lib/lifecycle';
import { clerkOrgIdToUuid } from '../src/lib/uuid';
import { computeSvixSignature } from '../src/lib/clerk/verify';
import { handleClerkWebhook } from '../src/lib/clerk/webhooks';

const ORG_A = 'afafafaf-afaf-4faf-8faf-afafafafafaf';
const ORG_B = 'a0a0a0a0-a0a0-4a0a-8a0a-a0a0a0a0a0a0';
const ADMIN = 'gs_admin';
const VICTIM = 'user_2victim'; // deliberately contains '_' (LIKE-wildcard trap)
const SECRET = `whsec_${Buffer.from('gdpr-scrub-test-secret-32bytes!!').toString('base64')}`;

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'slack_installations', 'slack_user_links', 'slack_processed_events',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seed() {
  for (const [orgId, clerk, name] of [
    [ORG_A, 'org_gs_a', 'Scrub A'],
    [ORG_B, 'org_gs_b', 'Scrub B'],
  ] as const) {
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: clerk, name } });
      await tx.membership.create({ data: { orgId, userId: ADMIN, role: 'admin' } });
    });
  }
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  process.env.CLERK_WEBHOOK_SECRET = SECRET;
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  await seed();
});

describe('detail scrubbing (exact-token semantics)', () => {
  it('rewrites the identifier everywhere in detail — nested, arrays — but never substrings', async () => {
    await withTenant(ORG_A, async (tx) => {
      await tx.auditLog.create({
        data: {
          orgId: ORG_A, actorId: 'someone-else', actorType: 'human', action: 'x.did',
          detail: {
            decidedBy: VICTIM,
            nested: { userId: VICTIM, note: `${VICTIM} ist Teil eines längeren Satzes` },
            reviewers: [VICTIM, 'other_user'],
            similar: 'user_2victim2', // similar but NOT equal — must survive
          },
        },
      });
    });

    const result = await pseudonymizeAuditActor({
      orgId: ORG_A, actorUserId: ADMIN, oldActorId: VICTIM, newActorId: 'erased-x',
    });
    expect(result.detailRows).toBe(1);

    const [entry] = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'x.did' } }),
    );
    const detail = entry!.detail as Record<string, unknown>;
    expect(detail.decidedBy).toBe('erased-x');
    expect((detail.nested as Record<string, unknown>).userId).toBe('erased-x');
    expect((detail.reviewers as string[])[0]).toBe('erased-x');
    expect((detail.reviewers as string[])[1]).toBe('other_user');
    // Exact-token semantics: substrings inside longer strings stay; similar
    // ids stay — no accidental corruption.
    expect((detail.nested as Record<string, unknown>).note).toContain(VICTIM);
    expect(detail.similar).toBe('user_2victim2');
  });

  it('is tenant-bound: the same identifier in org B survives', async () => {
    for (const orgId of [ORG_A, ORG_B]) {
      await withTenant(orgId, (tx) =>
        tx.auditLog.create({
          data: { orgId, actorId: 'a', actorType: 'human', action: 'x', detail: { userId: VICTIM } },
        }),
      );
    }
    await pseudonymizeAuditActor({
      orgId: ORG_A, actorUserId: ADMIN, oldActorId: VICTIM, newActorId: 'erased-x',
    });
    const [bEntry] = await withTenant(ORG_B, (tx) => tx.auditLog.findMany({ where: { action: 'x' } }));
    expect((bEntry!.detail as Record<string, unknown>).userId).toBe(VICTIM);
  });
});

describe('append-only stays intact around the widened trigger exception', () => {
  it('an UPDATE changing actor_id AND detail together is rejected even for the owner', async () => {
    await withTenant(ORG_A, (tx) =>
      tx.auditLog.create({
        data: { orgId: ORG_A, actorId: 'a', actorType: 'human', action: 'x', detail: { k: 'v' } },
      }),
    );
    // Owner, GUC set, but BOTH columns change ⇒ trigger must still raise.
    await expect(
      admin.$executeRaw`
        SELECT set_config('app.audit_pseudonymize', 'on', false);
        `.then(() =>
        admin.$executeRaw`UPDATE "audit_log" SET "actor_id" = 'x', "detail" = '{"k":"w"}'::jsonb`,
      ),
    ).rejects.toThrow(/append-only/);
    await admin.$executeRaw`SELECT set_config('app.audit_pseudonymize', '', false)`;
  });

  it('a detail-UPDATE without the GUC is rejected', async () => {
    await withTenant(ORG_A, (tx) =>
      tx.auditLog.create({
        data: { orgId: ORG_A, actorId: 'a', actorType: 'human', action: 'x', detail: { k: 'v' } },
      }),
    );
    await expect(
      admin.$executeRaw`UPDATE "audit_log" SET "detail" = '{"k":"w"}'::jsonb`,
    ).rejects.toThrow(/append-only/);
  });
});

describe('end-to-end: user.deleted webhook erases EVERY identifier shape', () => {
  it('clerk id, slack id and slack:<id> vanish from actor_id and detail', async () => {
    const CLERK_ORG = 'org_gs_e2e';
    const orgId = clerkOrgIdToUuid(CLERK_ORG);
    await withTenant(orgId, async (tx) => {
      await tx.organization.create({ data: { id: orgId, clerkOrgId: CLERK_ORG, name: 'E2E' } });
      await tx.membership.create({ data: { orgId, userId: VICTIM, role: 'lead' } });
      await tx.slackInstallation.create({ data: { orgId, slackTeamId: 'T_GS' } });
      await tx.slackUserLink.create({ data: { orgId, slackUserId: 'U_VICTIM', userId: VICTIM } });
      // Audit traces in every shape the system produces:
      await tx.auditLog.create({
        data: { orgId, actorId: VICTIM, actorType: 'human', action: 'approval.approved' },
      });
      await tx.auditLog.create({
        data: {
          orgId, actorId: 'slack:U_VICTIM', actorType: 'human', action: 'slack.question_answered',
          detail: { via: 'slack', slackUserId: 'U_VICTIM', userId: VICTIM },
        },
      });
    });

    const body = JSON.stringify({ type: 'user.deleted', data: { id: VICTIM } });
    const ts = Math.floor(Date.now() / 1000);
    const res = await handleClerkWebhook(
      new Request('http://localhost/api/clerk/webhooks', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'svix-id': 'msg_gs_e2e',
          'svix-timestamp': String(ts),
          'svix-signature': `v1,${computeSvixSignature(SECRET, 'msg_gs_e2e', ts, body)}`,
        },
        body,
      }),
    );
    expect(res.status).toBe(200);

    const audit = await withTenant(orgId, (tx) => tx.auditLog.findMany());
    const serialized = JSON.stringify(audit);
    expect(serialized).not.toContain(VICTIM);
    expect(serialized).not.toContain('U_VICTIM');
  });
});
