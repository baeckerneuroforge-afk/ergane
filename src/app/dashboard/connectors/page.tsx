import { requireTenant } from '@/lib/auth-context';
import { listConnectorInstallations } from '@/lib/connectors';
import { getI18n } from '@/lib/i18n/server';

export const dynamic = 'force-dynamic';

type ConnStatus = 'shipped' | 'building' | 'planned';

const ITEM_KEYS = ['slack', 'email', 'linear', 'github', 'drive'] as const;

function statusChip(
  status: ConnStatus,
  labels: { shipped: string; building: string; planned: string },
): { className: string; text: string } {
  if (status === 'shipped') return { className: 'chip chip--green', text: labels.shipped };
  if (status === 'building') return { className: 'chip chip--amber', text: labels.building };
  return { className: 'chip chip--gray', text: labels.planned };
}

export default async function ConnectorsPage({
  searchParams,
}: {
  searchParams?: Promise<{ connected?: string }>;
}) {
  const { t } = await getI18n();
  const cx = t.connectors;
  const statusLabels = {
    shipped: cx.statusShipped,
    building: cx.statusBuilding,
    planned: cx.statusPlanned,
  };

  let installs: Array<{ provider: string; externalId: string }> = [];
  try {
    const ctx = await requireTenant();
    installs = await listConnectorInstallations(ctx.orgId);
  } catch {
    // Page can still render roadmap without session edge cases.
  }

  const byProvider = Object.fromEntries(installs.map((i) => [i.provider, i.externalId]));
  const params = searchParams ? await searchParams : {};
  const justConnected = params.connected;

  return (
    <>
      <p className="page-intro">{cx.intro}</p>

      <div
        className="card"
        style={{
          marginBottom: '1rem',
          borderColor: 'var(--amber)',
          background: 'var(--amber-bg, #fff8e6)',
        }}
      >
        <p style={{ margin: '0.8rem 1.2rem' }}>{cx.honestNote}</p>
      </div>

      {(justConnected || installs.length > 0) && (
        <div
          className="card"
          style={{
            marginBottom: '1rem',
            borderColor: 'var(--green, #1a7f37)',
            background: 'var(--green-bg, #eefbf1)',
          }}
        >
          <p style={{ margin: '0.8rem 1.2rem' }}>{cx.connectedBanner}</p>
        </div>
      )}

      <div className="quick-grid">
        {ITEM_KEYS.map((key) => {
          const item = cx.items[key];
          const chip = statusChip(item.status, statusLabels);
          const externalId = byProvider[key] ?? null;
          const connectHref =
            key === 'linear'
              ? '/api/connectors/linear/oauth/start'
              : key === 'github'
                ? '/api/connectors/github/oauth/start'
                : key === 'drive'
                  ? '/api/connectors/drive/oauth/start'
                  : null;
          const connectLabel =
            key === 'linear'
              ? cx.connectLinear
              : key === 'github'
                ? cx.connectGithub
                : key === 'drive'
                  ? cx.connectDrive
                  : null;
          const connectedLabel =
            key === 'linear'
              ? cx.linearConnected
              : key === 'github'
                ? cx.githubConnected
                : key === 'drive'
                  ? cx.driveConnected
                  : null;

          return (
            <section className="card" key={key}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.5rem',
                  marginBottom: '0.5rem',
                }}
              >
                <strong>{item.name}</strong>
                <span className={chip.className}>{chip.text}</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: '0.9rem' }}>
                {item.blurb}
              </p>
              {connectHref && connectLabel && connectedLabel ? (
                <p style={{ marginTop: '0.75rem', marginBottom: 0 }}>
                  {externalId ? (
                    <>
                      <span className="chip chip--green">{connectedLabel}</span>
                      <span className="muted" style={{ marginLeft: '0.5rem', fontSize: '0.85rem' }}>
                        {cx.linearWorkspace(externalId)}
                      </span>
                    </>
                  ) : (
                    <a className="btn btn--primary" href={connectHref}>
                      {connectLabel}
                    </a>
                  )}
                </p>
              ) : null}
            </section>
          );
        })}
      </div>
    </>
  );
}
