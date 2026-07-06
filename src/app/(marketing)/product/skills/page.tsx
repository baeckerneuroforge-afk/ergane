import type { Metadata } from "next";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
} from "@/components/marketing/subpage";
import { AnimatedTerminal } from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Skills",
  description:
    "Agents that do the work — multi-step workflows that read, write, and act across your tools.",
};

const STEPS = [
  {
    num: "01",
    title: "Trigger",
    desc: "An event arrives — email, webhook, schedule, or human request.",
  },
  {
    num: "02",
    title: "Context",
    desc: "helix pulls relevant knowledge, memory, and prior artifacts.",
  },
  {
    num: "03",
    title: "Plan",
    desc: "The skill assembles a multi-step plan with clear inputs and outputs.",
  },
  {
    num: "04",
    title: "Execute",
    desc: "Each step runs through governance — gated, logged, auditable.",
  },
  {
    num: "05",
    title: "Deliver",
    desc: "The artifact is created, the action is taken, the audit trail is complete.",
  },
];

export default function SkillsPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Skills"
        title="Agents that"
        accent="do the work."
        subtitle="Multi-step workflows that read, write, and act across your tools — always gated by governance."
        right={<TintedImage src="/marketing/gears.jpg" alt="Skills" />}
      />

      {/* Anatomy */}
      <Section>
        <Eyebrow>anatomy</Eyebrow>
        <h2>Anatomy of a skill.</h2>
        <div
          className="m-border-l m-pl-5"
          style={{ marginTop: 48, display: "grid", gap: 24 }}
        >
          {STEPS.map((s) => (
            <div
              key={s.num}
              style={{
                display: "flex",
                gap: 20,
                alignItems: "baseline",
                borderBottom: "1px solid var(--m-hairline)",
                paddingBottom: 24,
              }}
            >
              <span
                className="m-mono"
                style={{ color: "var(--m-ember)", minWidth: 28 }}
              >
                {s.num}
              </span>
              <div>
                <div
                  style={{
                    fontSize: 17,
                    fontWeight: 500,
                    color: "var(--m-foreground)",
                    fontFamily: '"Fraunces", Georgia, serif',
                  }}
                >
                  {s.title}
                </div>
                <p
                  style={{
                    marginTop: 4,
                    fontSize: 15,
                    color: "var(--m-body)",
                  }}
                >
                  {s.desc}
                </p>
              </div>
            </div>
          ))}
        </div>
      </Section>

      {/* Skill in flight */}
      <Section bg="muted">
        <Eyebrow>in flight</Eyebrow>
        <h2>A skill in flight.</h2>
        <div style={{ marginTop: 48, maxWidth: 700 }}>
          <AnimatedTerminal
            title="transcript_to_framework"
            lines={[
              { t: "Zoom transcript loaded · 47 min", k: "info" },
              { t: "Extracted: 8 decisions, 4 owners, 3 dates", k: "ok" },
              { t: "Assembled framework_v1.docx · 6 sections", k: "ok" },
              { t: "Artifact ready · awaiting review", k: "done" },
            ]}
          />
        </div>
      </Section>

      {/* Tagline */}
      <Section>
        <p
          style={{
            fontFamily: '"Fraunces", Georgia, serif',
            fontStyle: "italic",
            fontSize: 22,
            textAlign: "center",
            maxWidth: "36ch",
            margin: "0 auto",
            color: "var(--m-foreground)",
            lineHeight: 1.5,
          }}
        >
          Skills are the hands. Knowledge is the memory. Governance is the
          conscience.
        </p>
      </Section>

      {/* CTA */}
      <CtaBand
        img="/marketing/gears.jpg"
        title="Agents that actually do the work."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
