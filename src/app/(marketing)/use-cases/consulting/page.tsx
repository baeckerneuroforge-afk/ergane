import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Consulting",
  description:
    "Turn a call into a finished framework — Zoom transcripts become structured deliverables.",
};

const STEPS = [
  { num: "01", label: "Record", description: "The call is recorded and transcribed." },
  { num: "02", label: "Extract", description: "helix identifies decisions, owners, timelines." },
  { num: "03", label: "Assemble", description: "A structured framework is generated." },
  { num: "04", label: "Review", description: "The deliverable awaits human approval." },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Zoom transcript loaded · 47 min", k: "info" },
  { t: "Extracted: 8 decisions, 4 owners, 3 dates", k: "ok" },
  { t: "Assembled framework_v1.docx · 6 sections", k: "ok" },
  { t: "Artifact ready · awaiting review", k: "done" },
];

export default function ConsultingPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Use Case · Consulting"
        title="Turn a call into"
        accent="a finished framework."
        subtitle="Zoom transcripts become structured deliverables. helix extracts decisions, owners, and timelines — then assembles the framework."
        right={<TintedImage src="/marketing/ledger.jpg" />}
      />

      {/* Workflow */}
      <Section>
        <Eyebrow>workflow</Eyebrow>
        <h2>From call to deliverable.</h2>
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
        <h2>A skill in flight.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="transcript_to_framework" lines={TRACE_LINES} />
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
          From a 47-minute call to a six-section framework. Reviewed, not
          rewritten.
        </p>
      </Section>

      <CtaBand
        img="/marketing/ledger.jpg"
        title="Turn calls into deliverables."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
