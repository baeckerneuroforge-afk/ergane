import type { Metadata } from "next";
import Link from "next/link";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
  VideoPlaceholder,
} from "@/components/marketing/subpage";
import {
  AnimatedTerminal,
  ArchitectureDiagram,
} from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Product",
  description:
    "The full architecture of helix — knowledge, skills, governance, memory, the loop, and integrations.",
};

const PRIMITIVES = [
  {
    href: "/product/knowledge",
    label: "Knowledge",
    headline: "Grounded, never guessed.",
    desc: "Your documents, policies, and SOPs — ingested, chunked, embedded. Every answer cites its source.",
  },
  {
    href: "/product/skills",
    label: "Skills",
    headline: "Agents that do the work.",
    desc: "Multi-step workflows that read, write, and act across your tools — always gated by governance.",
  },
  {
    href: "/product/governance",
    label: "Governance",
    headline: "Powerful, but never unchecked.",
    desc: "Approval flows, spending limits, role-based gates. The system asks before it acts.",
  },
  {
    href: "/product/memory",
    label: "Memory",
    headline: "It remembers your customers.",
    desc: "Entities, interactions, artifacts — persistent context scoped to your tenant.",
  },
];

export default function ProductPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Product"
        title="One core."
        accent="Every department"
        after="on top."
        subtitle="Two strands: what your company knows, and what it does with it. Knowledge, Skills, Governance, Memory — four primitives, one loop, complete audit."
        tags={[
          "knowledge",
          "skills",
          "governance",
          "memory",
          "the loop",
          "integrations",
        ]}
        right={
          <TintedImage src="/marketing/hero-mesh.jpg" alt="helix architecture" />
        }
      />

      {/* Architecture */}
      <Section>
        <Eyebrow>architecture</Eyebrow>
        <h2>How it works.</h2>
        <div style={{ marginTop: 48 }}>
          <ArchitectureDiagram />
        </div>
      </Section>

      {/* Four primitives */}
      <Section bg="muted">
        <Eyebrow>the core</Eyebrow>
        <h2>Four primitives.</h2>
        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
          }}
        >
          {PRIMITIVES.map((c) => (
            <Link
              key={c.label}
              href={c.href}
              className="m-card m-card-hover"
              style={{ textDecoration: "none" }}
            >
              <div
                className="m-mono-sm"
                style={{ color: "var(--m-muted-foreground)", marginBottom: 8 }}
              >
                {c.label.toLowerCase()}
              </div>
              <div
                style={{
                  fontSize: 20,
                  fontWeight: 500,
                  color: "var(--m-foreground)",
                  fontFamily: '"Fraunces", Georgia, serif',
                }}
              >
                {c.headline}
              </div>
              <p
                style={{
                  marginTop: 8,
                  fontSize: 15,
                  color: "var(--m-body)",
                }}
              >
                {c.desc}
              </p>
              <span
                className="m-mono-sm"
                style={{ color: "var(--m-ember)", marginTop: 12, display: "block" }}
              >
                explore &rarr;
              </span>
            </Link>
          ))}
        </div>
      </Section>

      {/* Skill in flight */}
      <Section>
        <Eyebrow>end to end</Eyebrow>
        <h2>A skill in flight.</h2>
        <div style={{ marginTop: 48, maxWidth: 700 }}>
          <AnimatedTerminal
            title="book_invoices"
            lines={[
              { t: "Invoice received · Acme Corp · €1,240.00", k: "info" },
              { t: "Matched booking rule · policy.pdf p.14", k: "ok" },
              { t: "Prepared booking in ledger", k: "ok" },
              { t: "Amount over €1,000 · waiting for approval", k: "wait" },
              { t: "Approved by anna.k → posted to SAP", k: "approved" },
              { t: "+1 audit_log · immutable", k: "audit" },
            ]}
          />
        </div>
      </Section>

      {/* Video placeholder */}
      <Section bg="muted">
        <VideoPlaceholder />
      </Section>

      {/* Integrations */}
      <Section>
        <Eyebrow>integrations</Eyebrow>
        <h2>Connect your stack.</h2>
        <p
          style={{
            marginTop: 16,
            maxWidth: "62ch",
            color: "var(--m-body)",
          }}
        >
          helix connects to the tools your company already runs on — data flows
          in, actions flow out, with approval at every step.
        </p>
        <div style={{ marginTop: 32 }}>
          <Link href="/product/integrations" className="m-btn-secondary">
            See all integrations &rarr;
          </Link>
        </div>
      </Section>

      {/* CTA */}
      <CtaBand
        img="/marketing/stack.jpg"
        title="The operating DNA of your company."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
