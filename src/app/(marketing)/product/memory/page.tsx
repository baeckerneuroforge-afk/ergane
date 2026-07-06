import type { Metadata } from "next";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
} from "@/components/marketing/subpage";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Memory",
  description:
    "It remembers your customers — entities, interactions, artifacts, scoped to your tenant.",
};

const MEMORY_CARDS = [
  {
    label: "Entities",
    text: "Customers, contacts, projects — structured records that persist across runs.",
  },
  {
    label: "Interactions",
    text: "Every call, email, ticket — logged and linked to the right entity.",
  },
  {
    label: "Artifacts",
    text: "Documents, proposals, frameworks — versioned and retrievable.",
  },
];

export default function MemoryPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Memory"
        title="It remembers"
        accent="your customers."
        subtitle="Entities, interactions, artifacts — persistent context scoped to your tenant. The system picks up where you left off."
        right={<TintedImage src="/marketing/ember.jpg" alt="Memory" />}
      />

      {/* What memory holds */}
      <Section>
        <Eyebrow>what memory holds</Eyebrow>
        <h2>What memory holds.</h2>
        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 24,
          }}
        >
          {MEMORY_CARDS.map((c) => (
            <div key={c.label} className="m-card">
              <div
                className="m-mono-sm"
                style={{ color: "var(--m-ember)", marginBottom: 12 }}
              >
                {c.label.toLowerCase()}
              </div>
              <p style={{ fontSize: 15, color: "var(--m-foreground)" }}>
                {c.text}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Recall in flight */}
      <Section bg="muted">
        <Eyebrow>recall</Eyebrow>
        <h2>Recall in flight.</h2>
        <div style={{ marginTop: 48, maxWidth: 700 }}>
          <AnimatedTerminal
            title="recall_context"
            lines={[
              { t: "Customer: Acme Corp", k: "info" },
              { t: "Recalled: 3 prior interactions", k: "ok" },
              { t: "Context loaded · scoped to tenant", k: "ok" },
              { t: "Ready · continue where you left off", k: "done" },
            ]}
          />
        </div>
      </Section>

      {/* CTA */}
      <CtaBand
        img="/marketing/ember.jpg"
        title="It remembers, so you don't have to."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
