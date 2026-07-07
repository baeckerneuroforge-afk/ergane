"use client";

import { useState } from "react";

/**
 * BrandLogo — real full-color product logos.
 * Chain of fallbacks so each brand shows its true mark:
 *   1) explicit `src` if provided
 *   2) gilbarbara/logos via jsdelivr (multicolor)
 *   3) svgl.app (multicolor, high fidelity)
 *   4) simpleicons.org in brand hex
 *   5) text initial
 */

/** Known brands so legacy `slug`-only callers still get multicolor marks. */
const KNOWN: Record<
  string,
  { gilbarbara?: string; svgl?: string; simpleicons?: string; color?: string; src?: string }
> = {
  slack:              { gilbarbara: "slack-icon",       simpleicons: "slack",            color: "611F69" },
  zoom:               { gilbarbara: "zoom-icon",        simpleicons: "zoom",             color: "0B5CFF" },
  "microsoft-teams":  { gilbarbara: "microsoft-teams",  simpleicons: "microsoftteams",   color: "6264A7" },
  microsoftteams:     { gilbarbara: "microsoft-teams",  simpleicons: "microsoftteams",   color: "6264A7" },
  intercom:           { gilbarbara: "intercom-icon",    simpleicons: "intercom",         color: "1F8DED" },
  gmail:              { gilbarbara: "google-gmail",     simpleicons: "gmail",            color: "EA4335" },
  "microsoft-outlook":{ svgl: "microsoft-outlook",      simpleicons: "microsoftoutlook", color: "0078D4" },
  microsoftoutlook:   { svgl: "microsoft-outlook",      simpleicons: "microsoftoutlook", color: "0078D4" },
  notion:             { gilbarbara: "notion-icon",      simpleicons: "notion",           color: "111111" },
  "google-drive":     { gilbarbara: "google-drive",     simpleicons: "googledrive",      color: "4285F4" },
  googledrive:        { gilbarbara: "google-drive",     simpleicons: "googledrive",      color: "4285F4" },
  "google-calendar":  { gilbarbara: "google-calendar",  simpleicons: "googlecalendar",   color: "4285F4" },
  googlecalendar:     { gilbarbara: "google-calendar",  simpleicons: "googlecalendar",   color: "4285F4" },
  confluence:         { gilbarbara: "confluence",       simpleicons: "confluence",       color: "172B4D" },
  linear:             { gilbarbara: "linear-icon",      simpleicons: "linear",           color: "5E6AD2" },
  github:             { gilbarbara: "github-icon",      simpleicons: "github",           color: "181717" },
  jira:               { gilbarbara: "jira",             simpleicons: "jira",             color: "0052CC" },
  hubspot:            { src: "https://cdn.simpleicons.org/hubspot/FF7A59", simpleicons: "hubspot", color: "FF7A59" },
  powerpoint:         { svgl: "microsoft-powerpoint",                      color: "D24726" },
  "microsoft-powerpoint": { svgl: "microsoft-powerpoint",                  color: "D24726" },
  salesforce:         { gilbarbara: "salesforce",       simpleicons: "salesforce",       color: "00A1E0" },
  sap:                { gilbarbara: "sap",              simpleicons: "sap",              color: "0FAAFF" },
};

export interface BrandLogoProps {
  name: string;
  size?: number;
  /** slug on gilbarbara/logos (e.g. "slack-icon") */
  gilbarbara?: string;
  /** slug on svgl.app (e.g. "microsoft-outlook") */
  svgl?: string;
  /** slug on simpleicons.org (e.g. "slack") */
  simpleicons?: string;
  /** hex without '#' for the simpleicons fallback tint */
  fallbackColor?: string;
  /** override with an absolute URL */
  src?: string;
  /** legacy: single slug — resolved against known brands */
  slug?: string;
  /** legacy alias for `slug` */
  brand?: string;
  /** legacy: brand color shown in the text-initial fallback */
  tint?: string;
  className?: string;
}

export function BrandLogo({
  name,
  size = 32,
  gilbarbara,
  svgl,
  simpleicons,
  fallbackColor,
  src,
  slug,
  brand,
  tint,
  className = "",
}: BrandLogoProps) {
  const known = KNOWN[(slug ?? brand ?? name).toLowerCase()] ?? {};
  const g = gilbarbara ?? known.gilbarbara;
  const v = svgl ?? known.svgl;
  const s = simpleicons ?? known.simpleicons ?? slug ?? brand;
  const color = fallbackColor ?? known.color ?? (tint ? tint.replace("#", "") : undefined);
  const override = src ?? known.src;

  const chain: string[] = [];
  if (override) chain.push(override);
  if (g) chain.push(`https://cdn.jsdelivr.net/gh/gilbarbara/logos/logos/${g}.svg`);
  if (v) chain.push(`https://svgl.app/library/${v}.svg`);
  if (s) {
    chain.push(
      color
        ? `https://cdn.simpleicons.org/${s}/${color}`
        : `https://cdn.simpleicons.org/${s}`,
    );
  }

  const [idx, setIdx] = useState(0);
  const url = chain[idx];

  if (!url) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: size,
          height: size,
          borderRadius: 6,
          background: color
            ? `color-mix(in oklab, #${color} 15%, var(--m-muted, #F4F3EE))`
            : "var(--m-muted, #F4F3EE)",
          color: color ? `#${color}` : "var(--m-foreground, #17181C)",
          fontSize: size * 0.45,
          fontWeight: 600,
          letterSpacing: "-0.02em",
          lineHeight: 1,
        }}
        aria-label={name}
      >
        {name.charAt(0).toUpperCase()}
      </span>
    );
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={`${name} logo`}
      width={size}
      height={size}
      loading="lazy"
      onError={() => setIdx((i) => Math.min(i + 1, chain.length))}
      className={`m-logo-tile__icon ${className}`}
      style={{ width: size, height: size, objectFit: "contain", display: "block" }}
    />
  );
}
