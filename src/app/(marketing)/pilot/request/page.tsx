import type { Metadata } from 'next';
import { CtaBand } from '@/components/marketing/site';
import { SubPageShell, SubHero, Section } from '@/components/marketing/subpage';
import { PilotForm } from './form';

export const metadata: Metadata = {
  title: 'Request a Pilot',
  description: "Start your evaluation — fill out the form and we'll be in touch.",
};

export default function RequestPilotPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Request a Pilot"
        title="Let's"
        accent="talk."
        subtitle="Fill out the form below and we'll be in touch within 48 hours."
      />

      <Section>
        <div style={{ display: "grid", gridTemplateColumns: "1.2fr 0.8fr", gap: 48 }}>
          <PilotForm />
          <div>
            <div className="m-card" style={{ textAlign: "center" }}>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 500, color: "var(--m-foreground)" }}>
                Prefer email?
              </h3>
              <a
                href="mailto:pilot@helix.ai"
                className="m-mono"
                style={{ display: "block", fontSize: 18, color: "var(--m-foreground)", marginTop: 16 }}
              >
                pilot@helix.ai
              </a>
              <p style={{ marginTop: 12, fontSize: 14, color: "var(--m-muted-foreground)" }}>
                We respond within 48 hours.
              </p>
            </div>
          </div>
        </div>
      </Section>

      <CtaBand
        title="The operating DNA of your company."
        cta="Back to product"
        href="/product"
      />
    </SubPageShell>
  );
}
