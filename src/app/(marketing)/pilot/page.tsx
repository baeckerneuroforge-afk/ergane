import type { Metadata } from 'next';
import Link from 'next/link';
import { CtaBand } from '@/components/marketing/site';
import { SubPageShell, SubHero, TintedImage, VideoPlaceholder, Section, Eyebrow } from '@/components/marketing/subpage';

export const metadata: Metadata = {
  title: 'Pilot Program',
  description: 'Start in weeks, not months. A structured pilot with clear milestones.',
};

export default function PilotPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Pilot Program 2026"
        title="Start in weeks,"
        accent="not months."
        subtitle="A structured pilot with clear milestones and exit criteria. Three seats available for Q3 2026."
        right={<TintedImage src="/marketing/ledger.jpg" alt="Pilot program" />}
      />

      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 48 }}>
          <div>
            <div className="m-mono-sm" style={{ color: "var(--m-ember)", marginBottom: 20 }}>What you get</div>
            {[
              { label: "Dedicated onboarding", desc: "A helix engineer configures your instance in the first week." },
              { label: "Your knowledge, ingested", desc: "We ingest your documents, policies, and SOPs." },
              { label: "Two workflows deployed", desc: "Two production workflows — live within 30 days." },
              { label: "Weekly check-ins", desc: "Weekly alignment calls with your team." },
              { label: "Full audit trail", desc: "Every action logged from day one." },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--m-hairline)" }}>
                <span style={{ color: "var(--m-ember)" }}>→</span>
                <div>
                  <span style={{ fontSize: 15, fontWeight: 500, color: "var(--m-foreground)" }}>{item.label}</span>
                  <span style={{ fontSize: 15, color: "var(--m-body)" }}> — {item.desc}</span>
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="m-mono-sm" style={{ color: "var(--m-steel)", marginBottom: 20 }}>What we ask</div>
            {[
              { label: "A point of contact", desc: "One person who owns the pilot internally." },
              { label: "Access to documents", desc: "Your SOPs, policies, and knowledge base." },
              { label: "Two workflows to pilot", desc: "Pick two processes to automate first." },
              { label: "Feedback", desc: "Honest feedback to shape the product." },
            ].map((item) => (
              <div key={item.label} style={{ display: "flex", alignItems: "baseline", gap: 12, padding: "12px 0", borderBottom: "1px solid var(--m-hairline)" }}>
                <span style={{ color: "var(--m-steel)", width: 6, height: 6, borderRadius: "50%", background: "var(--m-steel)", display: "inline-block", flexShrink: 0, marginTop: 6 }} />
                <div>
                  <span style={{ fontSize: 15, fontWeight: 500, color: "var(--m-foreground)" }}>{item.label}</span>
                  <span style={{ fontSize: 15, color: "var(--m-body)" }}> — {item.desc}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Section>

      <Section bg="muted">
        <Eyebrow>Coming soon</Eyebrow>
        <h2>See helix in action.</h2>
        <div style={{ marginTop: 32 }}>
          <VideoPlaceholder />
        </div>
      </Section>

      <Section>
        <div style={{ textAlign: "center" }}>
          <h2 style={{ marginBottom: 20 }}>Ready to start?</h2>
          <p style={{ fontSize: 15, color: "var(--m-body)", marginBottom: 24 }}>
            Three seats available for Q3 2026. A structured pilot with clear milestones and exit criteria.
          </p>
          <Link href="/pilot/request" className="m-btn-primary">Request a pilot →</Link>
        </div>
      </Section>

      <CtaBand
        img="/marketing/ledger.jpg"
        title="Start in weeks, not months."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
