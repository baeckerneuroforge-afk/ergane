"use client";

import { useState } from "react";

/* -------------------------------------------------------------------------- */
/*  BrandLogo — renders a brand icon with a fallback chain:                   */
/*    1. svgl.app CDN                                                         */
/*    2. jsdelivr (simple-icons)                                              */
/*    3. simpleicons.org                                                      */
/*    4. text initial                                                         */
/* -------------------------------------------------------------------------- */

const SVGL = (slug: string) =>
  `https://svgl.app/library/${slug}.svg`;
const JSDELIVR = (slug: string) =>
  `https://cdn.jsdelivr.net/npm/simple-icons@v11/icons/${slug}.svg`;
const SIMPLE = (slug: string) =>
  `https://simpleicons.org/icons/${slug}.svg`;

export interface BrandLogoProps {
  /** slug used to resolve the SVG icon (e.g. "slack", "google-drive") */
  slug?: string;
  /** @deprecated use `slug` */
  brand?: string;
  /** human-readable label for alt text and fallback initial */
  name?: string;
  /** pixel size of the rendered icon */
  size?: number;
  /** optional brand color shown on hover glow */
  tint?: string;
  className?: string;
}

export function BrandLogo({
  slug: slugProp,
  brand,
  name: nameProp,
  size = 28,
  tint,
  className = "",
}: BrandLogoProps) {
  // `brand` is a legacy alias for `slug`
  const slug = slugProp ?? brand ?? "unknown";
  const name = nameProp ?? slug;
  const [src, setSrc] = useState<string | null>(SVGL(slug));
  const [fallbackLevel, setFallbackLevel] = useState(0);

  const handleError = () => {
    if (fallbackLevel === 0) {
      setSrc(JSDELIVR(slug));
      setFallbackLevel(1);
    } else if (fallbackLevel === 1) {
      setSrc(SIMPLE(slug));
      setFallbackLevel(2);
    } else {
      // All image sources exhausted — show text initial
      setSrc(null);
      setFallbackLevel(3);
    }
  };

  if (src === null) {
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
          background: tint
            ? `color-mix(in oklab, ${tint} 15%, var(--m-muted, #F4F3EE))`
            : "var(--m-muted, #F4F3EE)",
          color: tint || "var(--m-foreground, #17181C)",
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
      src={src}
      alt={name}
      width={size}
      height={size}
      className={className}
      onError={handleError}
      style={{ display: "block", objectFit: "contain" }}
    />
  );
}
