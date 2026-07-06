import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '@/components/marketing/site';
import { SubPageShell, SubHero, TintedImage, Section, Eyebrow } from '@/components/marketing/subpage';

export const metadata: Metadata = {
  title: 'Audit & Compliance',
  description: 'Append-only audit log — every decision logged, GDPR-native by design.',
};

export default function AuditCompliancePage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Security · Audit & Compliance"
        title="Append-only."
        accent="Immutable."
        subtitle="Every decision, approval, and action is logged in an append-only audit trail. GDPR-native by design."
        right={<TintedImage src="/marketing/vault.jpg" alt="Audit compliance" />}
      />

      <Section>
        <Eyebrow>Compliance</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {[
            {
              title: "Append-only log",
              desc: "Audit entries are immutable. Once written, they cannot be modified or deleted.",
            },
            {
              title: "GDPR-native",
              desc: "Data residency, consent management, right to erasure — built into the architecture.",
            },
            {
              title: "DPA included",
              desc: "Standard data processing agreement included. EU-compliant by default.",
            },
            {
              title: "Exportable records",
              desc: "Audit logs can be exported for external compliance reviews.",
            },
          ].map((item) => (
            <div key={item.title} className="m-card">
              <h3 className="m-mono-sm" style={{ color: "var(--m-ember)", marginBottom: 12, margin: 0, fontSize: "inherit", fontWeight: "inherit" }}>
                {item.title.toLowerCase()}
              </h3>
              <p style={{ fontSize: 15, color: "var(--m-foreground)", margin: 0, marginTop: 12 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <Section bg="muted">
        <Eyebrow>Documents</Eyebrow>
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          <div>
            <Link href="/dpa" className="m-mono-sm" style={{ color: "var(--m-ember)" }}>
              Data Processing Agreement →
            </Link>
            <p style={{ fontSize: 15, color: "var(--m-body)", margin: 0, marginTop: 6 }}>
              Standard DPA for all pilot and production customers. EU-compliant.
            </p>
          </div>
          <div>
            <Link href="/privacy" className="m-mono-sm" style={{ color: "var(--m-ember)" }}>
              Privacy Policy →
            </Link>
            <p style={{ fontSize: 15, color: "var(--m-body)", margin: 0, marginTop: 6 }}>
              How we handle your data, your rights, and our obligations.
            </p>
          </div>
        </div>
      </Section>

      <CtaBand
        img="/marketing/vault.jpg"
        title="Every decision logged."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
