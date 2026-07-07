import type { Metadata } from "next";
import { Section, Eyebrow } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
} from "@/components/marketing/subpage";
import { IntegrationGrid, IntegrationConstellation } from "./integration-grid";
import { SkillRunShowcase } from "@/components/marketing/home-client";

export const metadata: Metadata = {
  title: "Integrations",
  description:
    "Connect the tools your company already runs on. One integration layer feeding one core.",
};

const READ = [
  "transcripts from Zoom & Teams",
  "tickets from your helpdesk",
  "emails from Gmail / Outlook",
  "docs from Notion / Drive / Confluence",
  "issues from Linear / GitHub / Jira",
  "deals & notes from HubSpot / Salesforce",
];
const WRITE = [
  "bookings back into finance",
  "replies drafted in Gmail / Outlook",
  "calendar holds in Google Calendar",
  "CRM notes in HubSpot / Salesforce",
  "issues opened in Linear / GitHub",
  "Slack messages in the right channel",
];

function ArrowIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
      <path
        d="M2 7h9M7 3l4 4-4 4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function FlowCard({
  tone,
  label,
  title,
  items,
  note,
}: {
  tone: "steel" | "ember";
  label: string;
  title: string;
  items: string[];
  note?: string;
}) {
  const color = tone === "steel" ? "var(--m-steel)" : "var(--m-ember)";
  return (
    <div
      style={{
        borderRadius: 16,
        border: "1px solid var(--m-hairline)",
        background: "var(--m-background)",
        padding: 32,
      }}
    >
      <div
        style={{
          marginBottom: 16,
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12,
          textTransform: "uppercase",
          letterSpacing: "0.14em",
          color,
        }}
      >
        <ArrowIcon /> {label}
      </div>
      <h3 style={{ marginBottom: 24 }}>{title}</h3>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          fontSize: 15.5,
          color: "var(--m-body)",
        }}
      >
        {items.map((r, i) => (
          <li
            key={r}
            className="m-rise-stagger"
            style={{ "--i": i, display: "flex", gap: 12 } as React.CSSProperties}
          >
            <span
              style={{
                marginTop: 8,
                height: 6,
                width: 6,
                flexShrink: 0,
                borderRadius: 999,
                background: color,
              }}
            />
            {r}
          </li>
        ))}
      </ul>
      {note && (
        <p
          style={{
            marginTop: 24,
            fontSize: 12.5,
            color: "var(--m-muted-foreground)",
          }}
        >
          {note}
        </p>
      )}
    </div>
  );
}

export default function IntegrationsPage() {
  return (
    <SubPageShell ctaLine="One integration layer. Every department on the same core.">
      <SubHero
        eyebrow="Product · integrations"
        title="Connect the tools your"
        accent="company"
        after=" already runs on."
        sub="helix reads from your tools and, with approval, writes back into them. One integration layer feeding one core — new connectors add to the same audit trail."
        tags={["read + write", "scoped by policy", "one audit", "same core"]}
        right={<IntegrationConstellation />}
      />

      <Section>
        <Eyebrow>Connectors</Eyebrow>
        <h2 style={{ maxWidth: "22ch" }}>Shipped. Shipping. Same audit.</h2>
        <IntegrationGrid />
      </Section>

      <Section border="top">
        <Eyebrow>In action</Eyebrow>
        <h2 style={{ maxWidth: "24ch" }}>
          Different tools. Same operating system.
        </h2>
        <p style={{ marginTop: 16, maxWidth: "58ch", color: "var(--m-body)" }}>
          Watch the same core run four different trains: mail to ERP, call to
          deck, question to answer, deal to proposal.
        </p>
        <div style={{ marginTop: 40, maxWidth: 860 }}>
          <SkillRunShowcase />
        </div>
      </Section>

      <Section bg="surface" border="both">
        <Eyebrow>Data flow</Eyebrow>
        <h2 style={{ maxWidth: "22ch" }}>Read in. Act out. One audit.</h2>
        <div
          className="m-grid m-grid-2 m-md-grid-1"
          style={{ marginTop: 40, gap: 40 }}
        >
          <FlowCard
            tone="steel"
            label="Read in"
            title="What helix ingests."
            items={READ}
          />
          <FlowCard
            tone="ember"
            label="Act out"
            title="What helix writes back."
            items={WRITE}
            note="External writes are gated by policy per skill."
          />
        </div>

        <div style={{ marginTop: 48 }}>
          <TintedImage
            src="/marketing/forge.jpg"
            alt="One integration layer, one audit"
            height={260}
          />
        </div>
      </Section>
    </SubPageShell>
  );
}
