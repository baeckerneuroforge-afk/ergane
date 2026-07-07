import type { Metadata } from "next";
import Link from "next/link";
import { Section, Eyebrow } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
  VideoPlaceholder,
} from "@/components/marketing/subpage";
import { ArchitectureDiagram } from "@/components/marketing/subpage-client";
import { SkillRunShowcase } from "@/components/marketing/home-client";

export const metadata: Metadata = {
  title: "Product",
  description:
    "One core. Every department on top. Knowledge, skills, governance, memory — one audited foundation.",
};

const CORE_LINKS = [
  { href: "/product/knowledge",  label: "Knowledge",  desc: "Grounded, never guessed. Retrieval-only from your corpus." },
  { href: "/product/skills",     label: "Skills",     desc: "Multi-step agents that read your knowledge and act." },
  { href: "/product/governance", label: "Governance", desc: "Risky steps pause for humans. Every step is written." },
  { href: "/product/memory",     label: "Memory",     desc: "Per-customer context that survives across runs." },
] as const;

export default function ProductPage() {
  return (
    <SubPageShell ctaLine="One core, many skills. Start with the one that matters most.">
      <SubHero
        eyebrow="Product · overview"
        title="One core."
        accent="Every department"
        after=" on top."
        sub="helix is the operating system for a company's knowledge and work. It gathers your knowledge, keeps it current, and executes real work on top of it — all cited, all gated, all logged."
        tags={[
          "EU-hosted",
          "no training on your data",
          "append-only audit",
          "human-in-the-loop",
        ]}
        right={
          <TintedImage
            src="/marketing/hero-mesh.jpg"
            alt="Double-helix mesh"
            height={420}
          />
        }
      />

      {/* Architecture */}
      <Section>
        <Eyebrow>Architecture</Eyebrow>
        <h2 style={{ maxWidth: "22ch" }}>
          Input → core → output. Always on the loop.
        </h2>
        <div
          className="m-gridpaper"
          style={{
            marginTop: 48,
            overflow: "hidden",
            borderRadius: 16,
            border: "1px solid var(--m-hairline)",
            padding: 40,
          }}
        >
          <ArchitectureDiagram />
        </div>
      </Section>

      {/* The core */}
      <Section bg="surface" border="both">
        <Eyebrow>The core</Eyebrow>
        <h2 style={{ maxWidth: "22ch" }}>Four parts. One audited foundation.</h2>
        <div
          className="m-grid m-grid-2 m-md-grid-1"
          style={{ marginTop: 48, gap: 24 }}
        >
          {CORE_LINKS.map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="m-card m-card-hover m-card-link"
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 16,
                textDecoration: "none",
              }}
            >
              <div
                className="m-mono-sm"
                style={{ color: "var(--m-muted-foreground)" }}
              >
                {c.label.toLowerCase()}
              </div>
              <h3 style={{ fontSize: 22 }}>{c.label}</h3>
              <p style={{ fontSize: 15.5, color: "var(--m-body)" }}>{c.desc}</p>
              <div className="m-mono-sm m-card-explore" style={{ marginTop: 8 }}>
                explore →
              </div>
            </Link>
          ))}
        </div>
      </Section>

      {/* End to end */}
      <Section>
        <Eyebrow>End to end</Eyebrow>
        <h2 style={{ maxWidth: "24ch" }}>
          Every run has the same signature — whatever the tools.
        </h2>
        <p style={{ marginTop: 16, maxWidth: "58ch", color: "var(--m-body)" }}>
          An invoice in Gmail, a discovery call in Zoom, a question in Slack, a
          deal in HubSpot — the operating system in between is always the same:
          grounded in your knowledge, gated where it matters, logged forever.
        </p>
        <div style={{ marginTop: 40, maxWidth: 860 }}>
          <SkillRunShowcase />
        </div>
        <div style={{ marginTop: 56 }}>
          <VideoPlaceholder
            image="/marketing/hero-mesh.jpg"
            caption="product walkthrough"
          />
        </div>
      </Section>

      {/* Integrations */}
      <Section bg="surface" border="top">
        <Eyebrow>Integrations</Eyebrow>
        <h2 style={{ maxWidth: "24ch" }}>
          Connect the tools your company already runs on.
        </h2>
        <p style={{ marginTop: 16, color: "var(--m-body)" }}>
          helix reads from your tools, and with approval, writes back into them.
        </p>
        <div style={{ marginTop: 32 }}>
          <Link
            href="/product/integrations"
            className="m-mono m-hover-text-ember"
            style={{ color: "var(--m-foreground)" }}
          >
            → see the full integrations map
          </Link>
        </div>
      </Section>
    </SubPageShell>
  );
}
