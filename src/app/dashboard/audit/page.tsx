import type { Prisma } from '@prisma/client';
import Link from 'next/link';
import { requireTenant } from '@/lib/auth-context';
import { withTenant } from '@/lib/tenant';
import { ActorChip, JsonView, formatDateTime } from '../ui';

export const dynamic = 'force-dynamic';

const FILTERS: Record<string, { label: string; where: Prisma.AuditLogWhereInput }> = {
  alle: { label: 'alle', where: {} },
  skill: {
    label: 'skill',
    where: {
      OR: [
        { action: { startsWith: 'skill.' } },
        { action: { startsWith: 'guardrail.' } },
        { action: { startsWith: 'approval.' } },
      ],
    },
  },
  policy: { label: 'policy', where: { action: { startsWith: 'policy.' } } },
  chat: { label: 'chat', where: { action: { startsWith: 'chat.' } } },
};

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string }>;
}) {
  const { f } = await searchParams;
  const active = f && f in FILTERS ? f : 'alle';

  const { orgId } = await requireTenant();
  const entries = await withTenant(orgId, (tx) =>
    tx.auditLog.findMany({
      where: FILTERS[active].where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  );

  return (
    <>
      <p className="audit-note">
        Append-only — Einträge können nicht verändert oder gelöscht werden.
      </p>

      <div className="filter-chips">
        {Object.entries(FILTERS).map(([key, { label }]) => (
          <Link
            key={key}
            href={key === 'alle' ? '/dashboard/audit' : `/dashboard/audit?f=${key}`}
            className={`filter-chip${active === key ? ' active' : ''}`}
          >
            {label}
          </Link>
        ))}
      </div>

      <section className="card card--table">
        {entries.length === 0 ? (
          <p className="muted" style={{ padding: '0.8rem 1.25rem' }}>
            Keine Einträge für diesen Filter.
          </p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>Zeit</th>
                <th>Event</th>
                <th>Akteur</th>
                <th>Detail</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="mono row-meta" style={{ whiteSpace: 'nowrap' }}>
                    {formatDateTime(entry.createdAt)}
                  </td>
                  <td>
                    <span className="mono">{entry.action}</span>
                    {entry.target ? <div className="row-meta">{entry.target}</div> : null}
                  </td>
                  <td>
                    <ActorChip actorType={entry.actorType} />
                    <div className="row-meta mono">{entry.actorId}</div>
                  </td>
                  <td>
                    {entry.detail != null ? (
                      <details className="json-details">
                        <summary>aufklappen</summary>
                        <JsonView value={entry.detail} />
                      </details>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}
