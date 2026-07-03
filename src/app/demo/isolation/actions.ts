'use server';

// Server action behind the "attempt cross-tenant access" button.
//
// Trust boundary: the org context comes ONLY from requireTenant() (the verified
// Clerk session). We re-check isDemoOrg() here as defense-in-depth — the page
// already 404s for non-demo orgs, but a server action is independently callable,
// so it must gate itself too. The probe itself only ever touches the two fixed
// demo tenants and runs entirely through withTenant()/RLS.
import { requireTenant } from '@/lib/auth-context';
import { attemptCrossTenantAccess, isDemoOrg, type IsolationProof } from '@/lib/demo/isolation';

export async function runIsolationProof(): Promise<IsolationProof> {
  const { clerkOrgId, orgSlug } = await requireTenant();
  if (!isDemoOrg({ clerkOrgId, orgSlug })) {
    throw new Error('The isolation demo is only available in demo organizations.');
  }
  return attemptCrossTenantAccess();
}
