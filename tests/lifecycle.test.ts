// =============================================================================
// LIFECYCLE & GDPR GATE (Phase 7)
//
// Proves the deletion capabilities WITHOUT weakening the floor:
//   1. deleteDocument: doc + chunks gone, tenant-scoped (A cannot delete B's),
//      admin-only, audited; deleted knowledge is no longer retrieved.
//   2. purgeChatHistory: only messages older than the cutoff, tenant-scoped.
//   3. exportOrgData: contains ONLY the own tenant, counts match, audited.
//   4. pseudonymizeAuditActor: rewrites actor_id per tenant via the gated
//      SECURITY DEFINER function; the audit entry about it does NOT leak the
//      old id; other tenants' rows with the same actor stay untouched.
//   5. deleteOrganization: typed-name confirmation, erases EVERYTHING of the
//      tenant (including audit_log via the gated cascade), other tenant
//      untouched, returns the deletion proof.
//   6. Append-only regression: normal UPDATE/DELETE on audit_log still raise —
//      for app_user (no grant/policy) AND via the trigger for the owner.
// =============================================================================
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PrismaClient } from '@prisma/client';
import { prisma } from '../src/lib/prisma'; // app_user — the system under test
import { withTenant } from '../src/lib/tenant';
import { answerQuestion, ingestDocument, NO_KNOWLEDGE_ANSWER } from '../src/lib/rag';
import {
  deleteDocument,
  deleteOrganization,
  exportOrgData,
  pseudonymizeAuditActor,
  purgeChatHistory,
} from '../src/lib/lifecycle';

const ORG_A = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const ORG_B = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const ADMIN = 'lc_admin';
const MEMBER = 'lc_member';

const ALL_TABLES = [
  'organizations', 'memberships', 'knowledge_items', 'audit_log',
  'documents', 'chunks', 'chat_messages',
  'skill_runs', 'skill_steps', 'approvals',
  'approval_policies', 'visibility_grants',
  'slack_installations', 'slack_user_links', 'slack_processed_events',
];

const admin = new PrismaClient({ datasourceUrl: process.env.DIRECT_DATABASE_URL });

async function reset() {
  await admin.$executeRawUnsafe(
    `TRUNCATE ${ALL_TABLES.map((t) => `"${t}"`).join(', ')} RESTART IDENTITY CASCADE`,
  );
}

async function seedOrg(orgId: string, clerkOrgId: string, name: string) {
  await withTenant(orgId, async (tx) => {
    await tx.organization.create({ data: { id: orgId, clerkOrgId, name } });
    await tx.membership.create({ data: { orgId, userId: ADMIN, role: 'admin' } });
    await tx.membership.create({ data: { orgId, userId: MEMBER, role: 'member' } });
  });
}

async function ingestSample(orgId: string, title: string, text: string): Promise<string> {
  const { documentId } = await ingestDocument({ orgId, actorId: 'seed', title, source: 'manual', text });
  return documentId;
}

beforeAll(async () => {
  const [role] = await prisma.$queryRaw<
    Array<{ current_user: string; rolsuper: boolean; rolbypassrls: boolean }>
  >`SELECT current_user, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user`;
  if (role?.current_user !== 'app_user' || role.rolsuper || role.rolbypassrls) {
    throw new Error(`Refusing to run: connected as "${role?.current_user}".`);
  }
  await reset();
});

afterAll(async () => {
  await reset();
  await prisma.$disconnect();
  await admin.$disconnect();
});

beforeEach(async () => {
  await reset();
  await seedOrg(ORG_A, 'org_lc_a', 'Lifecycle Org A');
  await seedOrg(ORG_B, 'org_lc_b', 'Lifecycle Org B');
});

// --- 1. document deletion ---------------------------------------------------------

describe('deleteDocument', () => {
  it('removes the document AND its chunks; the knowledge is no longer retrieved', async () => {
    const docId = await ingestSample(
      ORG_A, 'Urlaubsrichtlinie',
      'Alle Mitarbeitenden haben Anspruch auf 30 Urlaubstage pro Kalenderjahr.',
    );
    const before = await answerQuestion({
      orgId: ORG_A, actorId: 't', question: 'Wie viele Urlaubstage pro Kalenderjahr?',
    });
    expect(before.answer).toContain('30 Urlaubstage');

    const result = await deleteDocument({ orgId: ORG_A, actorUserId: ADMIN, documentId: docId });
    expect(result.title).toBe('Urlaubsrichtlinie');
    expect(result.chunkCount).toBeGreaterThan(0);

    const remaining = await withTenant(ORG_A, async (tx) => ({
      docs: await tx.document.count(),
      chunks: await tx.chunk.count(),
    }));
    expect(remaining).toEqual({ docs: 0, chunks: 0 });

    const after = await answerQuestion({
      orgId: ORG_A, actorId: 't', question: 'Wie viele Urlaubstage pro Kalenderjahr?',
    });
    expect(after.answer).toBe(NO_KNOWLEDGE_ANSWER);

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'document.deleted' } }),
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.actorId).toBe(ADMIN);
  });

  it('is tenant-scoped: A cannot delete B’s document (not found), B stays intact', async () => {
    const bDoc = await ingestSample(ORG_B, 'B-Doku', 'Interna von Organisation B.');
    await expect(
      deleteDocument({ orgId: ORG_A, actorUserId: ADMIN, documentId: bDoc }),
    ).rejects.toThrow();
    const bCount = await withTenant(ORG_B, (tx) => tx.document.count());
    expect(bCount).toBe(1);
  });

  it('rejects non-admins (fail-closed)', async () => {
    const docId = await ingestSample(ORG_A, 'Doc', 'Inhalt.');
    await expect(
      deleteDocument({ orgId: ORG_A, actorUserId: MEMBER, documentId: docId }),
    ).rejects.toThrow(/admin required/);
    await expect(
      deleteDocument({ orgId: ORG_A, actorUserId: 'nobody', documentId: docId }),
    ).rejects.toThrow(/admin required/);
  });
});

// --- 2. chat purge ----------------------------------------------------------------

describe('purgeChatHistory', () => {
  it('deletes only messages older than the cutoff, tenant-scoped, audited', async () => {
    await withTenant(ORG_A, async (tx) => {
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'alt' } });
      await tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'neu' } });
    });
    await withTenant(ORG_B, (tx) =>
      tx.chatMessage.create({ data: { orgId: ORG_B, role: 'user', content: 'b-alt' } }),
    );
    // Age one A message and the B message beyond 30 days (owner connection).
    await admin.$executeRaw`UPDATE "chat_messages"
      SET "created_at" = now() - interval '31 days' WHERE "content" IN ('alt', 'b-alt')`;

    const removed = await purgeChatHistory({ orgId: ORG_A, actorUserId: ADMIN, olderThanDays: 30 });
    expect(removed).toBe(1); // only A's old message — never B's

    const aLeft = await withTenant(ORG_A, (tx) => tx.chatMessage.findMany());
    expect(aLeft.map((m) => m.content)).toEqual(['neu']);
    const bLeft = await withTenant(ORG_B, (tx) => tx.chatMessage.count());
    expect(bLeft).toBe(1);

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'chat.purged' } }),
    );
    expect((audit[0]!.detail as { deletedCount?: number }).deletedCount).toBe(1);
  });

  it('rejects non-admins and negative retention', async () => {
    await expect(
      purgeChatHistory({ orgId: ORG_A, actorUserId: MEMBER, olderThanDays: 0 }),
    ).rejects.toThrow(/admin required/);
    await expect(
      purgeChatHistory({ orgId: ORG_A, actorUserId: ADMIN, olderThanDays: -1 }),
    ).rejects.toThrow();
  });
});

// --- 3. export --------------------------------------------------------------------

describe('exportOrgData', () => {
  it('contains ONLY the own tenant and matching counts; export is audited', async () => {
    await ingestSample(ORG_A, 'A-Doku', 'Wissen von A.');
    await ingestSample(ORG_B, 'B-Doku', 'Wissen von B.');

    const data = await exportOrgData({ orgId: ORG_A, actorUserId: ADMIN });
    expect(data.orgId).toBe(ORG_A);
    expect((data.documents as Array<{ title: string }>).map((d) => d.title)).toEqual(['A-Doku']);
    expect((data.memberships as unknown[]).length).toBe(2);
    // Nothing of B anywhere in the export.
    expect(JSON.stringify(data)).not.toContain('B-Doku');

    const audit = await withTenant(ORG_A, (tx) =>
      tx.auditLog.findMany({ where: { action: 'org.exported' } }),
    );
    expect(audit).toHaveLength(1);
  });

  it('rejects non-admins', async () => {
    await expect(exportOrgData({ orgId: ORG_A, actorUserId: MEMBER })).rejects.toThrow(/admin required/);
  });
});

// --- 4. audit pseudonymization ------------------------------------------------------

describe('pseudonymizeAuditActor', () => {
  it('rewrites actor_id only in the own tenant; the erasure entry hides the old id', async () => {
    await withTenant(ORG_A, async (tx) => {
      await tx.auditLog.create({
        data: { orgId: ORG_A, actorId: 'victim_user', actorType: 'human', action: 'x.did' },
      });
    });
    await withTenant(ORG_B, async (tx) => {
      await tx.auditLog.create({
        data: { orgId: ORG_B, actorId: 'victim_user', actorType: 'human', action: 'x.did' },
      });
    });

    const count = await pseudonymizeAuditActor({
      orgId: ORG_A, actorUserId: ADMIN, oldActorId: 'victim_user', newActorId: 'erased-1',
    });
    expect(count).toBe(1);

    const aAudit = await withTenant(ORG_A, (tx) => tx.auditLog.findMany());
    expect(aAudit.some((e) => e.actorId === 'victim_user')).toBe(false);
    expect(aAudit.some((e) => e.actorId === 'erased-1')).toBe(true);
    // The entry documenting the pseudonymization must not contain the old id.
    const marker = aAudit.find((e) => e.action === 'audit.actor_pseudonymized');
    expect(JSON.stringify(marker)).not.toContain('victim_user');

    // Other tenant untouched.
    const bAudit = await withTenant(ORG_B, (tx) => tx.auditLog.findMany());
    expect(bAudit.some((e) => e.actorId === 'victim_user')).toBe(true);
  });

  it('the gated path is the ONLY path: direct UPDATE stays blocked for app_user', async () => {
    await withTenant(ORG_A, (tx) =>
      tx.auditLog.create({
        data: { orgId: ORG_A, actorId: 'u', actorType: 'human', action: 'x' },
      }),
    );
    await expect(
      withTenant(ORG_A, (tx) =>
        tx.auditLog.updateMany({ where: {}, data: { actorId: 'mallory' } }),
      ),
    ).rejects.toThrow();
  });
});

// --- 5. tenant offboarding -----------------------------------------------------------

describe('deleteOrganization', () => {
  it('requires the exact organization name as confirmation', async () => {
    await expect(
      deleteOrganization({ orgId: ORG_A, actorUserId: ADMIN, confirmName: 'falscher Name' }),
    ).rejects.toThrow(/confirmation name/);
    const still = await withTenant(ORG_A, (tx) => tx.organization.count());
    expect(still).toBe(1);
  });

  it('erases the WHOLE tenant (incl. audit trail) and returns the proof; B untouched', async () => {
    await ingestSample(ORG_A, 'A-Doku', 'Wissen von A.');
    await ingestSample(ORG_B, 'B-Doku', 'Wissen von B.');
    await withTenant(ORG_A, (tx) =>
      tx.chatMessage.create({ data: { orgId: ORG_A, role: 'user', content: 'hi' } }),
    );

    const proof = await deleteOrganization({
      orgId: ORG_A, actorUserId: ADMIN, confirmName: 'Lifecycle Org A',
    });
    expect(proof.organizationName).toBe('Lifecycle Org A');
    expect(proof.counts.documents).toBe(1);
    expect(proof.counts.auditLog).toBeGreaterThan(0);

    // Verified with the OWNER connection (RLS-free): nothing of A remains.
    for (const table of ALL_TABLES) {
      const col = table === 'organizations' ? 'id' : 'org_id';
      const [{ count }] = await admin.$queryRawUnsafe<Array<{ count: bigint }>>(
        `SELECT count(*)::bigint AS count FROM "${table}" WHERE "${col}" = '${ORG_A}'::uuid`,
      );
      expect(Number(count), `${table} must be empty for org A`).toBe(0);
    }

    // B is fully intact.
    const b = await withTenant(ORG_B, async (tx) => ({
      org: await tx.organization.count(),
      docs: await tx.document.count(),
      audit: await tx.auditLog.count(),
    }));
    expect(b.org).toBe(1);
    expect(b.docs).toBe(1);
    expect(b.audit).toBeGreaterThan(0);
  });

  it('rejects non-admins', async () => {
    await expect(
      deleteOrganization({ orgId: ORG_A, actorUserId: MEMBER, confirmName: 'Lifecycle Org A' }),
    ).rejects.toThrow(/admin required/);
  });

  it('the SQL function itself refuses a mismatched tenant context', async () => {
    // From B's context, attempting to erase A must fail inside the function.
    await expect(
      withTenant(ORG_B, (tx) => tx.$queryRaw`SELECT delete_organization(${ORG_A}::uuid)`),
    ).rejects.toThrow();
    const still = await withTenant(ORG_A, (tx) => tx.organization.count());
    expect(still).toBe(1);
  });
});

// --- 6. append-only regression --------------------------------------------------------

describe('audit_log stays append-only outside the gated paths', () => {
  it('normal DELETE raises even for the owner (trigger) and app_user (no grant)', async () => {
    await withTenant(ORG_A, (tx) =>
      tx.auditLog.create({ data: { orgId: ORG_A, actorId: 'u', actorType: 'human', action: 'x' } }),
    );
    await expect(
      withTenant(ORG_A, (tx) => tx.auditLog.deleteMany({})),
    ).rejects.toThrow();
    await expect(
      admin.$executeRaw`DELETE FROM "audit_log" WHERE "org_id" = ${ORG_A}::uuid`,
    ).rejects.toThrow(/append-only/);
    await expect(
      admin.$executeRaw`UPDATE "audit_log" SET "action" = 'rewritten' WHERE "org_id" = ${ORG_A}::uuid`,
    ).rejects.toThrow(/append-only/);
  });
});
