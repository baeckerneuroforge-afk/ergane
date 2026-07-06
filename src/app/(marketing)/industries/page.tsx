import type { Metadata } from "next";
import Link from "next/link";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, CtaBand } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Industries",
  description:
    "How helix fits into professional services, SaaS, financial services, and manufacturing.",
};

const INDUSTRIES = [
  {
    href: "/industries/professional-services",
    title: "Professional Services",
    description:
      "Frameworks at scale. From call to deliverable, with governance built in.",
  },
  {
    href: "/industries/saas",
    title: "SaaS & Technology",
    description:
      "Ship faster, support smarter. Spec tracking, drift detection, cited support.",
  },
  {
    href: "/industries/financial-services",
    title: "Financial Services",
    description:
      "Compliance-first automation. Every transaction gated, every decision logged.",
  },
  {
    href: "/industries/manufacturing",
    title: "Manufacturing & Mittelstand",
    description:
      "Operational knowledge, preserved. Specs, tolerances, tribal knowledge — retrievable.",
  },
] as const;

export default function IndustriesPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Industries"
        title="Industry-shaped,"
        accent="not generic."
        subtitle="helix moulds to your domain, not the other way around. See how it fits into your industry."
        right={<TintedImage src="/marketing/ledger.jpg" />}
      />

      <Section>
        <div className="m-grid m-grid-2x2 m-gap-6">
          {INDUSTRIES.map((c) => (
            <Link key={c.href} href={c.href} className="m-card m-card-hover">
              <h3>{c.title}</h3>
              <p
                className="m-mt-2 m-text-sm"
                style={{ color: "var(--m-body)" }}
              >
                {c.description}
              </p>
              <span
                className="m-mono-sm m-mt-4"
                style={{ color: "var(--m-ember)", display: "inline-block" }}
              >
                See how &rarr;
              </span>
            </Link>
          ))}
        </div>
      </Section>

      <CtaBand
        img="/marketing/ledger.jpg"
        title="Industry-shaped, not generic."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
