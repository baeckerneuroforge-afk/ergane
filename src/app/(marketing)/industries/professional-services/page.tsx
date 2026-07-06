import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Professional Services",
  description:
    "Frameworks at scale — from call to deliverable, with governance built in.",
};

const HELPS = [
  {
    title: "Call to framework",
    description:
      "Zoom transcripts become structured deliverables — decisions, owners, timelines extracted automatically.",
  },
  {
    title: "Knowledge at your fingertips",
    description:
      "Policies, past frameworks, and best practices — retrieved and cited, never guessed.",
  },
  {
    title: "Governance built in",
    description:
      "Approval flows, version control, and audit trails — every deliverable is tracked.",
  },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Zoom transcript · Q3 planning · 47 min", k: "info" },
  { t: "Extracted: decisions, owners, timelines", k: "ok" },
  { t: "Assembled framework_v1.docx", k: "ok" },
  { t: "Artifact ready · awaiting review", k: "done" },
];

export default function ProfessionalServicesPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Industry · Professional Services"
        title="Frameworks"
        accent="at scale."
        subtitle="From call to deliverable, with governance built in. helix turns consulting workflows into repeatable, auditable processes."
        right={<TintedImage src="/marketing/ledger.jpg" />}
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
        <h2>A consulting run.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="transcript_to_framework" lines={TRACE_LINES} />
        </div>
      </Section>

      <CtaBand
        img="/marketing/ledger.jpg"
        title="Consulting, scaled."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
