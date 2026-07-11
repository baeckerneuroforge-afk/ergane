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
    <div
      className={className}
      style={{
        position: "relative",
        minHeight: "100vh",
        overflow: "hidden",
        background: "var(--m-background)",
        color: "var(--m-body)",
      }}
    >
      {/* Site-wide DNA strands — extremely subtle, non-interactive */}
      <DNAStrand
        className="m-pointer-events-none"
        style={{
          position: "fixed",
          right: 0,
          top: 0,
          zIndex: 0,
          height: "100vh",
          width: 280,
          opacity: 0.07,
        }}
      />
      <DNAStrand
        variant="diagonal"
        className="m-pointer-events-none"
        style={{
          position: "fixed",
          left: -64,
          top: 0,
          zIndex: 0,
          height: "100vh",
          width: 280,
          opacity: 0.05,
        }}
      />
      <div
        className="m-pointer-events-none m-lg-only"
        style={{
          position: "fixed",
          left: "50%",
          top: "38vh",
          zIndex: 0,
          transform: "translateX(-50%)",
          opacity: 0.035,
        }}
        aria-hidden="true"
      >
        <HelixOrbit size={520} />
      </div>
      <div
        className="m-pointer-events-none m-lg-only"
        style={{
          position: "fixed",
          right: "6vw",
          bottom: "8vh",
          zIndex: 0,
          opacity: 0.05,
        }}
        aria-hidden="true"
      >
        <HelixOrbit size={260} />
      </div>

      <div style={{ position: "relative", zIndex: 10 }}>
        <TopNav />
        <main>{children}</main>
        <Footer />
      </div>
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
/*  CtaBand — atmospheric image band + closing CTA with helix orbits         */
/* ========================================================================== */

export function CtaBand({
  title,
  line,
  cta = "Request a pilot →",
  href = "/pilot",
  className = "",
}: {
  title?: string;
  line?: string;
  cta?: string;
  href?: string;
  /** @deprecated the band always uses the thread motif */
  img?: string;
  /** @deprecated */
  subtitle?: string;
  className?: string;
}) {
  const text = line ?? title ?? "Put your company's knowledge to work.";
  return (
    <>
      {/* Atmospheric image band — full-bleed, heavily tinted, quiet */}
      <section aria-hidden className="m-image-band">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/marketing/thread.jpg"
          alt=""
          className="m-image-band__img m-img-tinted"
        />
        <div className="m-image-band__overlay" />
        <div className="m-image-band-inner">
          <div
            className="m-mono-sm"
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "rgba(237,233,225,0.7)",
            }}
          >
            helix · always on · append-only
          </div>
        </div>
      </section>

      <section className={`m-cta-band m-grain ${className}`}>
        <div
          className="m-pointer-events-none"
          style={{ position: "absolute", right: -64, top: -64, opacity: 0.08 }}
          aria-hidden="true"
        >
          <HelixOrbit size={340} />
        </div>
        <div
          className="m-pointer-events-none"
          style={{ position: "absolute", left: -40, bottom: -64, opacity: 0.06 }}
          aria-hidden="true"
        >
          <HelixOrbit size={220} />
        </div>

        <div className="m-cta-band-inner">
          <h3
            style={{
              fontSize: 34,
              fontWeight: 600,
              color: "var(--m-foreground)",
              fontFamily: 'var(--font-display, "Fraunces", Georgia, serif)',
              letterSpacing: "-0.02em",
              lineHeight: 1.1,
              maxWidth: 640,
            }}
          >
            {text}
          </h3>
          <Link href={href} className="m-btn-primary" style={{ flexShrink: 0 }}>
            {cta}
          </Link>
        </div>
      </section>
    </>
  );
}

/* ========================================================================== */
/*  ImageBand — atmospheric image band                                       */
/* ========================================================================== */

export function ImageBand({
  src,
  alt = "",
  label,
  children,
  className = "",
}: {
  src: string;
  alt?: string;
  label?: string;
  children?: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`m-image-band ${className}`} aria-hidden={label ? true : undefined}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt={alt} className="m-image-band__img m-img-tinted" />
      <div className="m-image-band__overlay" />
      <div className="m-image-band-inner">
        {label ? (
          <div
            className="m-mono-sm"
            style={{
              textTransform: "uppercase",
              letterSpacing: "0.18em",
              color: "rgba(237,233,225,0.7)",
            }}
          >
            {label}
          </div>
        ) : (
          children
        )}
      </div>
    </section>
  );
}

/* ========================================================================== */
/*  Footer                                                                    */
/* ========================================================================== */

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div>
      <div
        className="m-mono-sm"
        style={{ marginBottom: 16, color: "var(--m-muted-foreground)" }}
      >
        {title}
      </div>
      <ul
        style={{
          listStyle: "none",
          margin: 0,
          padding: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          fontSize: 15,
          color: "var(--m-body)",
        }}
      >
        {links.map((l) => (
          <li key={l.href}>
            <Link
              href={l.href}
              className="m-transition-colors m-hover-text-foreground"
            >
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Footer({ className = "" }: { className?: string }) {
  return (
    <footer className={`m-footer ${className}`} style={{ position: "relative" }}>
      <div style={{ overflow: "hidden", opacity: 0.18 }}>
        <HelixBand height={44} crossovers={16} />
      </div>
      <div className="m-footer-inner">
        <div className="m-footer-grid">
          {/* Brand column */}
          <div>
            <HelixWordmark />
            <p
              className="m-mt-5"
              style={{
                fontSize: 15,
                color: "var(--m-body)",
                maxWidth: 384,
                lineHeight: 1.6,
              }}
            >
              The operating DNA of your company. Two strands: what your company
              knows, and what it does with it.
            </p>
            <p
              className="m-mono-sm m-mt-4"
              style={{ color: "var(--m-muted-foreground)" }}
            >
              built by Hephaistos Systems · Germany · hosted in Frankfurt (EU)
            </p>
            <a
              href="mailto:pilot@helix.ai"
              className="m-mono m-mt-6 m-hover-text-ember"
              style={{
                display: "inline-block",
                marginTop: 24,
                color: "var(--m-foreground)",
              }}
            >
              pilot@helix.ai
            </a>
            <div className="m-mt-6">
              <Rung />
            </div>
          </div>

          <FooterCol
            title="Product"
            links={[
              { href: "/product", label: "The product" },
              { href: "/use-cases", label: "Use cases" },
              { href: "/industries", label: "Industries" },
              { href: "/security", label: "Security" },
              { href: "/pilot", label: "Pilot" },
            ]}
          />
          <FooterCol
            title="Company"
            links={[
              { href: "/pilot", label: "Pilot" },
              { href: "mailto:pilot@helix.ai", label: "pilot@helix.ai" },
              // Imprint/privacy/DPA stay at stable URLs for later fill-in —
              // not linked from primary marketing chrome while placeholders remain.
            ]}
          />
        </div>

        {/* Bottom bar */}
        <div className="m-footer-bottom">
          <span className="m-mono-sm m-text-muted-foreground">
            &copy; {new Date().getFullYear()} Hephaistos Systems GmbH
          </span>
          <span className="m-mono-sm m-text-muted-foreground">
            append-only · nothing was deleted
          </span>
        </div>
      </div>
    </footer>
  );
}
