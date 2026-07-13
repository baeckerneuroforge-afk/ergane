// P1-D: env-driven demo org resolution (pure)
import { describe, expect, it } from 'vitest';
import { clerkOrgIdToUuid } from '../src/lib/uuid';
import {
  DEFAULT_DEMO_CLERK_ORG,
  DEFAULT_DEMO_ORG_UUID,
  resolveDemoOrgIds,
} from '../src/lib/demo/org';

describe('resolveDemoOrgIds', () => {
  it('defaults to Nordwind constants', () => {
    const r = resolveDemoOrgIds({});
    expect(r.orgId).toBe(DEFAULT_DEMO_ORG_UUID);
    expect(r.clerkOrgId).toBe(DEFAULT_DEMO_CLERK_ORG);
    expect(r.source).toBe('defaults');
  });

  it('derives org UUID from DEMO_CLERK_ORG_ID', () => {
    const clerk = 'org_live_demo_xyz';
    const r = resolveDemoOrgIds({ DEMO_CLERK_ORG_ID: clerk });
    expect(r.clerkOrgId).toBe(clerk);
    expect(r.orgId).toBe(clerkOrgIdToUuid(clerk));
    expect(r.source).toBe('env_clerk');
  });

  it('accepts both DEMO_ORG_ID and DEMO_CLERK_ORG', () => {
    const orgId = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
    const r = resolveDemoOrgIds({
      DEMO_ORG_ID: orgId,
      DEMO_CLERK_ORG: 'org_pair',
      DEMO_ORG_NAME: 'Pair Co',
    });
    expect(r.orgId).toBe(orgId);
    expect(r.clerkOrgId).toBe('org_pair');
    expect(r.orgName).toBe('Pair Co');
    expect(r.source).toBe('env_both');
  });

  it('rejects non-UUID DEMO_ORG_ID', () => {
    expect(() => resolveDemoOrgIds({ DEMO_ORG_ID: 'not-a-uuid' })).toThrow(/UUID/);
  });
});
