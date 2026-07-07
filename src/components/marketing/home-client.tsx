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

/* ===== SkillRunShowcase (hero visual) ===== */
/* One card, several runs: each scenario is a different tool train through the
   same operating system — input tool → knowledge/memory/skills/gate → output tool. */
type SkillStep = {
  actor: "input" | "helix" | "guard" | "output";
  who: string;
  what: string;
  status: "done" | "wait" | "info";
};

type LogoSpec = {
  gilbarbara?: string;
  svgl?: string;
  simpleicons?: string;
  src?: string;
  fallbackColor: string;
};

type SkillScenario = {
  key: string;
  input: { name: string; logo: LogoSpec };
  output: { label: string; name: string; logo: LogoSpec };
  steps: SkillStep[];
};

const SCENARIOS: SkillScenario[] = [
  {
    key: "book_invoices",
    input: {
      name: "Gmail",
      logo: { gilbarbara: "google-gmail", simpleicons: "gmail", fallbackColor: "EA4335" },
    },
    output: {
      label: "Booked in SAP",
      name: "SAP",
      logo: { gilbarbara: "sap", simpleicons: "sap", fallbackColor: "0FAAFF" },
    },
    steps: [
      { actor: "input",  who: "Gmail",      what: "Invoice received · Acme Corp · €1,240.00",   status: "done" },
      { actor: "helix",  who: "Knowledge",  what: "Matched booking rule · policy.pdf p.14",     status: "done" },
      { actor: "helix",  who: "Skills",     what: "Prepared booking in ledger",                 status: "done" },
      { actor: "guard",  who: "Governance", what: "Amount over €1,000 · waiting for approval",  status: "wait" },
      { actor: "helix",  who: "Skills",     what: "Approved by anna.k → posted to SAP",         status: "done" },
      { actor: "output", who: "Audit log",  what: "+1 audit_log · immutable",                   status: "info" },
    ],
  },
  {
    key: "call_to_deck",
    input: {
      name: "Zoom",
      logo: { gilbarbara: "zoom-icon", simpleicons: "zoom", fallbackColor: "0B5CFF" },
    },
    output: {
      label: "Deck in PowerPoint",
      name: "PowerPoint",
      logo: { svgl: "microsoft-powerpoint", fallbackColor: "D24726" },
    },
    steps: [
      { actor: "input",  who: "Zoom",       what: "Discovery call ended · Nordwind GmbH · 47 min", status: "done" },
      { actor: "helix",  who: "Knowledge",  what: "Matched template · discovery-deck v3",          status: "done" },
      { actor: "helix",  who: "Memory",     what: "Recalled · wants EU hosting, Q3 rollout",       status: "done" },
      { actor: "helix",  who: "Skills",     what: "Drafted 12-slide framework from transcript",    status: "done" },
      { actor: "guard",  who: "Governance", what: "External deliverable · waiting for review",     status: "wait" },
      { actor: "helix",  who: "Skills",     what: "Approved by jonas.m → deck exported",           status: "done" },
      { actor: "output", who: "Audit log",  what: "+1 audit_log · immutable",                      status: "info" },
    ],
  },
  {
    key: "answer_ticket",
    input: {
      name: "Slack",
      logo: { gilbarbara: "slack-icon", simpleicons: "slack", fallbackColor: "611F69" },
    },
    output: {
      label: "Answered in Slack",
      name: "Slack",
      logo: { gilbarbara: "slack-icon", simpleicons: "slack", fallbackColor: "611F69" },
    },
    steps: [
      { actor: "input",  who: "Slack",      what: "Question in #support · “Does Pro include SSO?”", status: "done" },
      { actor: "helix",  who: "Knowledge",  what: "Retrieved · pricing.md + sso-guide p.2",         status: "done" },
      { actor: "helix",  who: "Skills",     what: "Drafted answer · 2 sources cited",               status: "done" },
      { actor: "guard",  who: "Governance", what: "Low-risk reply · passed by policy",              status: "done" },
      { actor: "helix",  who: "Skills",     what: "Posted in thread · 41 s end to end",             status: "done" },
      { actor: "output", who: "Audit log",  what: "+1 audit_log · immutable",                       status: "info" },
    ],
  },
  {
    key: "draft_proposal",
    input: {
      name: "HubSpot",
      logo: { src: "https://cdn.simpleicons.org/hubspot/FF7A59", simpleicons: "hubspot", fallbackColor: "FF7A59" },
    },
    output: {
      label: "Proposal in Notion",
      name: "Notion",
      logo: { gilbarbara: "notion-icon", simpleicons: "notion", fallbackColor: "111111" },
    },
    steps: [
      { actor: "input",  who: "HubSpot",    what: "Deal moved to “Proposal” · Müller AG · €48k",  status: "done" },
      { actor: "helix",  who: "Memory",     what: "Recalled · pilot terms + open questions",      status: "done" },
      { actor: "helix",  who: "Knowledge",  what: "Pulled template · sales playbook p.8",         status: "done" },
      { actor: "helix",  who: "Skills",     what: "Drafted proposal · scope + pricing",           status: "done" },
      { actor: "guard",  who: "Governance", what: "Discount 12% > policy 10% · waiting",          status: "wait" },
      { actor: "helix",  who: "Skills",     what: "Approved by sara.b → doc created",             status: "done" },
      { actor: "output", who: "Audit log",  what: "+1 audit_log · immutable",                     status: "info" },
    ],
  },
];

const ACTOR_META: Record<SkillStep["actor"], { label: string; color: string }> = {
  input:  { label: "IN",      color: "#8A8880" },
  helix:  { label: "HELIX",   color: "#BE5A2C" },
  guard:  { label: "GATE",    color: "#BE5A2C" },
  output: { label: "AUDIT",   color: "#2E7D55" },
};

function ScenarioLogo({ spec, name, size = 20 }: { spec: LogoSpec; name: string; size?: number }) {
  return (
    <span style={{ display: "inline-flex" }}>
      <BrandLogo
        name={name}
        gilbarbara={spec.gilbarbara}
        svgl={spec.svgl}
        simpleicons={spec.simpleicons}
        src={spec.src}
        fallbackColor={spec.fallbackColor}
        size={size}
      />
    </span>
  );
}

export function SkillRunShowcase() {
  const [scenario, setScenario] = useState(0);
  const [shown, setShown] = useState(1);
  const sc = SCENARIOS[scenario];
  const complete = shown >= sc.steps.length;

  const go = (i: number) => {
    setScenario(i);
    setShown(1);
  };

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const steps = SCENARIOS[scenario].steps;
    if (reduced) { setShown(steps.length); return; }
    let cancelled = false;
    let t: number | null = null;
    const tick = (i: number) => {
      if (cancelled) return;
      setShown(i);
      if (i < steps.length) {
        const gap = steps[i - 1]?.status === "wait" ? 2200 : 900;
        t = window.setTimeout(() => tick(i + 1), gap);
      } else {
        t = window.setTimeout(() => {
          if (cancelled) return;
          setScenario((s) => (s + 1) % SCENARIOS.length);
          setShown(1);
        }, 3600);
      }
    };
    t = window.setTimeout(() => tick(2), 800);
    return () => { cancelled = true; if (t) clearTimeout(t); };
  }, [scenario]);

  return (
    <div className="m-skillrun">
      <div className="m-skillrun__head">
        <div className="m-skillrun__head-l">
          <span className="m-skillrun__spark" aria-hidden />
          <span className="m-skillrun__title">
            Skill run <span style={{ color: "var(--m-muted-foreground)" }}>· {sc.key}</span>
          </span>
        </div>
        <span className="m-skillrun__live"><span className="m-skillrun__livedot" /> live</span>
      </div>

      <div className="m-skillrun__tabs" role="tablist" aria-label="Skill run scenarios">
        {SCENARIOS.map((s, i) => (
          <button
            key={s.key}
            role="tab"
            aria-selected={i === scenario}
            className={`m-mono-sm m-skillrun__tab${i === scenario ? " m-skillrun__tab--active" : ""}`}
            onClick={() => go(i)}
          >
            {s.key}
          </button>
        ))}
      </div>

      <div className="m-skillrun__flow">
        <div className="m-skillrun__side">
          <div className="m-skillrun__side-label">Input</div>
          <div
            key={sc.key}
            className="m-skillrun__chip m-rise-in"
            style={{ "--brand": `#${sc.input.logo.fallbackColor}` } as React.CSSProperties}
          >
            <ScenarioLogo spec={sc.input.logo} name={sc.input.name} />
            {sc.input.name}
          </div>
        </div>

        <ol className="m-skillrun__steps">
          {sc.steps.slice(0, shown).map((s, i) => {
            const meta = ACTOR_META[s.actor];
            return (
              <li
                key={`${sc.key}-${i}`}
                className={`m-skillrun__step m-skillrun__step--${s.status} m-reveal-line`}
                style={{ "--i": i, "--dot": meta.color } as React.CSSProperties}
              >
                <span className="m-skillrun__step-dot" />
                <span className="m-skillrun__step-actor">{meta.label} · {s.who}</span>
                <span className="m-skillrun__step-text">
                  {s.what}
                  {s.status === "wait" && i === shown - 1 && (
                    <span className="m-skillrun__step-pulse" aria-hidden />
                  )}
                </span>
              </li>
            );
          })}
        </ol>

        <div className="m-skillrun__side m-skillrun__side--out">
          <div className="m-skillrun__side-label">Output</div>
          <div
            key={sc.key}
            className="m-skillrun__chip m-skillrun__chip--out m-rise-in"
            style={{ opacity: complete ? 1 : 0.45, transition: "opacity 500ms ease" }}
          >
            <ScenarioLogo spec={sc.output.logo} name={sc.output.name} size={18} />
            {sc.output.label}
            <span
              className="m-skillrun__chip-tick"
              style={{ opacity: complete ? 1 : 0, transition: "opacity 400ms ease" }}
              aria-hidden
            >
              ✓
            </span>
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

/** @deprecated use SkillRunShowcase */
export const SkillRunSignature = SkillRunShowcase;

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
  { name: "Slack",      gilbarbara: "slack-icon",      color: "611F69", tint: "ECB22E", simpleicons: "slack" },
  { name: "Zoom",       gilbarbara: "zoom-icon",       color: "0B5CFF", tint: "0B5CFF", simpleicons: "zoom" },
  { name: "Teams",      gilbarbara: "microsoft-teams", color: "6264A7", tint: "6264A7", simpleicons: "microsoftteams" },
  { name: "Gmail",      gilbarbara: "google-gmail",    color: "EA4335", tint: "EA4335", simpleicons: "gmail" },
  { name: "Outlook",    svgl: "microsoft-outlook",     color: "0078D4", tint: "0078D4", simpleicons: "microsoftoutlook" },
  { name: "Notion",     gilbarbara: "notion-icon",     color: "111111", tint: "8A8880", simpleicons: "notion" },
  { name: "Drive",      gilbarbara: "google-drive",    color: "4285F4", tint: "0F9D58", simpleicons: "googledrive" },
  { name: "Calendar",   gilbarbara: "google-calendar", color: "4285F4", tint: "4285F4", simpleicons: "googlecalendar" },
  { name: "Linear",     gilbarbara: "linear-icon",     color: "5E6AD2", tint: "5E6AD2", simpleicons: "linear" },
  { name: "GitHub",     gilbarbara: "github-icon",     color: "181717", tint: "8A8880", simpleicons: "github" },
  { name: "HubSpot",    src: "https://cdn.simpleicons.org/hubspot/FF7A59", color: "FF7A59", tint: "FF7A59", simpleicons: "hubspot" },
  { name: "Salesforce", gilbarbara: "salesforce",      color: "00A1E0", tint: "00A1E0", simpleicons: "salesforce" },
] as const;

export function LogoGrid() {
  return (
    <div
      style={{
        marginTop: 40,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(72px, 1fr))",
        gap: 12,
      }}
    >
      {LOGO_GRID.map((t, i) => (
        <div
          key={t.name}
          className="m-logo-tile m-rise-stagger"
          style={{
            "--i": i,
            "--brand": `#${t.color}`,
            "--tint": `#${t.tint}`,
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
            name={t.name}
            gilbarbara={"gilbarbara" in t ? t.gilbarbara : undefined}
            svgl={"svgl" in t ? t.svgl : undefined}
            src={"src" in t ? t.src : undefined}
            simpleicons={t.simpleicons}
            fallbackColor={t.color}
            size={30}
          />
        </div>
      ))}
    </div>
  );
}

/* ===== HomeArchitectureDiagram — HTML+CSS grid with real product logos ===== */
const INPUT_TOOLS = [
  { name: "Gmail",  gilbarbara: "google-gmail", color: "EA4335", tint: "EA4335" },
  { name: "Zoom",   gilbarbara: "zoom-icon",    color: "0B5CFF", tint: "0B5CFF" },
  { name: "Slack",  gilbarbara: "slack-icon",   color: "611F69", tint: "ECB22E" },
  { name: "Notion", gilbarbara: "notion-icon",  color: "111111", tint: "8A8880" },
  { name: "Linear", gilbarbara: "linear-icon",  color: "5E6AD2", tint: "5E6AD2" },
  { name: "GitHub", gilbarbara: "github-icon",  color: "181717", tint: "8A8880" },
];

const CORE_BLOCKS = [
  { t: "Knowledge",  d: "grounded, cited" },
  { t: "Skills",     d: "agents that act" },
  { t: "Governance", d: "gates & audit" },
  { t: "Memory",     d: "per customer" },
];

const ARCH_OUTPUTS = ["Deliverables", "Flags & alerts", "Actions in your tools"];

export function HomeArchitectureDiagram() {
  return (
    <div className="m-arch-diagram">
      <div className="m-arch-diagram__topbar">
        <span className="m-arch-diagram__eyebrow">
          architecture · input → core → output
        </span>
        <span className="m-arch-diagram__eyebrow">v1 · always-on loop</span>
      </div>

      <div className="m-arch-diagram__grid">
        {/* INPUT column */}
        <div className="m-arch-diagram__col">
          <div className="m-arch-diagram__collabel">Input</div>
          <ul className="m-arch-diagram__stack">
            {INPUT_TOOLS.map((t, i) => (
              <li
                key={t.name}
                className="m-arch-diagram__tool m-rise-stagger"
                style={{
                  "--i": i,
                  "--brand": `#${t.color}`,
                  "--tint": `#${t.tint}`,
                } as React.CSSProperties}
              >
                <span className="m-arch-diagram__tool-icon">
                  <BrandLogo
                    name={t.name}
                    gilbarbara={t.gilbarbara}
                    simpleicons={t.name.toLowerCase().replace(/ /g, "")}
                    fallbackColor={t.color}
                    size={22}
                  />
                </span>
                <span className="m-arch-diagram__tool-name">{t.name}</span>
                <span className="m-arch-diagram__tool-arrow" aria-hidden>→</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Connector rail: input → core */}
        <svg
          className="m-arch-diagram__rail"
          viewBox="0 0 120 400"
          preserveAspectRatio="none"
          aria-hidden
        >
          {INPUT_TOOLS.map((_, i) => {
            const y = 30 + i * 58;
            return (
              <path
                key={i}
                d={`M 0 ${y} C 60 ${y}, 60 200, 120 200`}
                fill="none"
                stroke="#171310"
                strokeOpacity="0.28"
                strokeWidth="1.2"
                className="m-dash-flow-slow"
                strokeDasharray="3 5"
              />
            );
          })}
        </svg>

        {/* CORE column */}
        <div className="m-arch-diagram__col m-arch-diagram__col--core">
          <div className="m-arch-diagram__collabel m-arch-diagram__collabel--core">
            helix · core
          </div>
          <div className="m-arch-diagram__core">
            {CORE_BLOCKS.map((b, i) => (
              <div
                key={b.t}
                className="m-arch-diagram__block m-rise-stagger"
                style={{ "--i": i } as React.CSSProperties}
              >
                <div className="m-arch-diagram__block-title">{b.t}</div>
                <div className="m-arch-diagram__block-sub">{b.d}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Connector rail: core → output */}
        <svg
          className="m-arch-diagram__rail"
          viewBox="0 0 120 400"
          preserveAspectRatio="none"
          aria-hidden
        >
          {ARCH_OUTPUTS.map((_, i) => {
            const y = 90 + i * 100;
            return (
              <path
                key={i}
                d={`M 0 200 C 60 200, 60 ${y}, 120 ${y}`}
                fill="none"
                stroke="#BE5A2C"
                strokeOpacity="0.7"
                strokeWidth="1.4"
                className="m-dash-flow"
                strokeDasharray="4 4"
              />
            );
          })}
        </svg>

        {/* OUTPUT column */}
        <div className="m-arch-diagram__col">
          <div className="m-arch-diagram__collabel">Output</div>
          <ul className="m-arch-diagram__stack m-arch-diagram__stack--out">
            {ARCH_OUTPUTS.map((n, i) => (
              <li
                key={n}
                className="m-arch-diagram__out m-rise-stagger"
                style={{ "--i": i + 3 } as React.CSSProperties}
              >
                <span
                  className="m-arch-diagram__tool-arrow"
                  style={{ color: "var(--m-ember)" }}
                  aria-hidden
                >
                  →
                </span>
                <span className="m-arch-diagram__tool-name">{n}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="m-arch-diagram__loopband">
        <span className="m-arch-diagram__loopdot" />
        <span>The loop · observe · compare · flag · correct</span>
      </div>
    </div>
  );
}
