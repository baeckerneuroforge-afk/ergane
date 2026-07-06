import Link from "next/link";
import {
  HelixWordmark,
  HelixBand,
  HelixOrbit,
  DNAStrand,
  Rung,
} from "@/components/marketing/brand";
import { TopNav } from "@/components/marketing/nav";

/* ========================================================================== */
/*  PageShell — wraps TopNav + main content + Footer with decorative strands  */
/* ========================================================================== */

export function PageShell({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`m-flex-col m-min-h-screen ${className}`} style={{ position: "relative" }}>
      {/* Decorative DNA strands */}
      <div
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          width: 60,
          height: "100%",
          pointerEvents: "none",
          zIndex: 0,
        }}
        aria-hidden="true"
      >
        <DNAStrand
          variant="vertical"
          tone="light"
          className=""
        />
      </div>
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          width: 60,
          height: "100%",
          pointerEvents: "none",
          zIndex: 0,
        }}
        aria-hidden="true"
      >
        <DNAStrand
          variant="vertical"
          tone="light"
          className=""
        />
      </div>

      <TopNav />
      <main style={{ flex: 1, position: "relative", zIndex: 1 }}>
        {children}
      </main>
      <Footer />
    </div>
  );
}

/* ========================================================================== */
/*  Section — reusable section wrapper                                        */
/* ========================================================================== */

export function Section({
  children,
  className = "",
  id,
  bg,
  border,
}: {
  children: React.ReactNode;
  className?: string;
  id?: string;
  bg?: "background" | "surface" | "muted" | "ink";
  border?: "top" | "bottom" | "both";
}) {
  const bgClass = bg ? `m-bg-${bg}` : "";
  const borderClasses = [
    border === "top" || border === "both" ? "m-hairline-t" : "",
    border === "bottom" || border === "both" ? "m-hairline-b" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <section
      id={id}
      className={`m-section ${bgClass} ${borderClasses} ${className}`}
    >
      <div className="m-section-inner">{children}</div>
    </section>
  );
}

/* ========================================================================== */
/*  Eyebrow — mono uppercase label                                           */
/* ========================================================================== */

export function Eyebrow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <div className={`m-eyebrow ${className}`}>{children}</div>;
}

/* ========================================================================== */
/*  Badge — status badge                                                     */
/* ========================================================================== */

export function Badge({
  children,
  variant = "default",
  className = "",
}: {
  children: React.ReactNode;
  variant?: "default" | "ember" | "green" | "steel";
  className?: string;
}) {
  const variantStyles: Record<string, React.CSSProperties> = {
    default: {
      background: "var(--m-muted)",
      color: "var(--m-muted-foreground)",
      border: "1px solid var(--m-hairline)",
    },
    ember: {
      background:
        "color-mix(in oklab, var(--m-ember) 10%, var(--m-surface))",
      color: "var(--m-ember)",
      border:
        "1px solid color-mix(in oklab, var(--m-ember) 25%, var(--m-hairline))",
    },
    green: {
      background:
        "color-mix(in oklab, var(--m-green) 10%, var(--m-surface))",
      color: "var(--m-green)",
      border:
        "1px solid color-mix(in oklab, var(--m-green) 25%, var(--m-hairline))",
    },
    steel: {
      background:
        "color-mix(in oklab, var(--m-steel) 10%, var(--m-surface))",
      color: "var(--m-steel)",
      border:
        "1px solid color-mix(in oklab, var(--m-steel) 25%, var(--m-hairline))",
    },
  };

  return (
    <span
      className={`m-mono-sm ${className}`}
      style={{
        display: "inline-flex",
        alignItems: "center",
        padding: "3px 10px",
        borderRadius: 999,
        fontSize: 11,
        letterSpacing: "0.06em",
        fontWeight: 500,
        lineHeight: 1.4,
        ...variantStyles[variant],
      }}
    >
      {children}
    </span>
  );
}

/* ========================================================================== */
/*  ImgFrame — framed image with optional tint filter                        */
/* ========================================================================== */

export function ImgFrame({
  src,
  alt = "",
  tinted = true,
  className = "",
}: {
  src: string;
  alt?: string;
  tinted?: boolean;
  className?: string;
}) {
  return (
    <div className={`m-img-frame ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        style={{ width: "100%", display: "block" }}
        className={tinted ? "m-img-tinted" : ""}
      />
    </div>
  );
}

/* ========================================================================== */
/*  CtaBand — CTA section with optional atmospheric image background         */
/* ========================================================================== */

export function CtaBand({
  title,
  line,
  subtitle = "Request a structured pilot. Start in weeks, not months.",
  cta = "Request a pilot",
  href = "/pilot/request",
  img,
  className = "",
}: {
  title?: string;
  /** @deprecated use `title` */
  line?: string;
  subtitle?: string;
  cta?: string;
  href?: string;
  img?: string;
  className?: string;
}) {
  // `line` is a legacy alias for `title`
  title = title ?? line ?? "See helix in action.";
  if (img) {
    return (
      <section className={`m-image-band ${className}`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={img} alt="" className="m-image-band__img m-img-tinted" />
        <div className="m-image-band__overlay" />
        <div
          className="m-image-band-inner"
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            gap: 32,
          }}
        >
          <div style={{ position: "relative" }}>
            <h2 style={{ color: "#E8E8EC" }}>{title}</h2>
            {subtitle && (
              <p
                className="m-mt-3"
                style={{ fontSize: 16, color: "rgba(232,232,236,0.7)" }}
              >
                {subtitle}
              </p>
            )}
          </div>
          <Link href={href} className="m-btn-primary" style={{ flexShrink: 0 }}>
            {cta}
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className={`m-cta-band ${className}`}>
      {/* Decorative orbit */}
      <div
        style={{
          position: "absolute",
          right: -60,
          top: "50%",
          transform: "translateY(-50%)",
          pointerEvents: "none",
        }}
        aria-hidden="true"
      >
        <HelixOrbit size={320} />
      </div>

      <div className="m-cta-band-inner">
        <div style={{ maxWidth: 520 }}>
          <h2>{title}</h2>
          {subtitle && (
            <p className="m-mt-4" style={{ fontSize: 17 }}>
              {subtitle}
            </p>
          )}
        </div>
        <Link href={href} className="m-btn-primary">
          {cta}
        </Link>
      </div>
    </section>
  );
}

/* ========================================================================== */
/*  ImageBand — atmospheric image band                                       */
/* ========================================================================== */

export function ImageBand({
  src,
  alt = "",
  children,
  className = "",
}: {
  src: string;
  alt?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`m-image-band ${className}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="m-image-band__img m-img-tinted" />
      <div className="m-image-band__overlay" />
      <div className="m-image-band-inner">
        {children}
      </div>
    </section>
  );
}

/* ========================================================================== */
/*  Footer                                                                    */
/* ========================================================================== */

const FOOTER_LINKS = {
  Product: [
    { label: "Knowledge", href: "/product/knowledge" },
    { label: "Skills", href: "/product/skills" },
    { label: "Governance", href: "/product/governance" },
    { label: "Memory", href: "/product/memory" },
    { label: "The Loop", href: "/product/loop" },
    { label: "Integrations", href: "/product/integrations" },
  ],
  Company: [
    { label: "Security", href: "/security/data-hosting" },
    { label: "Pilot", href: "/pilot" },
    { label: "DPA", href: "/dpa" },
    { label: "Privacy", href: "/privacy" },
    { label: "Imprint", href: "/imprint" },
  ],
};

export function Footer({ className = "" }: { className?: string }) {
  return (
    <footer className={`m-footer ${className}`}>
      <div style={{ overflow: "hidden" }}>
        <HelixBand />
      </div>
      <div className="m-footer-inner">
        <div className="m-footer-grid">
          {/* Brand column */}
          <div>
            <HelixWordmark />
            <p
              className="m-mt-5"
              style={{
                fontSize: 14,
                color: "var(--m-muted-foreground)",
                maxWidth: 320,
                lineHeight: 1.6,
              }}
            >
              The operating DNA of your company. Two strands:
              what your company knows, and what it does with it.
            </p>
            <div className="m-mt-6">
              <Rung />
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(FOOTER_LINKS).map(([heading, links]) => (
            <div key={heading}>
              <div className="m-eyebrow" style={{ marginBottom: 16 }}>
                {heading}
              </div>
              <div className="m-flex-col m-gap-2">
                {links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    className="m-text-sm m-text-muted-foreground m-transition-colors m-hover-text-foreground"
                    style={{ padding: "4px 0" }}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="m-footer-bottom">
          <span
            className="m-mono-sm m-text-muted-foreground"
          >
            &copy; {new Date().getFullYear()} helix.ai
          </span>
          <div className="m-flex m-gap-4">
            <Link
              href="/dpa"
              className="m-mono-sm m-text-muted-foreground m-transition-colors m-hover-text-foreground"
            >
              DPA
            </Link>
            <Link
              href="/privacy"
              className="m-mono-sm m-text-muted-foreground m-transition-colors m-hover-text-foreground"
            >
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}
