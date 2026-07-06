import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '@/components/marketing/site';
import { SubPageShell, SubHero, TintedImage, Section, Eyebrow } from '@/components/marketing/subpage';

export const metadata: Metadata = {
  title: 'Security',
  description: 'Security is the architecture — EU-hosted, tenant-isolated, append-only audit, GDPR-native.',
};

export default function SecurityPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Security"
        title="Security is"
        accent="the architecture."
        subtitle="Not a checkbox. Not an add-on. Security is built into every layer of helix."
        right={<TintedImage src="/marketing/vault.jpg" alt="Security" />}
      />

      <Section>
        <Eyebrow>pillars</Eyebrow>
        <h2 style={{ maxWidth: "22ch" }}>Four pillars.</h2>
        <div style={{ marginTop: 48, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {[
            {
              href: "/security/data-hosting",
              label: "Data & Hosting",
              desc: "EU-only infrastructure. Encrypted at rest and in transit. Your data never leaves Frankfurt.",
            },
            {
              href: "/security/access-isolation",
              label: "Access & Isolation",
              desc: "Row-level security. Tenant isolation. No data leaks between organizations.",
            },
            {
              href: "/security/audit-compliance",
              label: "Audit & Compliance",
              desc: "Append-only audit log. Every decision logged. GDPR-native by design.",
            },
            {
              href: "/product/governance",
              label: "Human-in-the-Loop",
              desc: "Nothing runs without approval. Every write action is human-gated.",
            },
          ].map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="m-card m-card-hover"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <h3 className="m-mono-sm" style={{ color: "var(--m-muted-foreground)", margin: 0, fontSize: "inherit", fontWeight: "inherit" }}>
                {c.label}
              </h3>
              <p style={{ fontSize: 15, color: "var(--m-body)", margin: 0 }}>{c.desc}</p>
              <span className="m-mono-sm" style={{ color: "var(--m-ember)", marginTop: 8 }}>
                Learn more →
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <Section bg="muted">
        <Eyebrow>trust</Eyebrow>
        <h2>Built for trust.</h2>
        <div style={{ marginTop: 48, display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 32 }}>
          {[
            { title: "SOC 2 Type II", desc: "Annual audit by independent assessors." },
            { title: "GDPR-native", desc: "Data residency, DPA, right to erasure — built in." },
            { title: "DPA available", desc: "Standard data processing agreement. Download or request." },
          ].map((item) => (
            <div key={item.title}>
              <div className="m-mono-sm" style={{ color: "var(--m-ember)", marginBottom: 8 }}>
                {item.title}
              </div>
              <p style={{ fontSize: 15, color: "var(--m-body)", margin: 0 }}>{item.desc}</p>
            </div>
          ))}
        </div>
        <div style={{ marginTop: 32, display: "flex", gap: 24 }}>
          <Link href="/dpa" className="m-mono-sm" style={{ color: "var(--m-foreground)" }}>
            DPA →
          </Link>
          <Link href="/privacy" className="m-mono-sm" style={{ color: "var(--m-foreground)" }}>
            Privacy policy →
          </Link>
        </div>
      </Section>

      <CtaBand
        img="/marketing/vault.jpg"
        title="Security is the product."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
