import Link from "next/link";
import type { ReactNode } from "react";
import { TopNav } from "@/components/marketing/nav";
import { Footer, Eyebrow, Section } from "@/components/marketing/site";

// ---------------------------------------------------------------------------
// Re-export Eyebrow, Section and Link so subpages can import from one place
// ---------------------------------------------------------------------------
export { Eyebrow, Section, Link };

// ---------------------------------------------------------------------------
// SubPageShell — wraps subpages with TopNav + main + Footer
// ---------------------------------------------------------------------------
export function SubPageShell({ children }: { children: ReactNode }) {
  return (
    <>
      <TopNav />
      <main>{children}</main>
      <Footer />
    </>
  );
}

// ---------------------------------------------------------------------------
// SubHero — hero area for marketing subpages
// ---------------------------------------------------------------------------
export function SubHero({
  eyebrow,
  title,
  accent,
  after,
  subtitle,
  tags,
  right,
  children,
}: {
  eyebrow?: string;
  title: string;
  accent?: string;
  after?: string;
  subtitle?: string;
  tags?: string[];
  right?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <section className="m-subhero">
      <div className="m-subhero-inner">
        {/* Left column */}
        <div>
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
          <h1>
            {title}
            {accent && (
              <>
                {" "}
                <span className="m-text-ember">{accent}</span>
              </>
            )}
            {after ? ` ${after}` : null}
          </h1>
          {subtitle && (
            <p
              className="m-mt-5 m-text-lg"
              style={{ color: "var(--m-body)" }}
            >
              {subtitle}
            </p>
          )}
          {tags && tags.length > 0 && (
            <div className="m-subhero-tags">
              {tags.map((tag) => (
                <span key={tag} className="m-subhero-tag">
                  {tag}
                </span>
              ))}
            </div>
          )}
          {children}
        </div>

        {/* Right column (optional) */}
        {right && <div>{right}</div>}
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// TintedImage — image with the tinted filter inside a frame
// ---------------------------------------------------------------------------
export function TintedImage({
  src,
  alt = "",
}: {
  src: string;
  alt?: string;
}) {
  return (
    <figure className="m-img-frame m-img-tinted" style={{ margin: 0 }}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        className="m-img-tinted"
        style={{ width: "100%", height: "auto", display: "block" }}
      />
    </figure>
  );
}

// ---------------------------------------------------------------------------
// VideoPlaceholder — dark 16:9 placeholder with play button
// ---------------------------------------------------------------------------
export function VideoPlaceholder() {
  return (
    <div className="m-video-placeholder">
      <div className="m-video-placeholder__play">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M8 5v14l11-7L8 5z" fill="#fff" />
        </svg>
      </div>
    </div>
  );
}
