// Security view — an honest, legible account of what this system structurally
// secures, and how each guarantee can be verified. Admin-only.
//
// HONESTY IS THE POINT (see src/lib/security/checks.ts):
//   - Two properties are LIVE-checked against the running database's schema
//     catalogs (RLS+FORCE on tenant tables; audit_log append-only). Their tiles
//     can come back red or "not verifiable now" — never a hardcoded green.
//   - The rest are labelled as secured by the test suite / architecture, with a
//     pointer to the verifiable basis (the CI gate, the repo). We do NOT dress
//     them up as a momentary live status.
//   - No "certified" language, no self-issued seal.
//
// The page-level admin gate here (requireTenant + redirect) mirrors the sidebar,
// but the truth is server-side: the live checks read ONLY aggregated schema
// structure as the least-privileged app_user and touch no tenant data, so there
// is no path from this view to another org's data.
import { redirect } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { getI18n } from '@/lib/i18n/server';
import { ADMIN_ROLES } from '@/lib/policies/admin';
import { loadSecurityView, type SecurityProperty } from '@/lib/security/checks';
import { SECURITY_BASIS } from '@/lib/security/basis';
import { SecurityStatusChip } from '../ui';

export const dynamic = 'force-dynamic';

export default async function SecurityPage() {
  const { orgId, userId, role } = await requireTenant();
  // Page-level convenience gate; the real gate is server-side inside
  // loadSecurityView (requireAdmin under RLS). Reuse ADMIN_ROLES — the SAME list
  // requireAdmin authorizes against — so the two gates can never drift.
  if (!ADMIN_ROLES.includes(role)) redirect('/dashboard');

  const { locale, t } = await getI18n();
  const s = t.security;

  // Admin-gated load. Live checks hit the DB (schema catalogs only); the rest
  // are pure. requireAdmin inside here is the authoritative access check.
  const properties = await loadSecurityView({ orgId, actorUserId: userId });

  return (
    <>
      <p className="page-intro">{s.intro}</p>

      {/* Honesty banner — states the reading rule up front. */}
      <section className="card sec-honesty">
        <h2>{s.honestyTitle}</h2>
        <p className="muted" style={{ margin: 0 }}>
          {s.honestyBody}
        </p>
      </section>

      <div className="sec-grid">
        {properties.map((p) => (
          <PropertyCard key={p.key} property={p} locale={locale} s={s} />
        ))}
      </div>

      {/* Verifiable basis footer. */}
      <section className="card sec-proof">
        <h2>{s.proofTitle}</h2>
        <p className="muted">{s.proofBody}</p>
        <ul className="sec-proof-list">
          <li>
            <span className="chip chip--indigo">{SECURITY_BASIS.gateName}</span>{' '}
            {s.proofTestCount(SECURITY_BASIS.testCount)}
          </li>
          <li>{s.proofRepoNote}</li>
          <li>{s.liveNote}</li>
        </ul>
      </section>
    </>
  );
}

function PropertyCard({
  property,
  locale,
  s,
}: {
  property: SecurityProperty;
  locale: 'en' | 'de';
  s: Awaited<ReturnType<typeof getI18n>>['t']['security'];
}) {
  const copy = s.props[property.key];
  const basisText = s.basis[property.basis];

  return (
    <section className="card sec-card">
      <div className="sec-card-head">
        <h3>{copy.title}</h3>
        <SecurityStatusChip basis={property.basis} status={property.status} locale={locale} />
      </div>
      <p className="sec-card-body">{copy.body}</p>

      <dl className="sec-meta">
        <div>
          <dt>{s.statusLabel}</dt>
          <dd>{evidenceLine(property, s)}</dd>
        </div>
        <div>
          <dt>{s.basisLabel}</dt>
          <dd className="sec-basis">
            {basisText}
            {'basisDetail' in copy && copy.basisDetail ? ` · ${copy.basisDetail}` : ''}
          </dd>
        </div>
      </dl>

      {property.status === 'unknown' ? <p className="sec-hint">{s.unknownHint}</p> : null}
    </section>
  );
}

/** Turn a property's structured evidence into the human "what we found" line —
 * always the honest value: the real live measurement, the derived count, or the
 * plain statement. Never a generic "OK". */
function evidenceLine(
  p: SecurityProperty,
  s: Awaited<ReturnType<typeof getI18n>>['t']['security'],
): string {
  const ev = p.evidence;
  switch (ev.kind) {
    case 'rlsCount': {
      const props = s.props.tenantIsolation;
      return p.status === 'fail'
        ? props.evidenceFail(ev.secured, ev.total)
        : props.evidenceLive(ev.secured, ev.total);
    }
    case 'auditPolicies': {
      const props = s.props.auditImmutability;
      return p.status === 'fail' ? props.evidenceFail : props.evidenceLive;
    }
    case 'moneySkills':
      return s.props.moneyFailsafe.evidence(ev.total);
    case 'threshold':
      return s.props.antiHallucination.evidence(ev.value);
    case 'statement':
      return s.props.euDataResidency.evidence;
    case 'error':
      // Show the failure honestly, not a green light.
      return `${s.chip.unknown}: ${ev.message}`;
  }
}
