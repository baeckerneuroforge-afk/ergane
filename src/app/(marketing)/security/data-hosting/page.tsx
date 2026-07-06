import type { Metadata } from 'next';
import { CtaBand } from '@/components/marketing/site';
import { SubPageShell, SubHero, TintedImage, Section, Eyebrow } from '@/components/marketing/subpage';

export const metadata: Metadata = {
  title: 'Data & Hosting',
  description: 'EU-only infrastructure — Hetzner, Frankfurt, encrypted at rest and in transit.',
};

export default function DataHostingPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Security · Data & Hosting"
        title="EU-only."
        accent="Always."
        subtitle="Your data is hosted in Frankfurt, Germany. Encrypted at rest with AES-256, in transit with TLS 1.3. No data leaves the EU."
        right={<TintedImage src="/marketing/vault.jpg" alt="Data hosting" />}
      />

      <Section>
        <Eyebrow>Infrastructure</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {[
            {
              title: "Hetzner, Frankfurt",
              desc: "Dedicated infrastructure in Germany. No US cloud dependency.",
            },
            {
              title: "AES-256 at rest",
              desc: "All data encrypted at rest with AES-256 encryption.",
            },
            {
              title: "TLS 1.3 in transit",
              desc: "All connections encrypted with TLS 1.3. No exceptions.",
            },
            {
              title: "No data export",
              desc: "Your data never leaves the EU. No transatlantic transfers.",
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

      <CtaBand
        img="/marketing/vault.jpg"
        title="Your data, in Frankfurt."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
