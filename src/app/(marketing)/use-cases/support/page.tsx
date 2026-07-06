import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Customer Support",
  description:
    "Answer from your knowledge, not guesses — every reply cites its source.",
};

const STEPS = [
  { num: "01", label: "Receive", description: "A customer ticket arrives." },
  {
    num: "02",
    label: "Retrieve",
    description: "helix searches your knowledge base for relevant passages.",
  },
  {
    num: "03",
    label: "Reply",
    description: "A drafted reply with inline source citations.",
  },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Ticket: refund policy for annual plan?", k: "info" },
  { t: "Retrieved: refund-policy.pdf p.14", k: "ok" },
  { t: "Reply drafted · source cited", k: "done" },
];

const FEATURES = [
  {
    title: "Always cited",
    description:
      "Every answer includes the source document, page, and passage.",
  },
  {
    title: "Never fabricated",
    description: "helix retrieves — it does not make things up.",
  },
] as const;

export default function SupportPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Use Case · Support"
        title="Answer from"
        accent="your knowledge,"
        after="not guesses."
        subtitle="Every reply is grounded in your documentation. No hallucination, no guessing — just cited answers."
        right={<TintedImage src="/marketing/ribbon.jpg" />}
      />

      {/* Workflow */}
      <Section>
        <Eyebrow>workflow</Eyebrow>
        <h2>From ticket to cited reply.</h2>
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
        <h2>A support run.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="answer_ticket" lines={TRACE_LINES} />
        </div>
      </Section>

      {/* Feature grid */}
      <Section>
        <div className="m-grid m-grid-2 m-gap-6">
          {FEATURES.map((f) => (
            <div key={f.title} className="m-card">
              <h3>{f.title}</h3>
              <p
                className="m-mt-2 m-text-sm"
                style={{ color: "var(--m-body)" }}
              >
                {f.description}
              </p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        img="/marketing/ribbon.jpg"
        title="Support that cites its sources."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
