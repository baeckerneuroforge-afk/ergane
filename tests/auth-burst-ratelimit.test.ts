// =============================================================================
// AUTHENTICATED BURST RATE LIMITS (chat / skill-start / upload)
//
// Daily soft limits (assertWithinDailyLimit) still apply. These tests drive the
// shipped assertAuthBurstLimit / checkRateLimit helpers used by dashboard
// actions — not a reimplementation.
// =============================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AUTH_BURST_ERROR,
  AUTH_BURST_LIMIT_PER_MINUTE,
  assertAuthBurstLimit,
  authBurstKey,
  checkRateLimit,
  resetRateLimiter,
} from '../src/lib/slack/ratelimit';

const ORG = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const USER = 'user_burst_1';
const USER_B = 'user_burst_2';

afterEach(() => {
  resetRateLimiter();
});

describe('assertAuthBurstLimit (shipped helper)', () => {
  it('allows AUTH_BURST_LIMIT_PER_MINUTE then throws a clear limit error', () => {
    const t0 = 2_000_000;
    for (let i = 0; i < AUTH_BURST_LIMIT_PER_MINUTE; i++) {
      expect(() => assertAuthBurstLimit('chat', ORG, USER, t0 + i)).not.toThrow();
    }
    expect(() => assertAuthBurstLimit('chat', ORG, USER, t0 + 100)).toThrow(AUTH_BURST_ERROR);
  });

  it('isolates kinds, orgs, and users', () => {
    const t0 = 3_000_000;
    for (let i = 0; i < AUTH_BURST_LIMIT_PER_MINUTE; i++) {
      assertAuthBurstLimit('chat', ORG, USER, t0 + i);
    }
    // Same user, different kind — still allowed
    expect(() => assertAuthBurstLimit('skill-start', ORG, USER, t0 + 50)).not.toThrow();
    // Same kind, other user — still allowed
    expect(() => assertAuthBurstLimit('chat', ORG, USER_B, t0 + 50)).not.toThrow();
    // Same kind+user, other org — still allowed
    expect(() =>
      assertAuthBurstLimit('chat', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', USER, t0 + 50),
    ).not.toThrow();
    // Original bucket still blocked
    expect(() => assertAuthBurstLimit('chat', ORG, USER, t0 + 50)).toThrow(AUTH_BURST_ERROR);
  });

  it('resets after the window', () => {
    const t0 = 4_000_000;
    for (let i = 0; i < AUTH_BURST_LIMIT_PER_MINUTE; i++) {
      assertAuthBurstLimit('upload', ORG, USER, t0 + i);
    }
    expect(() => assertAuthBurstLimit('upload', ORG, USER, t0 + 100)).toThrow(AUTH_BURST_ERROR);
    expect(() => assertAuthBurstLimit('upload', ORG, USER, t0 + 61_000)).not.toThrow();
  });

  it('authBurstKey is stable and used by checkRateLimit path', () => {
    const key = authBurstKey('skill-start', ORG, USER);
    expect(key).toBe(`auth:skill-start:${ORG}:${USER}`);
    const t0 = 5_000_000;
    for (let i = 0; i < AUTH_BURST_LIMIT_PER_MINUTE; i++) {
      expect(checkRateLimit(key, t0 + i, AUTH_BURST_LIMIT_PER_MINUTE)).toBe(true);
    }
    expect(checkRateLimit(key, t0 + 1, AUTH_BURST_LIMIT_PER_MINUTE)).toBe(false);
  });
});

describe('dashboard actions wire assertAuthBurstLimit', () => {
  const root = join(__dirname, '..');

  it('chat askQuestion, skill start, knowledge upload/reingest call the gate', () => {
    const chat = readFileSync(join(root, 'src/app/dashboard/chat/actions.ts'), 'utf8');
    const skills = readFileSync(join(root, 'src/app/dashboard/skills/actions.ts'), 'utf8');
    const knowledge = readFileSync(join(root, 'src/app/dashboard/knowledge/actions.ts'), 'utf8');

    expect(chat).toMatch(/assertAuthBurstLimit\(\s*['"]chat['"]/);
    expect(skills).toMatch(/assertAuthBurstLimit\(\s*['"]skill-start['"]/);
    expect(knowledge).toMatch(/assertAuthBurstLimit\(\s*['"]upload['"]/);
    // addDocument + ingestUpload + reingestUpload all use upload kind
    const uploadCalls = knowledge.match(/assertAuthBurstLimit\(\s*['"]upload['"]/g) ?? [];
    expect(uploadCalls.length).toBeGreaterThanOrEqual(3);
  });
});
