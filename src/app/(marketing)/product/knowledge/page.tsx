import type { Metadata } from "next";
import { Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  SubPageShell,
  SubHero,
  TintedImage,
} from "@/components/marketing/subpage";
import {
  AnimatedTerminal,
  RAGPipeline,
} from "@/components/marketing/subpage-client";

export const metadata: Metadata = {
  title: "Knowledge",
  description:
    "Grounded, never guessed. How helix ingests, chunks, embeds, and cites your documents.",
};

const FEATURES = [
  {
    label: "Retrieval-only",
    text: "helix retrieves and cites. It does not generate answers from thin air.",
  },
  {
    label: "Source trace",
    text: "Every answer links back to the exact passage, page, and document.",
  },
  {
    label: "Your store, isolated",
    text: "Each tenant has its own vector store. No cross-contamination.",
  },
];

export default function KnowledgePage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Knowledge"
        title="Grounded,"
        accent="never guessed."
        subtitle="Your documents, policies, and SOPs — ingested, chunked, embedded. Every answer cites its source. No hallucination, no guessing."
        right={<TintedImage src="/marketing/thread.jpg" alt="Knowledge base" />}
      />

      {/* RAG pipeline */}
      <Section>
        <Eyebrow>retrieval</Eyebrow>
        <h2>How retrieval works.</h2>
        <div style={{ marginTop: 48 }}>
          <RAGPipeline />
        </div>
      </Section>

      {/* Cited answer terminal */}
      <Section bg="muted">
        <Eyebrow>cited answer</Eyebrow>
        <h2>What a cited answer looks like.</h2>
        <div style={{ marginTop: 48, maxWidth: 700 }}>
          <AnimatedTerminal
            title="answer_ticket"
            lines={[
              { t: "Query: refund policy for enterprise?", k: "info" },
              { t: "Retrieved: 2 passages · refund-policy.pdf", k: "ok" },
              { t: "Answer: prorated refund within 30 days", k: "ok" },
              { t: "Source: refund-policy.pdf p.14", k: "audit" },
            ]}
          />
        </div>
      </Section>

      {/* Feature cards */}
      <Section>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 24,
          }}
        >
          {FEATURES.map((f) => (
            <div key={f.label} className="m-card">
              <div
                className="m-mono-sm"
                style={{ color: "var(--m-ember)", marginBottom: 12 }}
              >
                {f.label.toLowerCase()}
              </div>
              <p style={{ fontSize: 15, color: "var(--m-foreground)" }}>
                {f.text}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* CTA */}
      <CtaBand
        img="/marketing/thread.jpg"
        title="Knowledge that cites its sources."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
