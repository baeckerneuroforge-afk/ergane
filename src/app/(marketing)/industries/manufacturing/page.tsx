import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Manufacturing & Mittelstand",
  description:
    "Operational knowledge, preserved — specs, tolerances, tribal knowledge, retrievable.",
};

const HELPS = [
  {
    title: "Spec retrieval",
    description:
      "Part numbers, tolerances, surface finishes — retrieved from your spec sheets in seconds.",
  },
  {
    title: "Tribal knowledge",
    description:
      "The expertise that lives in people’s heads — captured, indexed, and cited.",
  },
  {
    title: "Quality gates",
    description:
      "Non-conformance checks and approval workflows — gated and logged.",
  },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Query: tolerances for part X-2041?", k: "info" },
  { t: "Retrieved: spec-sheet-x2041.pdf p.3", k: "ok" },
  { t: "Answer: ±0.05mm, surface Ra 1.6", k: "ok" },
  { t: "Source: spec-sheet-x2041.pdf", k: "audit" },
];

export default function ManufacturingPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Industry · Manufacturing"
        title="Operational knowledge,"
        accent="preserved."
        subtitle="Specs, tolerances, tribal knowledge — ingested, indexed, and retrievable. helix preserves what your people know."
        right={<TintedImage src="/marketing/anvils.jpg" />}
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
        <h2>A manufacturing run.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="spec_query" lines={TRACE_LINES} />
        </div>
      </Section>

      <CtaBand
        img="/marketing/anvils.jpg"
        title="Knowledge, preserved."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
