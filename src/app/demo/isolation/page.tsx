import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { requireTenant } from '@/lib/auth-context';
import { getLocale } from '@/lib/i18n/server';
import { ensureDemoData, isDemoOrg } from '@/lib/demo/isolation';
import { IsolationDemo } from './isolation-demo';

// Session-derived + a live DB read → never prerender/cache.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Tenant isolation — live proof',
  description: 'Watch a cross-tenant read get blocked at the database by Postgres RLS + FORCE.',
};

export default async function IsolationDemoPage() {
  // The org comes ONLY from the verified Clerk session. The demo is enabled for
  // demo orgs only; a real customer org gets a genuine 404 (route looks absent).
  const { clerkOrgId, orgSlug } = await requireTenant();
  if (!isDemoOrg({ clerkOrgId, orgSlug })) notFound();

  const locale = await getLocale();
  const { a, b } = await ensureDemoData();

  return (
    <IsolationDemo
      locale={locale}
      orgA={{ name: a.name, orgId: a.orgId, item: a.item }}
      orgB={{ name: b.name, orgId: b.orgId, item: b.item }}
    />
  );
}
