import type { Metadata } from "next";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
} from "@/components/marketing/subpage";
import { IntegrationGrid } from "./integration-grid";

export const metadata: Metadata = {
  title: "Integrations",
  description: "Read and write. Connect your stack to helix.",
};

export default function IntegrationsPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Integrations"
        title="Read and write."
        accent="One core."
        subtitle="helix connects to the tools you already use. Data flows in, actions flow out."
        right={<TintedImage src="/marketing/forge.jpg" alt="Integrations" />}
      />

      {/* Connector grid (client component — uses BrandLogo) */}
      <Section>
        <Eyebrow>connectors</Eyebrow>
        <h2>Your stack, connected.</h2>
        <IntegrationGrid />
      </Section>

      {/* Data flow */}
      <Section bg="muted">
        <Eyebrow>data flow</Eyebrow>
        <h2>Data flows in. Actions flow out.</h2>
        <p
          style={{
            marginTop: 16,
            maxWidth: "62ch",
            color: "var(--m-body)",
          }}
        >
          Integrations are bidirectional. helix reads from your tools to build
          context — emails, transcripts, tickets, documents. When a skill
          produces an output, it writes back to the same tools: a booking to
          your ERP, a summary to your wiki, a reply to your inbox. Every
          outbound action is gated by governance.
        </p>
      </Section>

      {/* CTA */}
      <CtaBand
        img="/marketing/forge.jpg"
        title="Connect your stack."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
