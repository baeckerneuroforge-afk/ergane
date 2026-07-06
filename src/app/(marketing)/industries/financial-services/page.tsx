import type { Metadata } from "next";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";
import type { RunLine } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Financial Services",
  description:
    "Compliance-first automation — every transaction gated, every decision logged.",
};

const HELPS = [
  {
    title: "Gated transactions",
    description:
      "Wire transfers, bookings, and payments — all gated by amount, type, and role.",
  },
  {
    title: "Compliance retrieval",
    description:
      "Regulatory handbooks and policies — retrieved and cited when needed.",
  },
  {
    title: "Append-only audit",
    description:
      "Every decision, approval, and action logged in an immutable audit trail.",
  },
] as const;

const TRACE_LINES: RunLine[] = [
  { t: "Query: wire transfer compliance?", k: "info" },
  { t: "Retrieved: compliance-handbook.pdf p.22", k: "ok" },
  { t: "Transfer prepared · €48,000", k: "ok" },
  { t: "Guardrail: amount over €10,000 · waiting for compliance", k: "wait" },
];

export default function FinancialServicesPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Industry · Financial Services"
        title="Compliance-first"
        accent="automation."
        subtitle="Every transaction gated, every decision logged. helix automates financial workflows with built-in compliance."
        right={<TintedImage src="/marketing/forge.jpg" />}
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
        <h2>A financial services run.</h2>
        <div className="m-mt-8" style={{ maxWidth: 700 }}>
          <AnimatedTerminal title="compliance_check" lines={TRACE_LINES} />
        </div>
      </Section>

      <CtaBand
        img="/marketing/forge.jpg"
        title="Compliance-first."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
