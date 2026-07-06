import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { PageShell, Section, Eyebrow, CtaBand } from "@/components/marketing/site";
import {
  ArchitectureDiagram,
  LoopDiagram,
} from "@/components/marketing/subpage-client";
import {
  SkillRunSignature,
  CoreCard,
  DepartmentCard,
  AutonomySelector,
  LogoGrid,
} from "@/components/marketing/home-client";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "helix.ai — the operating DNA of your company.",
  description:
    "Two strands: what your company knows, and what it does with it. Cited answers, human-gated actions, append-only audit. EU-hosted, GDPR-native.",
  openGraph: {
    title: "helix.ai — the operating DNA of your company.",
    description:
      "Two strands: what your company knows, and what it does with it. Cited answers, human-gated actions, append-only audit.",
  },
};

export default async function Home() {
  const { userId, orgId } = await auth();
  if (userId) redirect(orgId ? "/dashboard" : "/select-org");

  return (
    <PageShell>
      {/* ------------------------------------------------------------------ */}
      {/* 1. HERO                                                            */}
      {/* ------------------------------------------------------------------ */}
      <section
        style={{
          position: "relative",
          overflow: "hidden",
          borderBottom: "1px solid var(--m-hairline)",
          background: "var(--m-background)",
        }}
      >
        {/* gridpaper background */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            inset: 0,
            opacity: 0.35,
            pointerEvents: "none",
            backgroundImage:
              "linear-gradient(to right, var(--m-hairline) 1px, transparent 1px), linear-gradient(to bottom, var(--m-hairline) 1px, transparent 1px)",
            backgroundSize: "56px 56px",
            maskImage:
              "radial-gradient(ellipse 60% 60% at 30% 30%, black 40%, transparent 75%)",
          }}
        />
        {/* ember glow */}
        <div
          aria-hidden
          style={{
            position: "absolute",
            right: -160,
            top: -160,
            width: 520,
            height: 520,
            borderRadius: "50%",
            pointerEvents: "none",
            background:
              "radial-gradient(circle, rgba(214,83,26,0.14) 0%, rgba(214,83,26,0) 65%)",
          }}
        />

        <div
          style={{
            position: "relative",
            maxWidth: 1200,
            margin: "0 auto",
            padding: "80px 24px",
          }}
        >
          <div
            className="m-rise-in"
            style={{
              display: "grid",
              gap: 56,
              gridTemplateColumns: "1.05fr 1fr",
              alignItems: "center",
            }}
          >
            {/* Left — copy */}
            <div>
              {/* Pilot badge */}
              <div
                className="m-mono-sm"
                style={{
                  marginBottom: 24,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 8,
                  borderRadius: 999,
                  border: "1px solid var(--m-hairline)",
                  background: "var(--m-surface)",
                  padding: "4px 12px",
                  color: "var(--m-muted-foreground)",
                }}
              >
                <span
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    background: "var(--m-ember)",
                  }}
                  className="m-amber-pulse"
                />
                pilot program 2026 · three seats open
              </div>

              <h1
                style={{
                  color: "var(--m-foreground)",
                  fontFamily: '"Fraunces", Georgia, serif',
                  letterSpacing: "-0.03em",
                }}
              >
                The operating
                <br />
                <span className="m-text-ember">DNA</span> of your
                <br />
                company.
              </h1>

              <p
                style={{
                  marginTop: 24,
                  fontSize: 18,
                  color: "var(--m-body)",
                  maxWidth: "48ch",
                }}
              >
                Two strands: what your company knows, and what it does
                with it. Cited answers, human-gated actions, append-only
                audit.
              </p>

              <div
                style={{
                  marginTop: 36,
                  display: "flex",
                  flexWrap: "wrap",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <Link href="/pilot/request" className="m-btn-primary">
                  Request a pilot
                </Link>
                <Link href="/product" className="m-btn-secondary">
                  See the product
                </Link>
              </div>

              {/* Trust line */}
              <div
                className="m-mono-sm"
                style={{
                  marginTop: 32,
                  display: "flex",
                  flexWrap: "wrap",
                  gap: "8px 20px",
                  color: "var(--m-muted-foreground)",
                  fontSize: 12,
                }}
              >
                <span>EU-hosted</span>
                <span aria-hidden style={{ opacity: 0.4 }}>
                  ·
                </span>
                <span>GDPR-native</span>
                <span aria-hidden style={{ opacity: 0.4 }}>
                  ·
                </span>
                <span>SOC 2 Type II</span>
              </div>
            </div>

            {/* Right — SkillRunSignature */}
            <div className="m-rise-in" style={{ animationDelay: "80ms" }}>
              <SkillRunSignature />
            </div>
          </div>
        </div>
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* 2. THE SHIFT                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Section bg="muted" className="m-hairline-b">
        <Eyebrow>the shift</Eyebrow>
        <h2
          style={{
            marginTop: 16,
            maxWidth: "22ch",
          }}
        >
          From tools to a system.
        </h2>

        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 24,
          }}
        >
          {(
            [
              [
                "01 · system",
                "You already use AI. helix turns isolated tools into a connected operating system.",
              ],
              [
                "02 · core",
                "Knowledge, Skills, Governance, Memory — four primitives that work as one.",
              ],
              [
                "03 · trust",
                "Every action is cited, gated, and logged. The audit trail is the product.",
              ],
            ] as const
          ).map(([label, text]) => (
            <div
              key={label}
              className="m-card"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div
                className="m-mono-sm"
                style={{ color: "var(--m-ember)" }}
              >
                {label}
              </div>
              <p style={{ fontSize: 15.5, color: "var(--m-foreground)" }}>
                {text}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 3. HOW IT WORKS                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section>
        <Eyebrow>architecture</Eyebrow>
        <h2 style={{ marginTop: 16, maxWidth: "22ch" }}>How it works.</h2>

        <div
          className="m-gridpaper"
          style={{
            marginTop: 48,
            overflow: "hidden",
            borderRadius: 16,
            border: "1px solid var(--m-hairline)",
            padding: "24px 40px",
          }}
        >
          <ArchitectureDiagram />
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 4. THE CORE                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Section bg="muted" className="m-hairline-t m-hairline-b">
        <Eyebrow>the core</Eyebrow>
        <h2 style={{ marginTop: 16, maxWidth: "22ch" }}>
          The core, in detail.
        </h2>

        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
          }}
        >
          <CoreCard
            label="knowledge"
            title="Grounded, never guessed."
            body="Your documents, policies, and SOPs — ingested, chunked, embedded. Every answer cites its source."
            run={[
              { t: "refund-policy.pdf ingested", k: "info" },
              { t: "Retrieved: 2 passages", k: "ok" },
              { t: "Answer: prorated refund within 30 days", k: "ok" },
              { t: "Source: refund-policy.pdf p.14", k: "audit" },
            ]}
          />
          <CoreCard
            label="skills"
            title="Agents that do the work."
            body="Multi-step workflows that read, write, and act across your tools — always gated by governance."
            run={[
              { t: "Zoom transcript loaded · 47 min", k: "info" },
              { t: "Extracted: 8 decisions, 4 owners", k: "ok" },
              { t: "Assembled framework_v1.docx", k: "ok" },
              { t: "Artifact ready · awaiting review", k: "done" },
            ]}
          />
          <CoreCard
            label="governance"
            title="Powerful, but never unchecked."
            body="Approval flows, spending limits, role-based gates. The system asks before it acts."
            run={[
              { t: "Booking prepared · €1,240.00", k: "ok" },
              { t: "Guardrail: amount over €1,000", k: "wait" },
              { t: "Approved · anna.k → markus.r", k: "approved" },
              { t: "+1 audit_log · immutable", k: "audit" },
            ]}
          />
          <CoreCard
            label="memory"
            title="It remembers your customers."
            body="Entities, interactions, artifacts — persistent context scoped to your tenant."
            run={[
              { t: "Customer: Acme Corp", k: "info" },
              { t: "Recalled: 3 prior interactions", k: "ok" },
              { t: "Context loaded · scoped to tenant", k: "ok" },
              { t: "Ready · continue where you left off", k: "done" },
            ]}
          />
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 5. THE LOOP                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Section>
        <Eyebrow>the loop</Eyebrow>
        <h2 style={{ marginTop: 16, maxWidth: "26ch" }}>
          The system watches its own work.
        </h2>

        <div
          style={{
            marginTop: 48,
            display: "grid",
            alignItems: "center",
            gap: 48,
            gridTemplateColumns: "minmax(0,1fr) 1.1fr",
          }}
        >
          {/* Left — LoopDiagram */}
          <div
            className="m-gridpaper"
            style={{
              borderRadius: 16,
              border: "1px solid var(--m-hairline)",
              padding: "24px 40px",
            }}
          >
            <LoopDiagram />
          </div>

          {/* Right — autonomy selector + copy */}
          <div>
            <div
              className="m-mono-sm"
              style={{
                marginBottom: 16,
                color: "var(--m-muted-foreground)",
              }}
            >
              autonomy · per workflow
            </div>
            <AutonomySelector />
            <p
              style={{
                marginTop: 24,
                maxWidth: "52ch",
                fontSize: 15,
                color: "var(--m-body)",
              }}
            >
              You decide how much autonomy each workflow gets. Money and
              irreversible actions always stay gated.
            </p>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 6. INTEGRATIONS                                                    */}
      {/* ------------------------------------------------------------------ */}
      <Section bg="muted" className="m-hairline-t m-hairline-b">
        <Eyebrow>integrations</Eyebrow>
        <h2 style={{ marginTop: 16, maxWidth: "24ch" }}>
          Reads and writes. One core.
        </h2>

        <LogoGrid />

        <p
          className="m-mono-sm"
          style={{
            marginTop: 24,
            color: "var(--m-muted-foreground)",
            fontSize: 12.5,
          }}
        >
          Gmail, Slack, Zoom, Teams, Notion, Drive, Calendar, Linear,
          GitHub, HubSpot, Salesforce — and more.
        </p>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 7. EVERY DEPARTMENT                                                */}
      {/* ------------------------------------------------------------------ */}
      <Section>
        <Eyebrow>use cases</Eyebrow>
        <h2 style={{ marginTop: 16, maxWidth: "24ch" }}>
          Every department. One system.
        </h2>

        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 24,
          }}
        >
          <DepartmentCard
            label="consulting"
            title="Turn a call into a finished framework."
            line="call → framework"
            run={[
              { t: "Zoom transcript loaded · 47 min", k: "info" },
              { t: "Extracted: 8 decisions, 4 owners", k: "ok" },
              { t: "Assembled framework_v1.docx", k: "ok" },
              { t: "Artifact ready", k: "done" },
            ]}
          />
          <DepartmentCard
            label="customer support"
            title="Answer from your knowledge, not guesses."
            line="ticket → cited reply"
            run={[
              { t: "Ticket: refund policy?", k: "info" },
              { t: "Retrieved: refund-policy.pdf p.14", k: "ok" },
              { t: "Reply drafted · source cited", k: "done" },
            ]}
          />
          <DepartmentCard
            label="sales"
            title="From call to proposal."
            line="call → proposal"
            run={[
              { t: "Call · Acme Corp · 32 min", k: "info" },
              { t: "Pulled wins, references, pricing", k: "ok" },
              { t: "Assembled proposal draft", k: "ok" },
              { t: "Pricing outside band · waiting", k: "wait" },
            ]}
          />
          <DepartmentCard
            label="finance"
            title="Process the routine, gate the risky."
            line="invoice → booking"
            run={[
              { t: "Invoice · Acme Corp · €1,240.00", k: "info" },
              { t: "Matched booking rule", k: "ok" },
              { t: "Amount over €1,000 · waiting", k: "wait" },
              { t: "Approved → posted to SAP", k: "approved" },
            ]}
          />
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 8. SECURITY                                                        */}
      {/* ------------------------------------------------------------------ */}
      <Section bg="muted" className="m-hairline-t m-hairline-b">
        <Eyebrow>security & trust</Eyebrow>
        <h2 style={{ marginTop: 16, maxWidth: "24ch" }}>
          Security is the architecture.
        </h2>

        <div
          style={{
            marginTop: 48,
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 24,
          }}
        >
          {(
            [
              [
                "EU-hosted",
                "Hetzner, Frankfurt. Your data never leaves the EU.",
              ],
              [
                "Encrypted",
                "AES-256 at rest, TLS 1.3 in transit.",
              ],
              [
                "Tenant-isolated",
                "Row-level security. No data leaks between orgs.",
              ],
              [
                "Human-gated",
                "Approval required for every write action.",
              ],
              [
                "Append-only audit",
                "Every decision logged. Immutable.",
              ],
              [
                "GDPR-native",
                "Data residency, DPA, right to erasure — built in.",
              ],
            ] as const
          ).map(([label, text]) => (
            <div
              key={label}
              className="m-card"
              style={{ display: "flex", flexDirection: "column", gap: 12 }}
            >
              <div
                className="m-mono-sm"
                style={{ color: "var(--m-ember)" }}
              >
                {label}
              </div>
              <p style={{ fontSize: 15, color: "var(--m-foreground)" }}>
                {text}
              </p>
            </div>
          ))}
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 9. PILOT CTA                                                       */}
      {/* ------------------------------------------------------------------ */}
      <Section>
        <div style={{ maxWidth: 720, margin: "0 auto", textAlign: "center" }}>
          <h2>Start in weeks, not months.</h2>
          <p
            style={{
              margin: "20px auto 0",
              maxWidth: "58ch",
              color: "var(--m-body)",
            }}
          >
            helix is onboarding a small number of pilot companies in 2026.
            Work directly with the founder, shape the roadmap, get
            white-glove setup — DPA before you upload anything.
          </p>
          <div style={{ marginTop: 32 }}>
            <Link href="/pilot/request" className="m-btn-primary">
              Request a pilot
            </Link>
          </div>
        </div>
      </Section>

      {/* ------------------------------------------------------------------ */}
      {/* 10. CTA BAND                                                       */}
      {/* ------------------------------------------------------------------ */}
      <CtaBand
        img="/marketing/scattered.jpg"
        title="The operating DNA of your company."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </PageShell>
  );
}
