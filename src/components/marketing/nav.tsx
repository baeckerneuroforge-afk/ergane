"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { HelixWordmark } from "@/components/marketing/brand";

/* ========================================================================== */
/*  NAV data                                                                  */
/* ========================================================================== */

interface NavLink {
  label: string;
  href: string;
  desc?: string;
}

interface NavGroup {
  heading: string;
  links: NavLink[];
}

interface NavFeature {
  img: string;
  title: string;
  desc: string;
  href: string;
}

interface NavItem {
  label: string;
  groups: NavGroup[];
  feature?: NavFeature;
}

const NAV: NavItem[] = [
  {
    label: "Product",
    groups: [
      {
        heading: "The core",
        links: [
          {
            label: "Knowledge",
            href: "/product/knowledge",
            desc: "Ingest, chunk, embed, cite.",
          },
          {
            label: "Skills",
            href: "/product/skills",
            desc: "Human-gated actions across tools.",
          },
          {
            label: "Governance",
            href: "/product/governance",
            desc: "Approval flows & audit trails.",
          },
          {
            label: "Memory",
            href: "/product/memory",
            desc: "Persistent org-wide context.",
          },
        ],
      },
      {
        heading: "Platform",
        links: [
          {
            label: "The Loop",
            href: "/product/loop",
            desc: "Autonomous correction cycle.",
          },
          {
            label: "Integrations",
            href: "/product/integrations",
            desc: "Connect your stack.",
          },
          {
            label: "Overview",
            href: "/product/overview",
            desc: "How helix works end-to-end.",
          },
          {
            label: "Security",
            href: "/product/security",
            desc: "Enterprise-grade by default.",
          },
        ],
      },
    ],
    feature: {
      img: "/marketing/stack.jpg",
      title: "The helix stack",
      desc: "Knowledge + Skills + Governance, working as one.",
      href: "/product/overview",
    },
  },
  {
    label: "Use cases",
    groups: [
      {
        heading: "By department",
        links: [
          {
            label: "Consulting",
            href: "/use-cases/consulting",
            desc: "Frameworks, proposals, deliverables.",
          },
          {
            label: "Customer support",
            href: "/use-cases/customer-support",
            desc: "Resolve faster, cite sources.",
          },
          {
            label: "Sales",
            href: "/use-cases/sales",
            desc: "Qualify, draft, follow up.",
          },
          {
            label: "Finance",
            href: "/use-cases/finance",
            desc: "Reports, reconciliation, compliance.",
          },
        ],
      },
    ],
    feature: {
      img: "/marketing/thread.jpg",
      title: "Built for knowledge workers",
      desc: "See how helix handles real consulting workflows.",
      href: "/use-cases/consulting",
    },
  },
  {
    label: "Industries",
    groups: [
      {
        heading: "How helix fits",
        links: [
          {
            label: "Professional services & agencies",
            href: "/industries/professional-services",
            desc: "Frameworks at scale.",
          },
          {
            label: "SaaS & technology",
            href: "/industries/saas-technology",
            desc: "Ship faster, support smarter.",
          },
          {
            label: "Financial services",
            href: "/industries/financial-services",
            desc: "Compliance-first automation.",
          },
          {
            label: "Manufacturing & Mittelstand",
            href: "/industries/manufacturing",
            desc: "Operational knowledge, preserved.",
          },
        ],
      },
    ],
    feature: {
      img: "/marketing/gears.jpg",
      title: "Industry-shaped, not generic",
      desc: "helix moulds to your domain, not the other way around.",
      href: "/industries/professional-services",
    },
  },
  {
    label: "Security",
    groups: [
      {
        heading: "Pillars",
        links: [
          {
            label: "Data & Hosting",
            href: "/security/data-hosting",
            desc: "EU-only, encrypted at rest.",
          },
          {
            label: "Access & Isolation",
            href: "/security/access-isolation",
            desc: "Row-level, tenant-isolated.",
          },
          {
            label: "Audit & Compliance",
            href: "/security/audit-compliance",
            desc: "Append-only audit log.",
          },
          {
            label: "Human-in-the-loop",
            href: "/security/human-in-the-loop",
            desc: "Nothing runs without approval.",
          },
        ],
      },
      {
        heading: "Legal",
        links: [
          {
            label: "DPA",
            href: "/dpa",
            desc: "Data processing agreement.",
          },
          {
            label: "Privacy",
            href: "/privacy",
            desc: "Privacy policy.",
          },
        ],
      },
    ],
    feature: {
      img: "/marketing/vault.jpg",
      title: "Security is the product",
      desc: "Not a checkbox. Not an add-on. The architecture.",
      href: "/security/data-hosting",
    },
  },
  {
    label: "Pilot",
    groups: [
      {
        heading: "Program 2026",
        links: [
          {
            label: "Pilot program",
            href: "/pilot",
            desc: "How the pilot works.",
          },
          {
            label: "Request a pilot",
            href: "/pilot/request",
            desc: "Start your evaluation.",
          },
        ],
      },
    ],
    feature: {
      img: "/marketing/ledger.jpg",
      title: "Start in weeks, not months",
      desc: "A structured pilot with clear milestones and exit criteria.",
      href: "/pilot",
    },
  },
];

/* ========================================================================== */
/*  Wordmark wrapper                                                          */
/* ========================================================================== */

export function Wordmark({
  tone = "light",
  className = "",
}: {
  tone?: "light" | "dark";
  className?: string;
}) {
  return <HelixWordmark tone={tone} className={className} />;
}

/* ========================================================================== */
/*  MegaMenu                                                                  */
/* ========================================================================== */

function MegaMenu({
  item,
  onClose,
}: {
  item: NavItem;
  onClose: () => void;
}) {
  return (
    <div
      className="m-hairline-b"
      style={{
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        zIndex: 50,
        background: "var(--m-surface)",
        borderTop: "1px solid var(--m-hairline)",
        boxShadow: "0 20px 60px -20px rgba(23,24,28,0.12)",
      }}
    >
      <div
        style={{
          maxWidth: 1200,
          margin: "0 auto",
          padding: "32px 24px",
          display: "grid",
          gridTemplateColumns: item.feature
            ? "1fr 320px"
            : "1fr",
          gap: 48,
        }}
      >
        {/* Link groups */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${item.groups.length}, minmax(0, 1fr))`,
            gap: 40,
          }}
        >
          {item.groups.map((group) => (
            <div key={group.heading}>
              <div className="m-eyebrow" style={{ marginBottom: 16 }}>
                {group.heading}
              </div>
              <div className="m-flex-col m-gap-1">
                {group.links.map((link) => (
                  <Link
                    key={link.href}
                    href={link.href}
                    onClick={onClose}
                    style={{
                      display: "block",
                      padding: "10px 12px",
                      borderRadius: 10,
                      transition:
                        "background 150ms ease, color 150ms ease",
                    }}
                    onMouseEnter={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "var(--m-muted)";
                    }}
                    onMouseLeave={(e) => {
                      (e.currentTarget as HTMLElement).style.background =
                        "transparent";
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        fontSize: 15,
                        fontWeight: 500,
                        color: "var(--m-foreground)",
                        letterSpacing: "-0.005em",
                      }}
                    >
                      {link.label}
                    </span>
                    {link.desc && (
                      <span
                        style={{
                          display: "block",
                          fontSize: 13,
                          color: "var(--m-muted-foreground)",
                          marginTop: 2,
                        }}
                      >
                        {link.desc}
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Feature card */}
        {item.feature && (
          <Link
            href={item.feature.href}
            onClick={onClose}
            style={{
              position: "relative",
              display: "flex",
              flexDirection: "column",
              justifyContent: "flex-end",
              borderRadius: 14,
              overflow: "hidden",
              minHeight: 220,
              textDecoration: "none",
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.feature.img}
              alt=""
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                objectFit: "cover",
                filter:
                  "saturate(0.75) contrast(1.05) brightness(0.96) sepia(0.18) hue-rotate(-8deg)",
              }}
            />
            <div
              style={{
                position: "absolute",
                inset: 0,
                background:
                  "linear-gradient(to top, rgba(20,21,25,0.88) 0%, rgba(20,21,25,0.3) 60%, transparent 100%)",
              }}
            />
            <div
              style={{
                position: "relative",
                padding: "20px",
              }}
            >
              <span
                style={{
                  display: "block",
                  fontSize: 16,
                  fontWeight: 500,
                  color: "#E8E8EC",
                  letterSpacing: "-0.01em",
                }}
              >
                {item.feature.title}
              </span>
              <span
                style={{
                  display: "block",
                  fontSize: 13,
                  color: "rgba(232,232,236,0.7)",
                  marginTop: 4,
                }}
              >
                {item.feature.desc}
              </span>
            </div>
          </Link>
        )}
      </div>
    </div>
  );
}

/* ========================================================================== */
/*  TopNav                                                                    */
/* ========================================================================== */

export function TopNav() {
  const [open, setOpen] = useState<string | null>(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Close mega menu when clicking outside */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (navRef.current && !navRef.current.contains(e.target as Node)) {
        setOpen(null);
      }
    }
    document.addEventListener("click", handleClick);
    return () => document.removeEventListener("click", handleClick);
  }, []);

  /* Close mega menu on Escape */
  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(null);
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, []);

  const handleMouseEnter = (label: string) => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setOpen(label);
  };

  const handleMouseLeave = () => {
    timeoutRef.current = setTimeout(() => setOpen(null), 200);
  };

  return (
    <nav ref={navRef} className="m-header" role="navigation">
      <div className="m-header-inner">
        {/* Logo */}
        <Wordmark />

        {/* Desktop nav links */}
        <div
          className="m-sm-only-hidden m-flex m-items-center m-gap-1"
          style={{ height: "100%" }}
        >
          {NAV.map((item) => (
            <div
              key={item.label}
              onMouseEnter={() => handleMouseEnter(item.label)}
              onMouseLeave={handleMouseLeave}
              style={{ position: "relative", height: "100%" }}
            >
              <button
                onClick={() =>
                  setOpen(open === item.label ? null : item.label)
                }
                style={{
                  all: "unset",
                  display: "flex",
                  alignItems: "center",
                  height: "100%",
                  padding: "0 14px",
                  fontSize: 14,
                  fontWeight: 450,
                  letterSpacing: "-0.005em",
                  color:
                    open === item.label
                      ? "var(--m-foreground)"
                      : "var(--m-muted-foreground)",
                  cursor: "pointer",
                  transition: "color 150ms ease",
                }}
              >
                {item.label}
              </button>
            </div>
          ))}
        </div>

        {/* CTA buttons (desktop) */}
        <div
          className="m-sm-only-hidden m-flex m-items-center m-gap-3"
        >
          <Link
            href="/pilot"
            className="m-text-sm m-font-medium m-text-muted-foreground m-transition-colors m-hover-text-foreground"
            style={{ padding: "8px 12px" }}
          >
            Pilot
          </Link>
          <Link
            href="/pilot/request"
            className="m-btn-primary"
            style={{ padding: "8px 16px", fontSize: 14 }}
          >
            Request a pilot
          </Link>
        </div>

        {/* Mobile hamburger */}
        <button
          className="m-md-hidden"
          onClick={() => setMobileOpen(!mobileOpen)}
          aria-label={mobileOpen ? "Close menu" : "Open menu"}
          style={{
            all: "unset",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 40,
            height: 40,
            cursor: "pointer",
          }}
        >
          <svg
            width="20"
            height="20"
            viewBox="0 0 20 20"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
          >
            {mobileOpen ? (
              <>
                <line
                  x1="4"
                  y1="4"
                  x2="16"
                  y2="16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="16"
                  y1="4"
                  x2="4"
                  y2="16"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </>
            ) : (
              <>
                <line
                  x1="3"
                  y1="5"
                  x2="17"
                  y2="5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="3"
                  y1="10"
                  x2="17"
                  y2="10"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
                <line
                  x1="3"
                  y1="15"
                  x2="17"
                  y2="15"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </>
            )}
          </svg>
        </button>
      </div>

      {/* Desktop mega menu overlay */}
      {open && (
        <div
          onMouseEnter={() => {
            if (timeoutRef.current) clearTimeout(timeoutRef.current);
          }}
          onMouseLeave={handleMouseLeave}
        >
          {NAV.filter((item) => item.label === open).map((item) => (
            <MegaMenu
              key={item.label}
              item={item}
              onClose={() => setOpen(null)}
            />
          ))}
        </div>
      )}

      {/* Mobile menu */}
      {mobileOpen && (
        <div
          className="m-md-hidden"
          style={{
            position: "absolute",
            top: "100%",
            left: 0,
            right: 0,
            zIndex: 50,
            background: "var(--m-surface)",
            borderTop: "1px solid var(--m-hairline)",
            boxShadow: "0 20px 60px -20px rgba(23,24,28,0.12)",
            maxHeight: "calc(100vh - 64px)",
            overflowY: "auto",
          }}
        >
          <div style={{ padding: "16px 24px" }}>
            {NAV.map((item) => (
              <div key={item.label} style={{ marginBottom: 8 }}>
                <button
                  onClick={() =>
                    setOpen(open === item.label ? null : item.label)
                  }
                  style={{
                    all: "unset",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    width: "100%",
                    padding: "12px 0",
                    fontSize: 16,
                    fontWeight: 500,
                    color: "var(--m-foreground)",
                    cursor: "pointer",
                    borderBottom: "1px solid var(--m-hairline)",
                  }}
                >
                  {item.label}
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{
                      transform:
                        open === item.label
                          ? "rotate(180deg)"
                          : "rotate(0deg)",
                      transition: "transform 150ms ease",
                    }}
                  >
                    <path
                      d="M4 6 L8 10 L12 6"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {open === item.label && (
                  <div style={{ padding: "8px 0 16px" }}>
                    {item.groups.map((group) => (
                      <div key={group.heading} style={{ marginBottom: 12 }}>
                        <div
                          className="m-eyebrow"
                          style={{ marginBottom: 8 }}
                        >
                          {group.heading}
                        </div>
                        {group.links.map((link) => (
                          <Link
                            key={link.href}
                            href={link.href}
                            onClick={() => setMobileOpen(false)}
                            style={{
                              display: "block",
                              padding: "10px 12px",
                              borderRadius: 8,
                              fontSize: 15,
                              fontWeight: 450,
                              color: "var(--m-foreground)",
                            }}
                          >
                            {link.label}
                            {link.desc && (
                              <span
                                style={{
                                  display: "block",
                                  fontSize: 13,
                                  fontWeight: 400,
                                  color: "var(--m-muted-foreground)",
                                  marginTop: 2,
                                }}
                              >
                                {link.desc}
                              </span>
                            )}
                          </Link>
                        ))}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}

            {/* Mobile CTA */}
            <div
              className="m-flex-col m-gap-3"
              style={{ marginTop: 16, paddingBottom: 24 }}
            >
              <Link
                href="/pilot/request"
                className="m-btn-primary"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "12px 20px",
                }}
              >
                Request a pilot
              </Link>
              <Link
                href="/pilot"
                className="m-btn-secondary"
                style={{
                  width: "100%",
                  justifyContent: "center",
                  padding: "12px 20px",
                }}
              >
                Learn about the pilot
              </Link>
            </div>
          </div>
        </div>
      )}
    </nav>
  );
}
