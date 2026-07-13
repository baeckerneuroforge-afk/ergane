// Resolve demo seed org identity from env (P1-D) without editing constants.
// Pure + side-effect free so unit tests can pass a fake env bag.
import { clerkOrgIdToUuid, isUuid } from '../uuid';

export const DEFAULT_DEMO_ORG_UUID = '99999999-9999-4999-8999-999999999999';
export const DEFAULT_DEMO_CLERK_ORG = 'demo_org_nordwind';
export const DEFAULT_DEMO_ORG_NAME = 'Nordwind GmbH';

export interface DemoOrgIds {
  orgId: string;
  clerkOrgId: string;
  orgName: string;
  /** How the ids were resolved — useful for seed logs / docs. */
  source: 'env_both' | 'env_clerk' | 'env_org' | 'defaults';
}

/**
 * Prefer:
 * 1. DEMO_ORG_ID + DEMO_CLERK_ORG_ID (or DEMO_CLERK_ORG)
 * 2. DEMO_CLERK_ORG_ID alone → org UUID derived via clerkOrgIdToUuid
 * 3. DEMO_ORG_ID alone with default clerk id (or DEMO_CLERK_ORG)
 * 4. Built-in Nordwind constants
 */
export function resolveDemoOrgIds(
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): DemoOrgIds {
  const clerkRaw =
    env.DEMO_CLERK_ORG_ID?.trim() ||
    env.DEMO_CLERK_ORG?.trim() ||
    '';
  const orgRaw = env.DEMO_ORG_ID?.trim() || '';
  const name = env.DEMO_ORG_NAME?.trim() || DEFAULT_DEMO_ORG_NAME;

  if (clerkRaw && orgRaw) {
    if (!isUuid(orgRaw)) {
      throw new Error(`resolveDemoOrgIds: DEMO_ORG_ID must be a UUID, got ${JSON.stringify(orgRaw)}`);
    }
    return { orgId: orgRaw, clerkOrgId: clerkRaw, orgName: name, source: 'env_both' };
  }
  if (clerkRaw) {
    return {
      orgId: clerkOrgIdToUuid(clerkRaw),
      clerkOrgId: clerkRaw,
      orgName: name,
      source: 'env_clerk',
    };
  }
  if (orgRaw) {
    if (!isUuid(orgRaw)) {
      throw new Error(`resolveDemoOrgIds: DEMO_ORG_ID must be a UUID, got ${JSON.stringify(orgRaw)}`);
    }
    return {
      orgId: orgRaw,
      clerkOrgId: DEFAULT_DEMO_CLERK_ORG,
      orgName: name,
      source: 'env_org',
    };
  }
  return {
    orgId: DEFAULT_DEMO_ORG_UUID,
    clerkOrgId: DEFAULT_DEMO_CLERK_ORG,
    orgName: name,
    source: 'defaults',
  };
}
