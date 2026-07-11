// Data lifecycle & GDPR subject rights — deletion, retention, export,
// tenant offboarding (Phase 7).
//
// Same shape as src/lib/policies/: every operation runs inside withTenant()
// (RLS floor untouched — a foreign id is simply "not found", a delete without
// context affects 0 rows), re-checks the actor's role server-side, and writes
// an audit entry. The two audit-touching operations (pseudonymization, tenant
// erasure) go through the narrow SECURITY DEFINER functions from migration
// 0008 — app_user itself has no UPDATE/DELETE on audit_log and no DELETE on
// organizations.
//
// Audit vs. Art. 17 (documented decision):
//   - While the org lives, actor ids in the audit trail stay (legitimate
//     interest: accountability of approvals/policy changes).
//   - When a PERSON must be erased, pseudonymizeAuditActor() replaces their
//     actor_id with an opaque token; the audit STRUCTURE remains. The audit
//     entry about the pseudonymization deliberately does NOT contain the old id.
//   - When the TENANT is erased (deleteOrganization), everything cascades —
//     including the audit trail. The deletion proof is RETURNED to the caller
//     (it cannot live in the DB that was just erased) and should be filed
//     outside the system.
//   - Since Phase 14, detail JSON payloads are scrubbed too
//     (pseudonymize_audit_detail, migration 0011): every string value that
//     EXACTLY equals the identifier is replaced — substrings never (see the
//     migration header for the exact-token semantics).
import type { Role } from '@prisma/client';
import { logAudit } from '../audit';
import { logError } from '../log';
import { getMemberRole } from '../policies';
import { prisma } from '../prisma';
import { getBlobProvider } from '../storage/blob';
import { withTenant, type Tx } from '../tenant';

const ADMIN_ROLES: Role[] = ['admin', 'owner'];

async function requireAdmin(tx: Tx, actorUserId: string): Promise<Role> {
  const role = await getMemberRole(tx, actorUserId);
  if (!role || !ADMIN_ROLES.includes(role)) {
    throw new Error(
      `lifecycle: user ${JSON.stringify(actorUserId)} (role: ${role ?? 'none'}) may not perform lifecycle operations — admin required.`,
    );
  }
  return role;
}

// -----------------------------------------------------------------------------
// Document deletion
// -----------------------------------------------------------------------------

export interface DeleteDocumentInput {
  orgId: string;
  actorUserId: string;
  documentId: string;
}

export interface DeleteDocumentResult {
  title: string;
  chunkCount: number;
}

/** Delete a document and (via the FK cascade) all its chunks. Admin-only,
 * tenant-scoped: a foreign documentId is "not found" under RLS. */
export async function deleteDocument(input: DeleteDocumentInput): Promise<DeleteDocumentResult> {
  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const doc = await tx.document.findUniqueOrThrow({ where: { id: input.documentId } });
    const chunkCount = await tx.chunk.count({ where: { documentId: doc.id } });

    await tx.document.delete({ where: { id: doc.id } });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'document.deleted',
      target: doc.title,
      detail: { documentId: doc.id, visibility: doc.visibility, chunkCount },
    });
    return { title: doc.title, chunkCount };
  });
}

// -----------------------------------------------------------------------------
// Chat retention / purge
// -----------------------------------------------------------------------------

export interface PurgeChatHistoryInput {
  orgId: string;
  actorUserId: string;
  /** Delete messages OLDER than this many days. 0 = delete everything. */
  olderThanDays: number;
}

export async function purgeChatHistory(input: PurgeChatHistoryInput): Promise<number> {
  if (!Number.isFinite(input.olderThanDays) || input.olderThanDays < 0) {
    throw new Error('purgeChatHistory: olderThanDays must be a number ≥ 0.');
  }
  const cutoff = new Date(Date.now() - input.olderThanDays * 24 * 60 * 60 * 1000);

  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const { count } = await tx.chatMessage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'chat.purged',
      target: `older than ${input.olderThanDays}d`,
      detail: { olderThanDays: input.olderThanDays, deletedCount: count },
    });
    return count;
  });
}

// -----------------------------------------------------------------------------
// Automatic chat retention (org_settings, Phase 15)
// -----------------------------------------------------------------------------

export interface SetChatRetentionInput {
  orgId: string;
  actorUserId: string;
  /** Keep messages this many days; null = keep forever (off). */
  retentionDays: number | null;
}

export async function setChatRetention(input: SetChatRetentionInput): Promise<void> {
  if (
    input.retentionDays !== null &&
    (!Number.isInteger(input.retentionDays) || input.retentionDays <= 0)
  ) {
    throw new Error('setChatRetention: retentionDays must be a positive integer or null.');
  }
  await withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);
    const old = await tx.orgSettings.findUnique({ where: { orgId: input.orgId } });
    await tx.orgSettings.upsert({
      where: { orgId: input.orgId },
      create: { orgId: input.orgId, chatRetentionDays: input.retentionDays },
      update: { chatRetentionDays: input.retentionDays },
    });
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'policy.changed',
      target: 'org_settings:chat_retention_days',
      detail: { old: old?.chatRetentionDays ?? null, new: input.retentionDays },
    });
  });
}

export async function getChatRetention(orgId: string): Promise<number | null> {
  const settings = await withTenant(orgId, (tx) =>
    tx.orgSettings.findUnique({ where: { orgId } }),
  );
  return settings?.chatRetentionDays ?? null;
}

/**
 * Opportunistic retention enforcement — the SYSTEM path (no admin gate; only
 * reachable from app code, runs deferred after chat activity, same no-cron
 * pattern as the Slack claim cleanup). NULL retention ⇒ no-op. Audits only
 * when something was actually deleted (no noise).
 */
export async function enforceChatRetention(orgId: string): Promise<number> {
  return withTenant(orgId, async (tx) => {
    const settings = await tx.orgSettings.findUnique({ where: { orgId } });
    const days = settings?.chatRetentionDays;
    if (!days) return 0;

    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const { count } = await tx.chatMessage.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    if (count > 0) {
      await logAudit(tx, {
        orgId,
        actorId: 'retention',
        actorType: 'agent',
        action: 'chat.purged',
        target: `retention ${days}d`,
        detail: { retentionDays: days, deletedCount: count, via: 'auto-retention' },
      });
    }
    return count;
  });
}

/**
 * Nightly retention sweep — der CRON-Pfad (Route /api/cron/retention). Die
 * Tenant-Liste kommt aus retention_org_ids() (SECURITY DEFINER, Migration
 * 0016): nur org-ids von Tenants MIT gesetzter Frist, sonst nichts. Jede
 * Löschung läuft danach unverändert tenant-scoped durch enforceChatRetention
 * (withTenant + Audit) — der Sweep macht Retention GARANTIERT statt nur
 * opportunistisch nach Aktivität. Ein fehlschlagender Tenant stoppt die
 * anderen nicht (Fehler zählen, weiterlaufen).
 */
export async function runRetentionSweep(): Promise<{
  orgs: number;
  deleted: number;
  failed: number;
}> {
  const rows = await prisma.$queryRaw<Array<{ org_id: string }>>`
    SELECT retention_org_ids() AS org_id
  `;

  let deleted = 0;
  let failed = 0;
  for (const { org_id } of rows) {
    try {
      deleted += await enforceChatRetention(org_id);
    } catch (err) {
      failed += 1;
      logError('retention sweep: tenant failed', err, { orgId: org_id });
    }
  }
  return { orgs: rows.length, deleted, failed };
}

// -----------------------------------------------------------------------------
// Data export (Art. 20)
// -----------------------------------------------------------------------------

/** Per-table hard cap for exportOrgData. Oversized tenants fail closed with an
 * explicit error rather than OOM-ing the serverless function or silently
 * truncating GDPR-relevant data. Raise via a dedicated bulk-export path later. */
export const EXPORT_MAX_ROWS_PER_TABLE = 10_000;

/** Mutable only for tests — production always uses EXPORT_MAX_ROWS_PER_TABLE. */
let exportMaxRowsPerTable = EXPORT_MAX_ROWS_PER_TABLE;

/** Test hook: lower/raise the export bound without reloading the module. */
export function __setExportMaxRowsPerTableForTests(next: number | null): void {
  exportMaxRowsPerTable = next ?? EXPORT_MAX_ROWS_PER_TABLE;
}

export function getExportMaxRowsPerTable(): number {
  return exportMaxRowsPerTable;
}

export interface ExportOrgDataInput {
  orgId: string;
  actorUserId: string;
}

/**
 * Count rows for a table under the current tenant context; throw if over the
 * export safety bound. Fail-closed (no silent truncation).
 */
async function assertExportTableWithinBound(
  _tx: Tx,
  tableLabel: string,
  count: number,
): Promise<void> {
  const limit = exportMaxRowsPerTable;
  if (count > limit) {
    throw new Error(
      `exportOrgData: table ${JSON.stringify(tableLabel)} has ${count} rows ` +
        `(limit ${limit}). Export refused — use a bulk export path.`,
    );
  }
}

/** Full tenant export as a JSON-serializable object. Chunk embeddings are
 * omitted (derived data, not personal data, and huge); chunk text is included
 * via its parent document. Reads run through withTenant — the export can,
 * structurally, only ever contain the caller's own tenant.
 *
 * Safety: each table is counted first; if any exceeds EXPORT_MAX_ROWS_PER_TABLE
 * the export throws (fail-closed) instead of loading unbounded rows into memory. */
export async function exportOrgData(input: ExportOrgDataInput): Promise<Record<string, unknown>> {
  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    // SEQUENTIAL on purpose: an interactive Prisma transaction is one pinned
    // connection — concurrent queries on the same tx client (Promise.all) are
    // unsupported and can fail under load. Count-then-load per table enforces
    // the safety bound before any large payload is materialised.
    const organization = await tx.organization.findUnique({ where: { id: input.orgId } });

    const membershipCount = await tx.membership.count();
    await assertExportTableWithinBound(tx, 'memberships', membershipCount);
    const memberships = await tx.membership.findMany();

    const knowledgeItemCount = await tx.knowledgeItem.count();
    await assertExportTableWithinBound(tx, 'knowledge_items', knowledgeItemCount);
    const knowledgeItems = await tx.knowledgeItem.findMany();

    const documentCount = await tx.document.count();
    await assertExportTableWithinBound(tx, 'documents', documentCount);
    const documents = await tx.document.findMany();

    const [{ n: chunkCount }] = await tx.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM "chunks"
    `;
    await assertExportTableWithinBound(tx, 'chunks', Number(chunkCount));
    const chunks = await tx.$queryRaw<
      Array<{ id: string; document_id: string; content: string; ord: number }>
    >`SELECT "id", "document_id", "content", "ord" FROM "chunks" ORDER BY "document_id", "ord"`;

    const chatMessageCount = await tx.chatMessage.count();
    await assertExportTableWithinBound(tx, 'chat_messages', chatMessageCount);
    const chatMessages = await tx.chatMessage.findMany({ orderBy: { createdAt: 'asc' } });

    const skillRunCount = await tx.skillRun.count();
    await assertExportTableWithinBound(tx, 'skill_runs', skillRunCount);
    const skillRuns = await tx.skillRun.findMany();

    const skillStepCount = await tx.skillStep.count();
    await assertExportTableWithinBound(tx, 'skill_steps', skillStepCount);
    const skillSteps = await tx.skillStep.findMany();

    const approvalCount = await tx.approval.count();
    await assertExportTableWithinBound(tx, 'approvals', approvalCount);
    const approvals = await tx.approval.findMany();

    const approvalPolicyCount = await tx.approvalPolicy.count();
    await assertExportTableWithinBound(tx, 'approval_policies', approvalPolicyCount);
    const approvalPolicies = await tx.approvalPolicy.findMany();

    const visibilityGrantCount = await tx.visibilityGrant.count();
    await assertExportTableWithinBound(tx, 'visibility_grants', visibilityGrantCount);
    const visibilityGrants = await tx.visibilityGrant.findMany();

    const slackInstallationCount = await tx.slackInstallation.count();
    await assertExportTableWithinBound(tx, 'slack_installations', slackInstallationCount);
    const slackInstallations = await tx.slackInstallation.findMany();

    const slackUserLinkCount = await tx.slackUserLink.count();
    await assertExportTableWithinBound(tx, 'slack_user_links', slackUserLinkCount);
    const slackUserLinks = await tx.slackUserLink.findMany();

    const slackProcessedEventCount = await tx.slackProcessedEvent.count();
    await assertExportTableWithinBound(tx, 'slack_processed_events', slackProcessedEventCount);
    const slackProcessedEvents = await tx.slackProcessedEvent.findMany();

    const orgSettings = await tx.orgSettings.findUnique({ where: { orgId: input.orgId } });

    const chatFeedbackCount = await tx.chatFeedback.count();
    await assertExportTableWithinBound(tx, 'chat_feedback', chatFeedbackCount);
    const chatFeedback = await tx.chatFeedback.findMany();

    // Clients (PII in notes) + artifacts (metadata only — no blob bytes).
    const clientCount = await tx.client.count();
    await assertExportTableWithinBound(tx, 'clients', clientCount);
    const clients = await tx.client.findMany({ orderBy: { createdAt: 'asc' } });

    const artifactCount = await tx.artifact.count();
    await assertExportTableWithinBound(tx, 'artifacts', artifactCount);
    // Metadata + blobKey/ref for portability; binary content is external storage.
    const artifacts = await tx.artifact.findMany({
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        title: true,
        type: true,
        clientId: true,
        runId: true,
        blobKey: true,
        contentType: true,
        sizeBytes: true,
        version: true,
        slug: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    const auditLogCount = await tx.auditLog.count();
    await assertExportTableWithinBound(tx, 'audit_log', auditLogCount);
    const auditLog = await tx.auditLog.findMany({ orderBy: { createdAt: 'asc' } });

    const data = {
      exportedAt: new Date().toISOString(),
      orgId: input.orgId,
      organization, memberships, knowledgeItems, documents, chunks, chatMessages,
      skillRuns, skillSteps, approvals, approvalPolicies, visibilityGrants,
      slackInstallations, slackUserLinks, slackProcessedEvents, orgSettings, chatFeedback,
      clients, artifacts, auditLog,
    };

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'org.exported',
      detail: {
        counts: Object.fromEntries(
          Object.entries(data)
            .filter(([, v]) => Array.isArray(v))
            .map(([k, v]) => [k, (v as unknown[]).length]),
        ),
      },
    });
    return data;
  });
}

// -----------------------------------------------------------------------------
// Audit pseudonymization (Art. 17 for a person)
// -----------------------------------------------------------------------------

export interface PseudonymizeActorInput {
  orgId: string;
  actorUserId: string;
  /** The identifier to erase from the audit trail (Clerk id, 'slack:U…', …). */
  oldActorId: string;
  /** Opaque replacement, e.g. 'erased-user-1'. */
  newActorId: string;
}

export interface PseudonymizeResult {
  /** audit rows whose actor_id was rewritten. */
  actorRows: number;
  /** audit rows whose detail JSON contained the identifier as an exact value. */
  detailRows: number;
}

export async function pseudonymizeAuditActor(
  input: PseudonymizeActorInput,
): Promise<PseudonymizeResult> {
  if (!input.oldActorId.trim() || !input.newActorId.trim()) {
    throw new Error('pseudonymizeAuditActor: oldActorId and newActorId are required.');
  }
  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const [{ pseudonymize_audit_actor: count }] = await tx.$queryRaw<
      Array<{ pseudonymize_audit_actor: number }>
    >`SELECT pseudonymize_audit_actor(${input.oldActorId}, ${input.newActorId})`;
    // Phase 14: the identifier may also live inside detail JSON payloads
    // (slackUserId, decidedBy, …) — scrub exact string values there too.
    const [{ pseudonymize_audit_detail: detailRows }] = await tx.$queryRaw<
      Array<{ pseudonymize_audit_detail: number }>
    >`SELECT pseudonymize_audit_detail(${input.oldActorId}, ${input.newActorId})`;

    // The audit entry about the erasure must NOT contain the erased id — not
    // even as its author: when an admin erases their OWN id, the marker is
    // authored by the pseudonym.
    const markerActor =
      input.actorUserId === input.oldActorId ? input.newActorId : input.actorUserId;
    await logAudit(tx, {
      orgId: input.orgId,
      actorId: markerActor,
      actorType: 'human',
      action: 'audit.actor_pseudonymized',
      target: input.newActorId,
      detail: { newActorId: input.newActorId, rewrittenEntries: count, rewrittenDetails: detailRows },
    });
    return { actorRows: count, detailRows };
  });
}

// -----------------------------------------------------------------------------
// Tenant offboarding (full erasure)
// -----------------------------------------------------------------------------

export interface DeleteOrganizationInput {
  orgId: string;
  actorUserId: string;
  /** Must equal the organization's name — typed confirmation. */
  confirmName: string;
}

export interface DeletionProof {
  orgId: string;
  organizationName: string;
  deletedBy: string;
  deletedAt: string;
  /** Row counts per table at the moment of deletion (the erasure receipt). */
  counts: Record<string, number>;
}

/**
 * Erase the WHOLE tenant: the organizations row plus every cascade — including
 * the audit trail (via the gated delete_organization() function from 0008).
 * The returned DeletionProof is the only record; file it outside the system.
 *
 * Blob cleanup: artifact blob keys are listed under withTenant, then deleted
 * via BlobProvider OUTSIDE the tenant transaction (network). Best-effort —
 * a failed blob delete is logged and does not block DB cascade (orphan blobs
 * can be GC'd later). DB cascade alone would leave private store objects.
 */
export async function deleteOrganization(input: DeleteOrganizationInput): Promise<DeletionProof> {
  // Phase 1 — admin gate, typed name, row counts, collect blob keys (short tx).
  const prep = await withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const org = await tx.organization.findUniqueOrThrow({ where: { id: input.orgId } });
    if (org.name !== input.confirmName) {
      throw new Error(
        'deleteOrganization: confirmation name does not match the organization name — aborting.',
      );
    }

    const artifactKeys = (
      await tx.artifact.findMany({ select: { blobKey: true } })
    ).map((a) => a.blobKey);

    const counts: Record<string, number> = {
      memberships: await tx.membership.count(),
      knowledgeItems: await tx.knowledgeItem.count(),
      documents: await tx.document.count(),
      chunks: await tx.chunk.count(),
      chatMessages: await tx.chatMessage.count(),
      skillRuns: await tx.skillRun.count(),
      skillSteps: await tx.skillStep.count(),
      approvals: await tx.approval.count(),
      approvalPolicies: await tx.approvalPolicy.count(),
      visibilityGrants: await tx.visibilityGrant.count(),
      slackInstallations: await tx.slackInstallation.count(),
      slackUserLinks: await tx.slackUserLink.count(),
      slackProcessedEvents: await tx.slackProcessedEvent.count(),
      orgSettings: await tx.orgSettings.count(),
      chatFeedback: await tx.chatFeedback.count(),
      clients: await tx.client.count(),
      artifacts: await tx.artifact.count(),
      auditLog: await tx.auditLog.count(),
    };

    return { organizationName: org.name, counts, artifactKeys };
  });

  // Phase 2 — blob deletes outside any tenant tx (network I/O).
  const blob = getBlobProvider();
  let blobsDeleted = 0;
  for (const key of prep.artifactKeys) {
    try {
      await blob.delete(key);
      blobsDeleted += 1;
    } catch (err) {
      logError('deleteOrganization: artifact blob delete failed (best-effort)', err, {
        orgId: input.orgId,
        blobKey: key,
      });
    }
  }

  // Phase 3 — gated DB cascade (audit trail included).
  await withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);
    // Gated erasure: only deletes the org matching app.current_org; permits
    // the audit_log cascade for exactly this transaction. ($executeRaw because
    // the function returns void, which $queryRaw cannot deserialize.)
    await tx.$executeRaw`SELECT delete_organization(${input.orgId}::uuid)`;
  });

  return {
    orgId: input.orgId,
    organizationName: prep.organizationName,
    deletedBy: input.actorUserId,
    deletedAt: new Date().toISOString(),
    counts: { ...prep.counts, blobsDeleted },
  };
}
