"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BrandLogo } from "@/components/marketing/logo";

/* ===== RunLine type + MiniRun ===== */
type RunLine = { t: string; k: "info" | "ok" | "wait" | "approved" | "done" | "audit" };

const MINI_META: Record<RunLine["k"], { label: string; dot: string }> = {
  info:     { label: "in",      dot: "#8A8880" },
  ok:       { label: "found",   dot: "#2E7D55" },
  wait:     { label: "waiting", dot: "#BE5A2C" },
  approved: { label: "ok",      dot: "#2E7D55" },
  done:     { label: "done",    dot: "#2E7D55" },
  audit:    { label: "source",  dot: "#B7B4AA" },
};

function MiniRun({ title, lines }: { title: string; lines: RunLine[] }) {
  return (
    <div className="m-mini-trace">
      <div className="m-mini-trace__head">
        <span style={{ fontSize: 12, fontWeight: 500, color: "var(--m-foreground)" }}>
          helix<span style={{ color: "var(--m-muted-foreground)" }}> · {title}</span>
        </span>
        <span className="m-mini-trace__live"><span className="m-mini-trace__livedot" />live</span>
      </div>
      <ul className="m-mini-trace__body">
        {lines.map((l, i) => {
          const meta = MINI_META[l.k];
          return (
            <li key={i} className="m-mini-trace__row m-reveal-line" style={{ "--i": i } as React.CSSProperties}>
              <span className="m-mini-trace__dot" style={{ background: meta.dot }} />
              <span className="m-mini-trace__label">{meta.label}</span>
              <span className="m-mini-trace__text">{l.t}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* ===== CoreCard ===== */
export function CoreCard({
  label, title, body, run,
}: {
  label: string; title: string; body: string; run: RunLine[];
}) {
  return (
    <article className="m-card" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="m-mono-sm" style={{ color: "var(--m-muted-foreground)" }}>{label}</div>
      <h3 style={{ fontSize: 22, color: "var(--m-foreground)" }}>{title}</h3>
      <p style={{ fontSize: 15.5, color: "var(--m-body)" }}>{body}</p>
      <div style={{ marginTop: 8 }}>
        <MiniRun title={label} lines={run} />
      </div>
    </article>
  );
}

/* ===== DepartmentCard ===== */
export function DepartmentCard({
  label, title, line, run,
}: {
  label: string; title: string; line: string; run: RunLine[];
}) {
  return (
    <article className="m-card m-card-hover" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <div className="m-mono-sm" style={{ color: "var(--m-muted-foreground)" }}>{label}</div>
        <div className="m-mono-sm" style={{ color: "var(--m-ember)" }}>{line}</div>
      </div>
      <h3 style={{ fontSize: 20, color: "var(--m-foreground)" }}>{title}</h3>
      <MiniRun title={label} lines={run} />
    </article>
  );
}

/* ===== SkillRunSignature (hero visual) ===== */
type SkillStep = {
  actor: "input" | "helix" | "guard" | "output";
  who: string;
  what: string;
  status: "done" | "wait" | "info";
};

const SKILL_STEPS: SkillStep[] = [
  { actor: "input",  who: "Gmail",      what: "Invoice received · Acme Corp · €1,240.00",   status: "done" },
  { actor: "helix",  who: "Knowledge",  what: "Matched booking rule · policy.pdf p.14",     status: "done" },
  { actor: "helix",  who: "Skills",     what: "Prepared booking in ledger",                 status: "done" },
  { actor: "guard",  who: "Governance", what: "Amount over €1,000 · waiting for approval",  status: "wait" },
  { actor: "helix",  who: "Skills",     what: "Approved by anna.k → posted to SAP",         status: "done" },
  { actor: "output", who: "Audit log",  what: "+1 audit_log · immutable",                   status: "info" },
];

const ACTOR_META: Record<SkillStep["actor"], { label: string; color: string }> = {
  input:  { label: "IN",      color: "#8A8880" },
  helix:  { label: "HELIX",   color: "#BE5A2C" },
  guard:  { label: "GATE",    color: "#BE5A2C" },
  output: { label: "AUDIT",   color: "#2E7D55" },
};

export function SkillRunSignature() {
  const [shown, setShown] = useState(1);
  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) { setShown(SKILL_STEPS.length); return; }
    let cancelled = false;
    let t: number | null = null;
    const tick = (i: number) => {
      if (cancelled) return;
      setShown(i);
      const gap = SKILL_STEPS[i - 1]?.status === "wait" ? 2200 : 900;
      if (i < SKILL_STEPS.length) {
        t = window.setTimeout(() => tick(i + 1), gap);
      } else {
        t = window.setTimeout(() => { if (!cancelled) { setShown(1); tick(2); } }, 3400);
      }
    };
    t = window.setTimeout(() => tick(2), 800);
    return () => { cancelled = true; if (t) clearTimeout(t); };
  }, []);

  return (
    <div className="m-skillrun">
      <div className="m-skillrun__head">
        <div className="m-skillrun__head-l">
          <span className="m-skillrun__spark" aria-hidden />
          <span className="m-skillrun__title">
            Skill run <span style={{ color: "var(--m-muted-foreground)" }}>· book_invoices</span>
          </span>
        </div>
        <span className="m-skillrun__live"><span className="m-skillrun__livedot" /> live</span>
      </div>

      <div className="m-skillrun__flow">
        <div className="m-skillrun__side">
          <div className="m-skillrun__side-label">Input</div>
          <div className="m-skillrun__chip" style={{ "--brand": "#EA4335" } as React.CSSProperties}>
            <span style={{ display: "inline-flex" }}>
              <BrandLogo slug="gmail" name="Gmail" size={20} />
            </span>
            Gmail
          </div>
        </div>

        <ol className="m-skillrun__steps">
          {SKILL_STEPS.slice(0, shown).map((s, i) => {
            const meta = ACTOR_META[s.actor];
            return (
              <li
                key={i}
                className={`m-skillrun__step m-skillrun__step--${s.status} m-reveal-line`}
                style={{ "--i": i, "--dot": meta.color } as React.CSSProperties}
              >
                <span className="m-skillrun__step-dot" />
                <span className="m-skillrun__step-actor">{meta.label} · {s.who}</span>
                <span className="m-skillrun__step-text">
                  {s.what}
                  {s.status === "wait" && <span className="m-skillrun__step-pulse" aria-hidden />}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="m-skillrun__side m-skillrun__side--out">
          <div className="m-skillrun__side-label">Output</div>
          <div className="m-skillrun__chip m-skillrun__chip--out">
            <span className="m-skillrun__chip-tick" aria-hidden>✓</span>
            Booked in SAP
          </div>
        </div>
      </div>

      <div className="m-skillrun__foot">
        <span>· grounded in your knowledge</span>
        <span>· gated where it matters</span>
        <span>· every step logged</span>
      </div>
    </div>
  );
}

/* ===== AutonomySelector ===== */
const AUTONOMY = [
  { key: "report", title: "Report", body: "helix tells you what it found." },
  { key: "suggest", title: "Suggest", body: "helix proposes the fix, you approve with one click." },
  { key: "autonomous", title: "Autonomous", body: "helix corrects on its own, within hard safety limits." },
];

export function AutonomySelector() {
  const [active, setActive] = useState(1);
  return (
    <div>
      <div style={{ display: "flex", gap: 4, borderRadius: 8, border: "1px solid var(--m-hairline)", background: "var(--m-surface)", padding: 4 }}>
        {AUTONOMY.map((a, i) => (
          <button
            key={a.key}
            onClick={() => setActive(i)}
            style={{
              flex: 1,
              borderRadius: 6,
              padding: "8px 12px",
              fontSize: 13.5,
              border: "none",
              cursor: "pointer",
              transition: "background 200ms, color 200ms",
              background: active === i ? "var(--m-foreground)" : "transparent",
              color: active === i ? "var(--m-background)" : "var(--m-body)",
            }}
          >
            {a.title}
          </button>
        ))}
      </div>
      <div style={{ marginTop: 20, borderRadius: 14, border: "1px solid var(--m-hairline)", background: "var(--m-surface)", padding: 20 }}>
        <div className="m-mono-sm" style={{ color: "var(--m-ember)", marginBottom: 8 }}>level · {AUTONOMY[active].key}</div>
        <div style={{ fontSize: 16, color: "var(--m-foreground)" }}>{AUTONOMY[active].title}</div>
        <p style={{ marginTop: 4, fontSize: 14.5, color: "var(--m-body)" }}>{AUTONOMY[active].body}</p>
      </div>
    </div>
  );
}

/* ===== LogoGrid ===== */
const LOGO_GRID = [
  { name: "Slack",      slug: "slack",             tint: "#ECB22E" },
  { name: "Zoom",       slug: "zoom",              tint: "#0B5CFF" },
  { name: "Teams",      slug: "microsoftteams",    tint: "#6264A7" },
  { name: "Gmail",      slug: "gmail",             tint: "#EA4335" },
  { name: "Outlook",    slug: "microsoftoutlook",  tint: "#0078D4" },
  { name: "Notion",     slug: "notion",            tint: "#8A8880" },
  { name: "Drive",      slug: "googledrive",       tint: "#0F9D58" },
  { name: "Calendar",   slug: "googlecalendar",    tint: "#4285F4" },
  { name: "Linear",     slug: "linear",            tint: "#5E6AD2" },
  { name: "GitHub",     slug: "github",            tint: "#8A8880" },
  { name: "HubSpot",    slug: "hubspot",           tint: "#FF7A59" },
  { name: "Salesforce", slug: "salesforce",         tint: "#00A1E0" },
];

export function LogoGrid() {
  return (
    <div style={{ marginTop: 40, display: "grid", gridTemplateColumns: "repeat(12, minmax(0, 1fr))", gap: 12 }}>
      {LOGO_GRID.map((t, i) => (
        <div
          key={t.name}
          className="m-logo-tile m-rise-stagger"
          style={{
            "--i": i,
            "--tint": t.tint,
            display: "flex",
            aspectRatio: "1 / 1",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: 16,
            border: "1px solid var(--m-hairline)",
            background: "#fff",
            position: "relative",
          } as React.CSSProperties}
          title={t.name}
          aria-label={t.name}
        >
          <span className="m-logo-tile__glow" aria-hidden />
          <BrandLogo
            slug={t.slug}
            name={t.name}
            tint={t.tint}
            size={30}
          />
        </div>
      ))}
    </div>
  );
}
