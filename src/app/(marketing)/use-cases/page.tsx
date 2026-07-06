import type { Metadata } from "next";
import Link from "next/link";
import { SubPageShell, SubHero, TintedImage } from "@/components/marketing/subpage";
import { Section, CtaBand } from "@/components/marketing/site";

export const metadata: Metadata = {
  title: "Use Cases",
  description:
    "See how helix works across departments — consulting, support, sales, and finance.",
};

const CASES = [
  {
    href: "/use-cases/consulting",
    title: "Consulting",
    description:
      "Turn a call into a finished framework. Zoom transcripts become structured deliverables.",
  },
  {
    href: "/use-cases/support",
    title: "Customer Support",
    description:
      "Answer from your knowledge, not guesses. Every reply cites its source.",
  },
  {
    href: "/use-cases/sales",
    title: "Sales",
    description:
      "From call to proposal. Qualify, draft, follow up — with cited context.",
  },
  {
    href: "/use-cases/finance",
    title: "Finance",
    description:
      "Process the routine, gate the risky. Invoices, bookings, compliance — human-gated.",
  },
] as const;

export default function UseCasesPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Use Cases"
        title="Every department."
        accent="One system."
        subtitle="helix adapts to your workflows. See how it works for consulting, customer support, sales, and finance."
        right={<TintedImage src="/marketing/thread.jpg" />}
      />

      <Section>
        <div className="m-grid m-grid-2x2 m-gap-6">
          {CASES.map((c) => (
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
        img="/marketing/thread.jpg"
        title="One system, every department."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
