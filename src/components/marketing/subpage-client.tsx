"use client";

import { useState, type CSSProperties } from "react";
import { HelixMark } from "@/components/marketing/brand";
import { BrandLogo } from "@/components/marketing/logo";

// ---------------------------------------------------------------------------
// RunLine type — shared between AnimatedTerminal and page-level usage
// ---------------------------------------------------------------------------
export type RunLine = {
  t: string;
  k: "info" | "ok" | "wait" | "approved" | "done" | "audit";
};

// ---------------------------------------------------------------------------
// Kind -> visual mappings for the Trace rows
// ---------------------------------------------------------------------------
const KIND_META: Record<
  RunLine["k"],
  { color: string; label: string }
> = {
  info:     { color: "#85878F", label: "INFO" },
  ok:       { color: "#2E7D55", label: "OK" },
  wait:     { color: "#D6531A", label: "WAIT" },
  approved: { color: "#2E7D55", label: "APPROVED" },
  done:     { color: "#2E7D55", label: "DONE" },
  audit:    { color: "#39426B", label: "AUDIT" },
};

// ---------------------------------------------------------------------------
// AnimatedTerminal (Trace card)
// ---------------------------------------------------------------------------
export function AnimatedTerminal({
  title,
  lines,
  className = "",
}: {
  title: string;
  lines: RunLine[];
  className?: string;
}) {
  return (
    <div className={`m-trace ${className}`}>
      {/* Header */}
      <div className="m-trace__head">
        <div className="m-flex m-items-center m-gap-3">
          <span className="m-trace__mark" />
          <span className="m-trace__title">{title}</span>
        </div>
        <span className="m-trace__live">
          <span className="m-trace__livedot" />
          LIVE
        </span>
      </div>

      {/* Body rows */}
      <ul className="m-trace__body">
        {lines.map((line, i) => {
          const meta = KIND_META[line.k];
          return (
            <li
              key={i}
              className="m-trace__row m-reveal-line"
              style={{ "--i": i } as CSSProperties}
            >
              <span
                className="m-trace__icon"
                style={{ "--kind": meta.color } as CSSProperties}
              >
                <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
                  <circle cx="5" cy="5" r="4" fill={meta.color} />
                </svg>
              </span>
              <div className="m-trace__content">
                <div className="m-trace__label">{meta.label}</div>
                <div className="m-trace__text">{line.t}</div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ArchitectureDiagram
// ---------------------------------------------------------------------------
const ARCH_INPUTS = [
  { slug: "gmail",         name: "Gmail" },
  { slug: "slack",         name: "Slack" },
  { slug: "zoom",          name: "Zoom" },
  { slug: "linear",        name: "Linear" },
  { slug: "google-drive",  name: "Drive" },
];

const ARCH_CORE = [
  { title: "Knowledge", sub: "Cited RAG" },
  { title: "Skills",    sub: "Governed actions" },
  { title: "Governance",sub: "Human gating" },
  { title: "Memory",    sub: "Append-only log" },
];

const ARCH_OUTPUTS = [
  { name: "SAP",       slug: "sap" },
  { name: "Notion",    slug: "notion" },
  { name: "Audit log", slug: "" },
  { name: "Artifact",  slug: "" },
];

function ConnectorRail({ flip }: { flip?: boolean }) {
  return (
    <svg
      className="m-arch-diagram__rail"
      viewBox="0 0 60 260"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      {[0, 1, 2, 3, 4].map((i) => {
        const y = 30 + i * 45;
        return (
          <line
            key={i}
            x1={flip ? 55 : 5}
            y1={y}
            x2={flip ? 5 : 55}
            y2={130}
            stroke="var(--m-hairline)"
            strokeWidth="1"
            strokeDasharray="4 6"
            className="m-dash-flow-slow"
          />
        );
      })}
    </svg>
  );
}

export function ArchitectureDiagram() {
  return (
    <div className="m-arch-diagram m-gridpaper">
      {/* Top bar */}
      <div className="m-arch-diagram__topbar">
        <span className="m-arch-diagram__eyebrow">Architecture</span>
        <HelixMark size={18} />
      </div>

      {/* 5-column grid */}
      <div className="m-arch-diagram__grid">
        {/* Input tools */}
        <div className="m-arch-diagram__col">
          <span className="m-arch-diagram__collabel">Input</span>
          <ul className="m-arch-diagram__stack">
            {ARCH_INPUTS.map((tool) => (
              <li key={tool.name} className="m-arch-diagram__tool">
                <span className="m-arch-diagram__tool-icon">
                  <BrandLogo slug={tool.slug} name={tool.name} size={20} />
                </span>
                <span className="m-arch-diagram__tool-name">{tool.name}</span>
                <span className="m-arch-diagram__tool-arrow">&rarr;</span>
              </li>
            ))}
          </ul>
        </div>

        {/* Left rail */}
        <ConnectorRail />

        {/* Core 2x2 */}
        <div className="m-arch-diagram__col">
          <span className="m-arch-diagram__collabel m-arch-diagram__collabel--core">
            The Core
          </span>
          <div className="m-arch-diagram__core">
            {ARCH_CORE.map((block) => (
              <div key={block.title} className="m-arch-diagram__block">
                <div className="m-arch-diagram__block-title">{block.title}</div>
                <div className="m-arch-diagram__block-sub">{block.sub}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Right rail */}
        <ConnectorRail flip />

        {/* Outputs */}
        <div className="m-arch-diagram__col">
          <span
            className="m-arch-diagram__collabel"
            style={{ textAlign: "right" }}
          >
            Output
          </span>
          <ul className="m-arch-diagram__stack m-arch-diagram__stack--out">
            {ARCH_OUTPUTS.map((out) => (
              <li key={out.name} className="m-arch-diagram__out">
                <span style={{ color: "var(--m-ember)", fontWeight: 500 }}>
                  &larr;
                </span>
                {out.name}
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Loop band */}
      <div className="m-arch-diagram__loopband">
        <span className="m-arch-diagram__loopdot" />
        The Loop &mdash; observe, compare, flag, correct
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LoopDiagram
// ---------------------------------------------------------------------------
const LOOP_STATIONS = [
  { id: "run",     num: "01", name: "Run",     sub: "Execute skill",       pos: "top" },
  { id: "measure", num: "02", name: "Measure", sub: "Compare to target",   pos: "right" },
  { id: "flag",    num: "03", name: "Flag",    sub: "Surface deviation",   pos: "bottom-right" },
  { id: "suggest", num: "04", name: "Suggest", sub: "Propose correction",  pos: "bottom-left" },
  { id: "correct", num: "05", name: "Correct", sub: "Apply if approved",   pos: "left" },
] as const;

function arcPath(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const x1 = cx + r * Math.cos(toRad(startDeg));
  const y1 = cy + r * Math.sin(toRad(startDeg));
  const x2 = cx + r * Math.cos(toRad(endDeg));
  const y2 = cy + r * Math.sin(toRad(endDeg));
  const large = endDeg - startDeg > 180 ? 1 : 0;
  return `M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2}`;
}

export function LoopDiagram() {
  const cx = 230;
  const cy = 230;
  const r = 155;

  // Five arc segments connecting the stations (with gaps for markers)
  const arcs = [
    { start: -85, end: -23 },   // top -> right
    { start: -5,  end: 49 },    // right -> bottom-right
    { start: 67,  end: 121 },   // bottom-right -> bottom-left
    { start: 139, end: 193 },   // bottom-left -> left
    { start: 211, end: 265 },   // left -> top
  ];

  // Station positions around the circle (absolute within container)
  const positions: Record<string, CSSProperties> = {
    "top":          { left: "50%", top: "2%",  transform: "translate(-50%, 0)" },
    "right":        { left: "98%", top: "38%", transform: "translate(0, -50%)" },
    "bottom-right": { left: "82%", top: "92%", transform: "translate(-50%, -100%)" },
    "bottom-left":  { left: "18%", top: "92%", transform: "translate(-50%, -100%)" },
    "left":         { left: "2%",  top: "38%", transform: "translate(-100%, -50%)" },
  };

  const stationAlign: Record<string, string> = {
    "top":          "",
    "right":        "m-loop-diagram__station--right",
    "bottom-right": "",
    "bottom-left":  "",
    "left":         "m-loop-diagram__station--left",
  };

  return (
    <div className="m-loop-diagram">
      {/* SVG ring */}
      <svg
        className="m-loop-diagram__svg"
        viewBox="0 0 460 460"
        fill="none"
        aria-hidden="true"
      >
        {/* Background dashed circle */}
        <circle
          cx={cx}
          cy={cy}
          r={r}
          stroke="var(--m-hairline)"
          strokeWidth="1.5"
          strokeDasharray="6 4"
          fill="none"
        />

        {/* Animated arc segments */}
        {arcs.map((arc, i) => (
          <path
            key={i}
            d={arcPath(cx, cy, r, arc.start, arc.end)}
            stroke="var(--m-ember)"
            strokeWidth="2.5"
            fill="none"
            strokeLinecap="round"
            className="m-dash-flow"
          />
        ))}

        {/* Arrow markers at arc ends */}
        {arcs.map((arc, i) => {
          const toRad = (d: number) => (d * Math.PI) / 180;
          const ex = cx + r * Math.cos(toRad(arc.end));
          const ey = cy + r * Math.sin(toRad(arc.end));
          const angle = arc.end + 90;
          return (
            <g
              key={`arrow-${i}`}
              transform={`translate(${ex},${ey}) rotate(${angle})`}
            >
              <path
                d="M-4,-4 L0,2 L4,-4"
                stroke="var(--m-ember)"
                strokeWidth="1.5"
                fill="none"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </g>
          );
        })}
      </svg>

      {/* Center medallion */}
      <div className="m-loop-diagram__center">
        <div className="m-loop-diagram__center-halo" />
        <span className="m-loop-diagram__center-title">the loop</span>
        <span className="m-loop-diagram__center-sub">always on</span>
      </div>

      {/* Stations */}
      {LOOP_STATIONS.map((s, i) => (
        <div
          key={s.id}
          className={`m-loop-diagram__station ${stationAlign[s.pos] ?? ""}`}
          style={{
            ...positions[s.pos],
            "--i": i,
          } as CSSProperties}
        >
          <div className="m-loop-diagram__mark" />
          <div className="m-loop-diagram__label">
            <div className="m-loop-diagram__step">
              <span className="m-loop-diagram__stepnum">{s.num}</span>
              <span className="m-loop-diagram__stepname">{s.name}</span>
            </div>
            <div className="m-loop-diagram__stepsub">{s.sub}</div>
          </div>
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// AutonomySelector
// ---------------------------------------------------------------------------
const AUTONOMY_LEVELS = [
  {
    tab: "Supervised",
    body: "Every action requires human approval before execution.",
  },
  {
    tab: "Suggest",
    body: "The system proposes corrections. A human confirms or rejects.",
  },
  {
    tab: "Autonomous",
    body: "The system acts within guardrails. Humans review the audit log.",
  },
];

export function AutonomySelector() {
  const [active, setActive] = useState(0);

  return (
    <div>
      {/* Tab row */}
      <div
        className="m-flex m-gap-2"
        style={{
          padding: 4,
          borderRadius: 12,
          background: "var(--m-muted)",
          display: "inline-flex",
        }}
      >
        {AUTONOMY_LEVELS.map((level, i) => (
          <button
            key={level.tab}
            onClick={() => setActive(i)}
            className="m-mono-sm"
            style={{
              padding: "8px 16px",
              borderRadius: 8,
              border: "none",
              cursor: "pointer",
              fontWeight: 500,
              background:
                active === i ? "var(--m-foreground)" : "transparent",
              color:
                active === i
                  ? "var(--m-ember-foreground)"
                  : "var(--m-muted-foreground)",
              transition: "background 200ms ease, color 200ms ease",
            }}
          >
            {level.tab}
          </button>
        ))}
      </div>

      {/* Detail card */}
      <div className="m-card m-mt-5" style={{ maxWidth: 480 }}>
        <p className="m-text-sm" style={{ color: "var(--m-body)" }}>
          {AUTONOMY_LEVELS[active].body}
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// RAGPipeline
// ---------------------------------------------------------------------------
const RAG_STEPS = [
  { num: "01", hint: "query",    title: "Query",    sub: "Natural-language question" },
  { num: "02", hint: "embed",    title: "Embed",    sub: "Convert to vector" },
  { num: "03", hint: "retrieve", title: "Retrieve", sub: "Top-k passage search" },
  { num: "04", hint: "rerank",   title: "Rerank",   sub: "Cross-encoder scoring" },
  { num: "05", hint: "compose",  title: "Compose",  sub: "Assemble cited answer" },
  { num: "06", hint: "cite",     title: "Cite",     sub: "Inline source references" },
];

export function RAGPipeline() {
  return (
    <div className="m-rag__flow">
      {RAG_STEPS.map((step, i) => (
        <div
          key={step.num}
          className="m-rag__step"
          style={{ "--i": i } as CSSProperties}
        >
          <span className="m-rag__num">{step.num}</span>
          <div className="m-rag__card">
            <div className="m-rag__hint">{step.hint}</div>
            <div className="m-rag__title">{step.title}</div>
            <div className="m-rag__sub">{step.sub}</div>
          </div>
          {/* Dashed connector between cards (not on last) */}
          {i < RAG_STEPS.length - 1 && <span className="m-rag__connector" />}
        </div>
      ))}
    </div>
  );
}
