import type { Metadata } from "next";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
} from "@/components/marketing/subpage";
import {
  AnimatedTerminal,
  AutonomySelector,
} from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Governance",
  description:
    "Powerful, but never unchecked. Approval flows, spending limits, and an append-only audit log.",
};

const AUDIT_ROWS = [
  {
    ts: "2026-07-06 14:23:01",
    actor: "system",
    action: "run.started",
    detail: "skill: book_invoices · tenant: acme",
    status: "ok",
  },
  {
    ts: "2026-07-06 14:23:03",
    actor: "system",
    action: "gate.triggered",
    detail: "amount_threshold · limit: €1,000",
    status: "waiting",
  },
  {
    ts: "2026-07-06 14:24:11",
    actor: "anna.k",
    action: "gate.approved",
    detail: "approved by anna.k → markus.r",
    status: "approved",
  },
  {
    ts: "2026-07-06 14:24:12",
    actor: "system",
    action: "run.completed",
    detail: "posted to SAP · duration: 71s",
    status: "ok",
  },
  {
    ts: "2026-07-06 14:24:12",
    actor: "system",
    action: "audit.written",
    detail: "+1 immutable entry · append-only",
    status: "logged",
  },
];

const TH_STYLE: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  color: "var(--m-muted-foreground)",
  fontWeight: 400,
  fontFamily: "var(--font-mono)",
  fontSize: 11,
  letterSpacing: "0.08em",
  textTransform: "uppercase",
};

const TD_MONO: React.CSSProperties = {
  padding: "10px 12px",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  color: "var(--m-muted-foreground)",
};

const TD_TEXT: React.CSSProperties = {
  padding: "10px 12px",
  fontSize: 13,
  color: "var(--m-body)",
};

export default function GovernancePage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Governance"
        title="Powerful,"
        accent="never unchecked."
        subtitle="Approval flows, spending limits, role-based gates. The system asks before it acts."
        right={<TintedImage src="/marketing/vault.jpg" alt="Governance" />}
      />

      {/* Guardrail in flight */}
      <Section>
        <Eyebrow>guardrail</Eyebrow>
        <h2>Guardrail in flight.</h2>
        <div style={{ marginTop: 48, maxWidth: 700 }}>
          <AnimatedTerminal
            title="guardrail_check"
            lines={[
              { t: "Booking prepared · €1,240.00", k: "ok" },
              {
                t: "Guardrail: amount over €1,000 — waiting for human",
                k: "wait",
              },
              { t: "Approved · anna.k → markus.r", k: "approved" },
              { t: "+1 audit_log · immutable", k: "audit" },
            ]}
          />
        </div>
      </Section>

      {/* Autonomy selector */}
      <Section bg="muted">
        <Eyebrow>autonomy</Eyebrow>
        <h2>Autonomy per workflow.</h2>
        <div style={{ marginTop: 48, maxWidth: 500 }}>
          <AutonomySelector />
        </div>
        <p
          style={{
            marginTop: 24,
            maxWidth: "62ch",
            color: "var(--m-body)",
          }}
        >
          Each workflow can be set to supervised, suggest, or autonomous. You
          choose the level of control.
        </p>
      </Section>

      {/* Audit log table */}
      <Section>
        <Eyebrow>audit</Eyebrow>
        <h2>Append-only ledger.</h2>
        <div
          className="m-card"
          style={{ marginTop: 48, overflowX: "auto" }}
        >
          <table
            style={{
              width: "100%",
              borderCollapse: "collapse",
              fontSize: 13,
            }}
          >
            <thead>
              <tr style={{ borderBottom: "1px solid var(--m-hairline)" }}>
                <th style={TH_STYLE}>timestamp</th>
                <th style={TH_STYLE}>actor</th>
                <th style={TH_STYLE}>action</th>
                <th style={TH_STYLE}>detail</th>
                <th style={TH_STYLE}>status</th>
              </tr>
            </thead>
            <tbody>
              {AUDIT_ROWS.map((row, i) => (
                <tr
                  key={i}
                  style={{ borderBottom: "1px solid var(--m-hairline)" }}
                >
                  <td style={TD_MONO}>{row.ts}</td>
                  <td style={TD_MONO}>{row.actor}</td>
                  <td
                    style={{
                      ...TD_MONO,
                      color: "var(--m-foreground)",
                    }}
                  >
                    {row.action}
                  </td>
                  <td style={TD_TEXT}>{row.detail}</td>
                  <td style={TD_MONO}>{row.status}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      {/* CTA */}
      <CtaBand
        img="/marketing/vault.jpg"
        title="Powerful, but never unchecked."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
