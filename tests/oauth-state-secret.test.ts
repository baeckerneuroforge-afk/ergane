// =============================================================================
// OAuth state secret — dedicated SLACK_OAUTH_STATE_SECRET (package E)
// Drives makeOAuthState / verifyOAuthState / stateSecret from the shipped module.
// =============================================================================
import { afterEach, describe, expect, it } from 'vitest';
import {
  makeOAuthState,
  stateSecret,
  verifyOAuthState,
} from '../src/lib/slack/oauth';

const ORG = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const saved = {
  oauth: process.env.SLACK_OAUTH_STATE_SECRET,
  signing: process.env.SLACK_SIGNING_SECRET,
};

afterEach(() => {
  if (saved.oauth === undefined) delete process.env.SLACK_OAUTH_STATE_SECRET;
  else process.env.SLACK_OAUTH_STATE_SECRET = saved.oauth;
  if (saved.signing === undefined) delete process.env.SLACK_SIGNING_SECRET;
  else process.env.SLACK_SIGNING_SECRET = saved.signing;
});

describe('stateSecret preference', () => {
  it('prefers SLACK_OAUTH_STATE_SECRET over SLACK_SIGNING_SECRET', () => {
    process.env.SLACK_OAUTH_STATE_SECRET = 'dedicated-oauth-state-secret';
    process.env.SLACK_SIGNING_SECRET = 'signing-should-not-win';
    expect(stateSecret()).toBe('dedicated-oauth-state-secret');
  });

  it('falls back to SLACK_SIGNING_SECRET when dedicated is unset', () => {
    delete process.env.SLACK_OAUTH_STATE_SECRET;
    process.env.SLACK_SIGNING_SECRET = 'signing-fallback';
    expect(stateSecret()).toBe('signing-fallback');
  });

  it('fails closed when neither secret is set', () => {
    delete process.env.SLACK_OAUTH_STATE_SECRET;
    delete process.env.SLACK_SIGNING_SECRET;
    expect(() => stateSecret()).toThrow(/SLACK_OAUTH_STATE_SECRET/);
  });
});

describe('makeOAuthState / verifyOAuthState with dedicated secret', () => {
  it('round-trips with the dedicated secret', () => {
    process.env.SLACK_OAUTH_STATE_SECRET = 'state-secret-A';
    delete process.env.SLACK_SIGNING_SECRET;
    const state = makeOAuthState(ORG, 1_700_000_000);
    expect(verifyOAuthState(state, 1_700_000_000)).toBe(ORG);
  });

  it('rejects verify when the secret changes (wrong key)', () => {
    process.env.SLACK_OAUTH_STATE_SECRET = 'state-secret-A';
    const state = makeOAuthState(ORG, 1_700_000_000);
    process.env.SLACK_OAUTH_STATE_SECRET = 'state-secret-B';
    expect(verifyOAuthState(state, 1_700_000_000)).toBeNull();
  });

  it('does not verify a signing-secret state under a dedicated secret', () => {
    delete process.env.SLACK_OAUTH_STATE_SECRET;
    process.env.SLACK_SIGNING_SECRET = 'only-signing';
    const state = makeOAuthState(ORG, 1_700_000_000);
    process.env.SLACK_OAUTH_STATE_SECRET = 'now-dedicated';
    // verify uses dedicated secret → signature mismatch
    expect(verifyOAuthState(state, 1_700_000_000)).toBeNull();
  });
});
