import type { Metadata } from 'next';
import { CtaBand } from '@/components/marketing/site';
import { SubPageShell, SubHero, TintedImage, Section, Eyebrow } from '@/components/marketing/subpage';

export const metadata: Metadata = {
  title: 'Access & Isolation',
  description: 'Row-level security, tenant isolation — no data leaks between organizations.',
};

export default function AccessIsolationPage() {
  return (
    <SubPageShell>
      <SubHero
        eyebrow="Security · Access & Isolation"
        title="Tenant-isolated."
        accent="By design."
        subtitle="Row-level security ensures no data leaks between organizations. Every query is scoped to your tenant."
        right={<TintedImage src="/marketing/vault.jpg" alt="Access isolation" />}
      />

      <Section>
        <Eyebrow>Architecture</Eyebrow>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
          {[
            {
              title: "Row-level security",
              desc: "Every database query is scoped to your tenant. No cross-contamination.",
            },
            {
              title: "Clerk authentication",
              desc: "Enterprise-grade identity management with SSO, MFA, and role-based access.",
            },
            {
              title: "Scoped vector stores",
              desc: "Each tenant has its own vector store. Your embeddings are isolated.",
            },
            {
              title: "API key isolation",
              desc: "API keys are scoped to your organization. No shared credentials.",
            },
          ].map((item) => (
            <div key={item.title} className="m-card">
              <h3 className="m-mono-sm" style={{ color: "var(--m-ember)", marginBottom: 12, margin: 0, fontSize: "inherit", fontWeight: "inherit" }}>
                {item.title.toLowerCase()}
              </h3>
              <p style={{ fontSize: 15, color: "var(--m-foreground)", margin: 0, marginTop: 12 }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </Section>

      <CtaBand
        img="/marketing/vault.jpg"
        title="Isolated by design."
        cta="Request a pilot"
        href="/pilot/request"
      />
    </SubPageShell>
  );
}
