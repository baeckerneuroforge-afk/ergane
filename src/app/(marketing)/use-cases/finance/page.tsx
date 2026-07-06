import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Finance",
  description:
    "Process the routine, gate the risky — invoices, bookings, compliance, human-gated.",
};

const STEPS = [
  { num: "01", label: "Receive", description: "An invoice arrives via email." },
  {
    num: "02",
    label: "Match",
    description: "helix matches the invoice to a booking rule in your policy.",
  },
  {
    num: "03",
    label: "Prepare",
    description: "The booking is prepared in your ledger.",
  },
  {
    num: "04",
    label: "Gate",
    description: "Amounts over threshold require human approval before posting.",
  },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Invoice received · Acme Corp · €1,240.00", k: "info" },
  { t: "Matched booking rule · policy.pdf p.14", k: "ok" },
  { t: "Prepared booking in ledger", k: "ok" },
  { t: "Amount over €1,000 · waiting for approval", k: "wait" },
  { t: "Approved by anna.k → posted to SAP", k: "approved" },
  { t: "+1 audit_log · immutable", k: "audit" },
];

export default function FinancePage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Use Case · Finance"
        title="Process the routine,"
        accent="gate the risky."
        subtitle="Invoices, bookings, compliance checks — automated where safe, human-gated where it matters."
        right={<TintedImage src="/marketing/forge.jpg" />}
      />

      {/* Workflow */}
      <Section>
        <Eyebrow>workflow</Eyebrow>
        <h2>From invoice to booking.</h2>
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
        <h2>A finance run.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="book_invoices" lines={TRACE_LINES} />
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
          Routine processed. Risky gated. Every step logged.
        </p>
      </Section>

      <CtaBand
        img="/marketing/forge.jpg"
        title="Finance, automated and gated."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
