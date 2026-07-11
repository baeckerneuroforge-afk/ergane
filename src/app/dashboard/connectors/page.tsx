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

export default async function ConnectorsPage() {
  const { t } = await getI18n();
  const cx = t.connectors;
  const statusLabels = {
    shipped: cx.statusShipped,
    building: cx.statusBuilding,
    planned: cx.statusPlanned,
  };

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

      <div className="quick-grid">
        {ITEM_KEYS.map((key) => {
          const item = cx.items[key];
          const chip = statusChip(item.status, statusLabels);
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
            </section>
          );
        })}
      </div>
    </>
  );
}
