import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Sales",
  description:
    "From call to proposal — qualify, draft, follow up with cited context.",
};

const STEPS = [
  { num: "01", label: "Call", description: "The sales call is recorded and transcribed." },
  {
    num: "02",
    label: "Enrich",
    description: "helix pulls wins, references, and pricing from your CRM.",
  },
  {
    num: "03",
    label: "Draft",
    description: "A proposal draft is assembled with cited context.",
  },
  {
    num: "04",
    label: "Gate",
    description: "Non-standard pricing is flagged for human approval.",
  },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Call · Acme Corp · 32 min", k: "info" },
  { t: "Pulled wins, references, pricing", k: "ok" },
  { t: "Assembled proposal draft · 6 sections", k: "ok" },
  { t: "Pricing outside standard band · waiting for human", k: "wait" },
];

export default function SalesPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Use Case · Sales"
        title="From call"
        accent="to proposal."
        subtitle="Qualify, draft, follow up — with cited context from your CRM and knowledge base."
        right={<TintedImage src="/marketing/gears.jpg" />}
      />

      {/* Workflow */}
      <Section>
        <Eyebrow>workflow</Eyebrow>
        <h2>From call to proposal.</h2>
        <div className="m-flex m-gap-8 m-mt-8">
          {STEPS.map((s) => (
            <div key={s.num}>
              <span className="m-mono-sm" style={{ color: "var(--m-ember)" }}>
                {s.num}
              </span>
              <h3 className="m-mt-2">{s.label}</h3>
              <p
                className="m-mt-1 m-text-sm"
                style={{ color: "var(--m-body)" }}
              >
                {s.description}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* Trace */}
      <Section bg="muted">
        <Eyebrow>in flight</Eyebrow>
        <h2>A sales run.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="draft_proposal" lines={TRACE_LINES} />
        </div>
      </Section>

      {/* Tagline */}
      <Section>
        <p
          className="m-text-center"
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: "italic",
            fontSize: 22,
            maxWidth: "36ch",
            margin: "0 auto",
            lineHeight: 1.5,
            color: "var(--m-foreground)",
          }}
        >
          From a 32-minute call to a six-section proposal. Gated where it
          matters.
        </p>
      </Section>

      <CtaBand
        img="/marketing/gears.jpg"
        title="From call to proposal."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
