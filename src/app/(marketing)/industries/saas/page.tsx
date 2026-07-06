import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "SaaS & Technology",
  description:
    "Ship faster, support smarter — spec tracking, drift detection, cited support.",
};

const HELPS = [
  {
    title: "Spec vs. delivery",
    description:
      "Compare delivered features against the original spec. Drift is flagged automatically.",
  },
  {
    title: "Cited support",
    description:
      "Customer questions answered from your docs — with inline source citations.",
  },
  {
    title: "Loop integration",
    description:
      "The loop watches your metrics and flags deviations before they become incidents.",
  },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Linear sync · project INGEST", k: "info" },
  { t: "Compared: spec vs. delivered features", k: "ok" },
  { t: "Drift flagged: 2 features behind spec", k: "wait" },
  { t: "Suggested: re-prioritize sprint backlog", k: "done" },
];

export default function SaaSPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Industry · SaaS & Technology"
        title="Ship faster,"
        accent="support smarter."
        subtitle="Spec tracking, drift detection, cited customer support — helix fits into your product and engineering workflows."
        right={<TintedImage src="/marketing/ember.jpg" />}
      />

      {/* How helix helps */}
      <Section>
        <Eyebrow>how helix helps</Eyebrow>
        <h2>Three ways helix helps.</h2>
        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 24,
          }}
        >
          {HELPS.map((h) => (
            <div key={h.title} className="m-card">
              <h3>{h.title}</h3>
              <p
                className="m-mt-2 m-text-sm"
                style={{ color: "var(--m-body)" }}
              >
                {h.description}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* In flight */}
      <Section bg="muted">
        <Eyebrow>in flight</Eyebrow>
        <h2>A SaaS run.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="spec_drift_check" lines={TRACE_LINES} />
        </div>
      </Section>

      <CtaBand
        img="/marketing/ember.jpg"
        title="SaaS, smarter."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
