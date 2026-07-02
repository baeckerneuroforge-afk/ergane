// =============================================================================
// HARDENING GATE (Phase 16)
//
//   1. CSP: fresh nonce per request, nonce lands in script-src, key
//      directives present; Report-Only by default, enforced via CSP_ENFORCE.
//   2. Error reporter: posts masked payloads to the webhook sink; a broken
//      sink never throws into the app path; without ERROR_WEBHOOK_URL the
//      wiring is a no-op.
// =============================================================================
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildCsp, cspHeaderName, generateCspNonce } from '../src/lib/csp';
import {
  initErrorReporterFromEnv,
  setErrorReporterTransport,
} from '../src/lib/error-reporter';
import { logError, setErrorReporter } from '../src/lib/log';

afterEach(() => {
  setErrorReporter(null);
  setErrorReporterTransport(null);
  delete process.env.ERROR_WEBHOOK_URL;
  delete process.env.CSP_ENFORCE;
});

describe('CSP', () => {
  it('generates a fresh nonce per request and puts it into script-src', () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).not.toBe(b);
    const csp = buildCsp(a);
    expect(csp).toContain(`'nonce-${a}'`);
    expect(csp).toContain(`frame-ancestors 'none'`);
    expect(csp).toContain(`object-src 'none'`);
    expect(csp).toContain(`base-uri 'self'`);
    expect(csp).toContain('strict-dynamic');
  });

  it('is Report-Only by default and enforced only with CSP_ENFORCE=true', () => {
    expect(cspHeaderName()).toBe('Content-Security-Policy-Report-Only');
    process.env.CSP_ENFORCE = 'true';
    expect(cspHeaderName()).toBe('Content-Security-Policy');
    process.env.CSP_ENFORCE = 'false';
    expect(cspHeaderName()).toBe('Content-Security-Policy-Report-Only');
  });
});

describe('error reporter (webhook sink)', () => {
  it('is a no-op without ERROR_WEBHOOK_URL', () => {
    expect(initErrorReporterFromEnv()).toBe(false);
  });

  it('posts ONE masked JSON payload per logError', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: Array<{ url: string; body: string }> = [];
    setErrorReporterTransport(async (url, init) => {
      calls.push({ url, body: String(init.body) });
    });
    process.env.ERROR_WEBHOOK_URL = 'https://sink.example/hook';
    expect(initErrorReporterFromEnv()).toBe(true);

    logError('slack post failed', new Error('boom'), {
      orgId: 'org-1',
      botToken: 'xoxb-super-geheim',
    });
    await new Promise((r) => setTimeout(r, 0)); // let the fire-and-forget settle

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://sink.example/hook');
    const payload = JSON.parse(calls[0]!.body) as Record<string, unknown>;
    expect(payload.error).toContain('boom');
    expect(calls[0]!.body).not.toContain('xoxb-super-geheim'); // masked
    errSpy.mockRestore();
  });

  it('a rejecting sink never throws into the caller', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    setErrorReporterTransport(async () => {
      throw new Error('sink kaputt');
    });
    process.env.ERROR_WEBHOOK_URL = 'https://sink.example/hook';
    initErrorReporterFromEnv();

    expect(() => logError('x', new Error('y'))).not.toThrow();
    await new Promise((r) => setTimeout(r, 0));
    errSpy.mockRestore();
  });
});
