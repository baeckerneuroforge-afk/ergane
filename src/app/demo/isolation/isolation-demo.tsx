'use client';

// The live isolation demo. Holds display state only — the actual cross-tenant
// read runs server-side in runIsolationProof() and comes back as IsolationProof.
// Every verdict shown here is read straight off that result (proof.blocked,
// rowCount, …); nothing is hard-coded, so the screen always reflects what the
// database actually did.
import { useState, useTransition } from 'react';
import type { Locale } from '@/lib/i18n';
import type { DemoItem, IsolationProof } from '@/lib/demo/isolation';
import { runIsolationProof } from './actions';

interface OrgView {
  name: string;
  orgId: string;
  item: DemoItem;
}

function Icon({ d, size = 18 }: { d: string; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d={d} />
    </svg>
  );
}

const ICON = {
  shield: 'M12 2l7 4v6c0 5-3.5 8.5-7 10-3.5-1.5-7-5-7-10V6l7-4z',
  check: 'M20 6L9 17l-5-5',
  lock: 'M5 11h14v10H5zM8 11V7a4 4 0 0 1 8 0v4',
  alert: 'M12 9v4M12 17h.01M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
  arrow: 'M5 12h14M13 6l6 6-6 6',
} as const;

type Copy = {
  liveBadge: string;
  pageTitle: string;
  intro: string;
  yourContext: string;
  anotherTenant: string;
  orgIdLabel: string;
  recordLabel: string;
  recordIdLabel: string;
  visibleOnly: (name: string) => string;
  run: string;
  running: string;
  again: string;
  idleHint: (a: string, b: string) => string;
  attemptTitle: string;
  attemptDesc: (a: string, b: string) => string;
  blockedTitle: string;
  blockedSub: string;
  leakTitle: string;
  leakSub: string;
  evidenceAttempt: (a: string, b: string) => string;
  evidenceControl: (a: string) => string;
  evidenceTarget: (b: string) => string;
  rows: (n: number) => string;
  found: string;
  blocked: string;
  whyTitle: string;
  why: string;
  rawTitle: string;
  errorTitle: string;
};

const COPY: Record<Locale, Copy> = {
  en: {
    liveBadge: 'Live demo',
    pageTitle: 'Tenant isolation, enforced by the database',
    intro:
      'Two demo organizations, each owning one record. Watch Org A try to read Org B’s record by its exact id — and get nothing back. The block happens inside Postgres (Row-Level Security + FORCE), not in our application code.',
    yourContext: 'query runs in this context',
    anotherTenant: 'another tenant',
    orgIdLabel: 'tenant id',
    recordLabel: 'record',
    recordIdLabel: 'record id',
    visibleOnly: (name) => `Visible to ${name} only`,
    run: 'Attempt cross-tenant access',
    running: 'Querying the database…',
    again: 'Run it again',
    idleHint: (a, b) => `Press the button: ${a} will ask the database for ${b}’s record.`,
    attemptTitle: 'What was attempted',
    attemptDesc: (a, b) => `In ${a}’s tenant context, read ${b}’s record by id.`,
    blockedTitle: 'Blocked — 0 rows returned',
    blockedSub: 'Row-Level Security (FORCE) refused the read at the database layer.',
    leakTitle: 'Leak detected — a foreign row came back',
    leakSub: 'Isolation is broken. This should never happen.',
    evidenceAttempt: (a, b) => `${a} → reads ${b}’s record`,
    evidenceControl: (a) => `${a} → reads its own record (control)`,
    evidenceTarget: (b) => `${b} → reads the same record in its own context`,
    rows: (n) => (n === 1 ? '1 row' : `${n} rows`),
    found: 'found',
    blocked: 'blocked',
    whyTitle: 'Why this is real, not a demo trick',
    why:
      'The verdict above is computed from the actual query result — not hard-coded. The application connects as a least-privileged role that cannot bypass Row-Level Security: not a superuser, no BYPASSRLS, and it owns none of the tables, so FORCE always applies. Even a bug in the application code cannot let one organization read another’s data — the database refuses it.',
    rawTitle: 'Actual query results',
    errorTitle: 'The demo could not run',
  },
  de: {
    liveBadge: 'Live-Demo',
    pageTitle: 'Mandantentrennung — von der Datenbank erzwungen',
    intro:
      'Zwei Demo-Organisationen mit je einem Datensatz. Org A versucht, den Datensatz von Org B über dessen exakte ID zu lesen — und bekommt nichts zurück. Die Blockade passiert in Postgres (Row-Level Security + FORCE), nicht im Anwendungscode.',
    yourContext: 'Query läuft in diesem Kontext',
    anotherTenant: 'fremder Mandant',
    orgIdLabel: 'Mandanten-ID',
    recordLabel: 'Datensatz',
    recordIdLabel: 'Datensatz-ID',
    visibleOnly: (name) => `Nur für ${name} sichtbar`,
    run: 'Zugriff auf fremde Organisation versuchen',
    running: 'Datenbank wird abgefragt…',
    again: 'Erneut ausführen',
    idleHint: (a, b) => `Knopf drücken: ${a} fragt die Datenbank nach dem Datensatz von ${b}.`,
    attemptTitle: 'Was versucht wurde',
    attemptDesc: (a, b) => `Im Mandanten-Kontext von ${a} den Datensatz von ${b} per ID lesen.`,
    blockedTitle: 'Blockiert — 0 Zeilen zurückgegeben',
    blockedSub: 'Row-Level Security (FORCE) hat den Lesezugriff auf Datenbankebene verweigert.',
    leakTitle: 'Leck erkannt — eine fremde Zeile kam zurück',
    leakSub: 'Die Isolation ist gebrochen. Das darf nie passieren.',
    evidenceAttempt: (a, b) => `${a} → liest Datensatz von ${b}`,
    evidenceControl: (a) => `${a} → liest eigenen Datensatz (Kontrolle)`,
    evidenceTarget: (b) => `${b} → liest denselben Datensatz im eigenen Kontext`,
    rows: (n) => (n === 1 ? '1 Zeile' : `${n} Zeilen`),
    found: 'gefunden',
    blocked: 'blockiert',
    whyTitle: 'Warum das echt ist und kein Demo-Trick',
    why:
      'Das Urteil oben wird aus dem tatsächlichen Query-Ergebnis berechnet — nicht hartkodiert. Die Anwendung verbindet sich mit einer minimal privilegierten Rolle, die Row-Level Security nicht umgehen kann: kein Superuser, kein BYPASSRLS, und sie besitzt keine der Tabellen, sodass FORCE immer greift. Selbst ein Fehler im Anwendungscode kann einer Organisation keinen Zugriff auf die Daten einer anderen geben — die Datenbank verweigert ihn.',
    rawTitle: 'Tatsächliche Query-Ergebnisse',
    errorTitle: 'Die Demo konnte nicht ausgeführt werden',
  },
};

function OrgCard({
  org,
  role,
  accent,
  c,
}: {
  org: OrgView;
  role: string;
  accent: 'a' | 'b';
  c: Copy;
}) {
  return (
    <div className={`leak-org leak-org--${accent}`}>
      <div className="leak-org-head">
        <span className="leak-org-name">{org.name}</span>
        <span className={`chip ${accent === 'a' ? 'chip--indigo' : 'chip--orange'}`}>{role}</span>
      </div>
      <div className="leak-org-id">
        <span className="muted">{c.orgIdLabel}</span> <span className="mono">{org.orgId}</span>
      </div>
      <div className="leak-record">
        <span className="leak-record-label muted">{c.recordLabel}</span>
        <strong className="leak-record-title">{org.item.title}</strong>
        <p className="leak-record-body">{org.item.body}</p>
        <div className="leak-record-id">
          <span className="muted">{c.recordIdLabel}</span> <span className="mono">{org.item.id}</span>
        </div>
        <div className="leak-record-note">
          <Icon d={ICON.lock} size={13} />
          {c.visibleOnly(org.name)}
        </div>
      </div>
    </div>
  );
}

function ResultRow({
  label,
  ok,
  chip,
  tone,
}: {
  label: string;
  ok: boolean;
  chip: string;
  tone: 'green' | 'indigo';
}) {
  return (
    <li className="leak-ev">
      <span className={`leak-ev-mark leak-ev-mark--${ok ? 'ok' : 'bad'}`}>
        <Icon d={ok ? ICON.check : ICON.alert} size={14} />
      </span>
      <span className="leak-ev-label">{label}</span>
      <span className={`chip chip--${tone}`}>{chip}</span>
    </li>
  );
}

export function IsolationDemo({
  locale,
  orgA,
  orgB,
}: {
  locale: Locale;
  orgA: OrgView;
  orgB: OrgView;
}) {
  const c = COPY[locale] ?? COPY.en;
  const [proof, setProof] = useState<IsolationProof | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function run() {
    setError(null);
    startTransition(async () => {
      try {
        setProof(await runIsolationProof());
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    });
  }

  return (
    <div className="leak">
      <header className="leak-head">
        <div className="leak-brand">
          <span className="leak-wordmark">
            ergane<span className="leak-dot">.</span>
          </span>
          <span className="chip chip--indigo">
            <span className="leak-live-dot" /> {c.liveBadge}
          </span>
        </div>
        <h1 className="leak-title">
          <span className="leak-shield">
            <Icon d={ICON.shield} size={22} />
          </span>
          {c.pageTitle}
        </h1>
        <p className="leak-intro">{c.intro}</p>
      </header>

      <div className="leak-orgs">
        <OrgCard org={orgA} role={c.yourContext} accent="a" c={c} />
        <div className="leak-arrow" aria-hidden>
          <Icon d={ICON.arrow} size={20} />
        </div>
        <OrgCard org={orgB} role={c.anotherTenant} accent="b" c={c} />
      </div>

      <div className="leak-action">
        <button
          type="button"
          className="btn btn--primary leak-btn"
          onClick={run}
          disabled={isPending}
        >
          {isPending ? c.running : proof ? c.again : c.run}
        </button>
        {!proof && !isPending ? (
          <p className="leak-idle muted">{c.idleHint(orgA.name, orgB.name)}</p>
        ) : null}
      </div>

      <div className="leak-result" aria-live="polite">
        {error ? (
          <div className="leak-verdict leak-verdict--alarm">
            <span className="leak-verdict-mark">
              <Icon d={ICON.alert} size={22} />
            </span>
            <div>
              <div className="leak-verdict-title">{c.errorTitle}</div>
              <div className="leak-verdict-sub mono">{error}</div>
            </div>
          </div>
        ) : null}

        {proof ? (
          <>
            <div className="leak-attempt">
              <span className="leak-attempt-label muted">{c.attemptTitle}</span>
              <p className="leak-attempt-desc">
                {c.attemptDesc(proof.attacker.name, proof.victim.name)}{' '}
                <span className="mono leak-attempt-id">{proof.victim.itemId}</span>
              </p>
            </div>

            <div
              className={`leak-verdict ${proof.blocked ? 'leak-verdict--ok' : 'leak-verdict--alarm'}`}
            >
              <span className="leak-verdict-mark">
                <Icon d={proof.blocked ? ICON.check : ICON.alert} size={24} />
              </span>
              <div>
                <div className="leak-verdict-title">
                  {proof.blocked ? c.blockedTitle : c.leakTitle}
                </div>
                <div className="leak-verdict-sub">
                  {proof.blocked ? c.blockedSub : c.leakSub}
                </div>
              </div>
            </div>

            <ul className="leak-evidence">
              <ResultRow
                label={c.evidenceAttempt(proof.attacker.name, proof.victim.name)}
                ok={proof.crossTenantRead.rowCount === 0}
                chip={`${c.rows(proof.crossTenantRead.rowCount)} · ${c.blocked}`}
                tone="green"
              />
              <ResultRow
                label={c.evidenceControl(proof.attacker.name)}
                ok={proof.controlOk}
                chip={c.rows(proof.controlRead.rowCount)}
                tone="green"
              />
              <ResultRow
                label={c.evidenceTarget(proof.victim.name)}
                ok={proof.victimSelfRead.found}
                chip={c.found}
                tone="indigo"
              />
            </ul>

            <div className="leak-why card">
              <div className="leak-why-title">
                <Icon d={ICON.shield} size={16} /> {c.whyTitle}
              </div>
              <p>{c.why}</p>
            </div>

            <details className="leak-raw json-details">
              <summary>{c.rawTitle}</summary>
              <pre className="json">{JSON.stringify(proof, null, 2)}</pre>
            </details>
          </>
        ) : null}
      </div>
    </div>
  );
}
