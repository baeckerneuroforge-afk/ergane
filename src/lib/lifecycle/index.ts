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
import { getMemberRole } from '../policies';
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
// Data export (Art. 20)
// -----------------------------------------------------------------------------

export interface ExportOrgDataInput {
  orgId: string;
  actorUserId: string;
}

/** Full tenant export as a JSON-serializable object. Chunk embeddings are
 * omitted (derived data, not personal data, and huge); chunk text is included
 * via its parent document. Reads run through withTenant — the export can,
 * structurally, only ever contain the caller's own tenant. */
export async function exportOrgData(input: ExportOrgDataInput): Promise<Record<string, unknown>> {
  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    // SEQUENTIAL on purpose: an interactive Prisma transaction is one pinned
    // connection — concurrent queries on the same tx client (Promise.all) are
    // unsupported and can fail under load.
    const organization = await tx.organization.findUnique({ where: { id: input.orgId } });
    const memberships = await tx.membership.findMany();
    const knowledgeItems = await tx.knowledgeItem.findMany();
    const documents = await tx.document.findMany();
    const chunks = await tx.$queryRaw<
      Array<{ id: string; document_id: string; content: string; ord: number }>
    >`SELECT "id", "document_id", "content", "ord" FROM "chunks" ORDER BY "document_id", "ord"`;
    const chatMessages = await tx.chatMessage.findMany({ orderBy: { createdAt: 'asc' } });
    const skillRuns = await tx.skillRun.findMany();
    const skillSteps = await tx.skillStep.findMany();
    const approvals = await tx.approval.findMany();
    const approvalPolicies = await tx.approvalPolicy.findMany();
    const visibilityGrants = await tx.visibilityGrant.findMany();
    const slackInstallations = await tx.slackInstallation.findMany();
    const slackUserLinks = await tx.slackUserLink.findMany();
    const slackProcessedEvents = await tx.slackProcessedEvent.findMany();
    const auditLog = await tx.auditLog.findMany({ orderBy: { createdAt: 'asc' } });

    const data = {
      exportedAt: new Date().toISOString(),
      orgId: input.orgId,
      organization, memberships, knowledgeItems, documents, chunks, chatMessages,
      skillRuns, skillSteps, approvals, approvalPolicies, visibilityGrants,
      slackInstallations, slackUserLinks, slackProcessedEvents, auditLog,
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
 */
export async function deleteOrganization(input: DeleteOrganizationInput): Promise<DeletionProof> {
  return withTenant(input.orgId, async (tx) => {
    await requireAdmin(tx, input.actorUserId);

    const org = await tx.organization.findUniqueOrThrow({ where: { id: input.orgId } });
    if (org.name !== input.confirmName) {
      throw new Error(
        'deleteOrganization: confirmation name does not match the organization name — aborting.',
      );
    }

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
      auditLog: await tx.auditLog.count(),
    };

    // Gated erasure: only deletes the org matching app.current_org; permits
    // the audit_log cascade for exactly this transaction. ($executeRaw because
    // the function returns void, which $queryRaw cannot deserialize.)
    await tx.$executeRaw`SELECT delete_organization(${input.orgId}::uuid)`;

    return {
      orgId: input.orgId,
      organizationName: org.name,
      deletedBy: input.actorUserId,
      deletedAt: new Date().toISOString(),
      counts,
    };
  });
}
