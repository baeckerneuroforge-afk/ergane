// =============================================================================
// OUTBOUND HTTP TIMEOUT GATE
//
// Proves fetchWithTimeout aborts a hung transport within the configured budget
// and surfaces OutboundTimeoutError — no hang-until-platform-kill path.
// Uses a signal-respecting fake fetch (no network, no API tokens).
// =============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OUTBOUND_HTTP_TIMEOUT_MS,
  OUTBOUND_LLM_TIMEOUT_MS,
  OutboundTimeoutError,
  fetchWithTimeout,
} from '../src/lib/http-timeout';
import { AnthropicChatProvider } from '../src/lib/ai/anthropic';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

/** Delayed fetch that honors AbortSignal (real hung-API simulation). */
function installDelayedFetch(delayMs: number): void {
  globalThis.fetch = ((_input: RequestInfo | URL, init?: RequestInit) =>
    new Promise<Response>((resolve, reject) => {
      const timer = setTimeout(() => {
        resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
      }, delayMs);
      const onAbort = () => {
        clearTimeout(timer);
        const err = new Error('The operation was aborted');
        err.name = 'AbortError';
        reject(err);
      };
      if (init?.signal?.aborted) {
        onAbort();
        return;
      }
      init?.signal?.addEventListener('abort', onAbort, { once: true });
    })) as typeof fetch;
}

describe('fetchWithTimeout', () => {
  it('aborts a delayed transport and throws OutboundTimeoutError within the budget', async () => {
    installDelayedFetch(5_000);
    const budget = 80;
    const started = Date.now();
    await expect(fetchWithTimeout('https://example.test/slow', { method: 'GET' }, budget)).rejects.toBeInstanceOf(
      OutboundTimeoutError,
    );
    const elapsed = Date.now() - started;
    // Must fail fast relative to the 5s delay (platform-kill would be minutes).
    expect(elapsed).toBeLessThan(2_000);
    expect(elapsed).toBeGreaterThanOrEqual(budget - 20);
  });

  it('returns the response when the transport finishes before the budget', async () => {
    installDelayedFetch(20);
    const res = await fetchWithTimeout('https://example.test/fast', { method: 'GET' }, 2_000);
    expect(res.ok).toBe(true);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('exports finite short and LLM budgets', () => {
    expect(OUTBOUND_HTTP_TIMEOUT_MS).toBeGreaterThan(0);
    expect(OUTBOUND_HTTP_TIMEOUT_MS).toBeLessThanOrEqual(60_000);
    expect(OUTBOUND_LLM_TIMEOUT_MS).toBeGreaterThan(OUTBOUND_HTTP_TIMEOUT_MS);
    expect(OUTBOUND_LLM_TIMEOUT_MS).toBeLessThanOrEqual(600_000);
  });
});

describe('adapter wiring (static + client option)', () => {
  it('AnthropicChatProvider configures a finite SDK timeout (OUTBOUND_LLM_TIMEOUT_MS)', () => {
    const provider = new AnthropicChatProvider('test-key-not-used-for-network');
    // Reach into the SDK client — timeout is a public field on the client.
    const client = (provider as unknown as { client: { timeout: number } }).client;
    expect(client.timeout).toBe(OUTBOUND_LLM_TIMEOUT_MS);
  });

  it('Voyage / Slack / Resend / OAuth source modules use fetchWithTimeout', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const root = join(import.meta.dirname, '..');
    const files = [
      'src/lib/ai/voyage.ts',
      'src/lib/slack/client.ts',
      'src/lib/slack/oauth.ts',
      'src/lib/effects/resend.ts',
    ];
    for (const rel of files) {
      const src = readFileSync(join(root, rel), 'utf8');
      expect(src, rel).toMatch(/fetchWithTimeout/);
      // No bare global fetch( for outbound API calls in these adapters.
      expect(src.replace(/fetchWithTimeout/g, 'FETCH_TIMEOUT'), rel).not.toMatch(
        /\bawait fetch\s*\(/,
      );
    }
  });
});
