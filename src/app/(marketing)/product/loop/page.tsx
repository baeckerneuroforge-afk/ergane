import type { Metadata } from "next";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
  VideoPlaceholder,
} from "@/components/marketing/subpage";
import {
  AnimatedTerminal,
  LoopDiagram,
  AutonomySelector,
} from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "The Loop",
  description:
    "The system watches its own work — observe, compare, flag, correct.",
};

export default function LoopPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="The Loop"
        title="The system watches"
        accent="its own work."
        subtitle="Run, measure, flag, suggest, correct — a continuous improvement cycle that tightens your operations over time."
        right={<TintedImage src="/marketing/stack.jpg" alt="The Loop" />}
      />

      {/* Diagram + Autonomy two-column */}
      <Section>
        <div
          style={{
            display: "grid",
            alignItems: "center",
            gap: 48,
            gridTemplateColumns: "minmax(0,1fr) 1.1fr",
          }}
        >
          <div
            style={{
              borderRadius: 16,
              border: "1px solid var(--m-hairline)",
              padding: "24px 40px",
            }}
            className="m-gridpaper"
          >
            <LoopDiagram />
          </div>
          <div>
            <AutonomySelector />
            <p
              style={{
                marginTop: 24,
                maxWidth: "42ch",
                color: "var(--m-body)",
                fontSize: 15,
              }}
            >
              Each workflow can be set to supervised, suggest, or autonomous.
            </p>
          </div>
        </div>
      </Section>

      {/* Flag terminal */}
      <Section bg="muted">
        <Eyebrow>flag</Eyebrow>
        <h2>A flag being raised.</h2>
        <div style={{ marginTop: 48, maxWidth: 700 }}>
          <AnimatedTerminal
            title="loop_check"
            lines={[
              { t: "Metric check · avg response time", k: "info" },
              { t: "Target: < 4h · actual: 6.2h", k: "ok" },
              { t: "Deviation flagged · threshold exceeded", k: "wait" },
              { t: "Suggested: reassign to tier-2 queue", k: "done" },
            ]}
          />
        </div>
      </Section>

      {/* Video */}
      <Section>
        <VideoPlaceholder />
      </Section>

      {/* CTA */}
      <CtaBand
        img="/marketing/stack.jpg"
        title="The system that watches its own work."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
