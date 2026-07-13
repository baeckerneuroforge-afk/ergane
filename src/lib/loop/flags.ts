// Mutable flag work-items (P2-C). Audit log remains append-only for history;
// this module owns open/acked/resolved status under RLS.
import type { LoopFlag, LoopFlagStatus, Prisma } from '@prisma/client';
import { logAudit } from '../audit';
import { getMemberRole } from '../policies/admin';
import { withTenant, type Tx } from '../tenant';

export type { LoopFlagStatus };

export interface CreateLoopFlagInput {
  orgId: string;
  action: string;
  target?: string | null;
  category?: string;
  severity?: string;
  type?: string | null;
  detail?: Record<string, unknown> | null;
  auditId?: string | null;
}

/** Insert a flag row inside the caller's withTenant tx (same as audit write). */
export async function createLoopFlagInTx(
  tx: Tx,
  input: CreateLoopFlagInput,
): Promise<LoopFlag> {
  return tx.loopFlag.create({
    data: {
      orgId: input.orgId,
      action: input.action,
      target: input.target ?? null,
      category: input.category ?? 'other',
      severity: input.severity ?? 'warning',
      type: input.type ?? null,
      detail: (input.detail ?? undefined) as Prisma.InputJsonValue | undefined,
      auditId: input.auditId ?? null,
      status: 'open',
    },
  });
}

export interface ListLoopFlagsOpts {
  status?: LoopFlagStatus | 'all';
  page?: number;
  pageSize?: number;
}

export async function listLoopFlags(
  orgId: string,
  opts: ListLoopFlagsOpts = {},
): Promise<{ entries: LoopFlag[]; total: number }> {
  const page = Math.max(1, opts.page ?? 1);
  const pageSize = Math.min(100, Math.max(1, opts.pageSize ?? 50));
  const status = opts.status && opts.status !== 'all' ? opts.status : undefined;

  return withTenant(orgId, async (tx) => {
    const where = status ? { status } : {};
    // Sequential on the pinned interactive connection (same as queryAuditLog).
    const total = await tx.loopFlag.count({ where });
    const entries = await tx.loopFlag.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return { entries, total };
  });
}

const ALLOWED: LoopFlagStatus[] = ['open', 'acked', 'resolved'];

export async function setLoopFlagStatus(input: {
  orgId: string;
  actorUserId: string;
  flagId: string;
  status: LoopFlagStatus;
}): Promise<LoopFlag> {
  if (!ALLOWED.includes(input.status)) {
    throw new Error(`setLoopFlagStatus: invalid status ${input.status}`);
  }

  return withTenant(input.orgId, async (tx) => {
    // Any member can ack/resolve flags they can see (work item, not governance
    // policy). Admin not required — fail-closed only on membership.
    const role = await getMemberRole(tx, input.actorUserId);
    if (!role) {
      throw new Error('setLoopFlagStatus: membership required.');
    }

    const existing = await tx.loopFlag.findUnique({ where: { id: input.flagId } });
    if (!existing) throw new Error('setLoopFlagStatus: flag not found.');
    if (existing.status === input.status) return existing;

    const now = new Date();
    // Clear opposing timestamps so status metadata always matches status.
    const data: Prisma.LoopFlagUpdateInput = {
      status: input.status,
      ackedAt: null,
      ackedBy: null,
      resolvedAt: null,
      resolvedBy: null,
    };
    if (input.status === 'acked') {
      data.ackedAt = now;
      data.ackedBy = input.actorUserId;
    } else if (input.status === 'resolved') {
      data.ackedAt = existing.ackedAt ?? now;
      data.ackedBy = existing.ackedBy ?? input.actorUserId;
      data.resolvedAt = now;
      data.resolvedBy = input.actorUserId;
    }

    const updated = await tx.loopFlag.update({
      where: { id: input.flagId },
      data,
    });

    await logAudit(tx, {
      orgId: input.orgId,
      actorId: input.actorUserId,
      actorType: 'human',
      action: 'flag.status_changed',
      target: input.flagId,
      detail: {
        old: existing.status,
        new: input.status,
        flagTarget: existing.target,
      },
    });

    return updated;
  });
}
