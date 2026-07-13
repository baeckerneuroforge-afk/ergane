// =============================================================================
// DATABASE URL POOLING HINTS — serverless-safe config guidance (package A)
// =============================================================================
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { databaseUrlPoolingHints } from '../src/lib/prisma';

describe('databaseUrlPoolingHints', () => {
  it('detects pgbouncer + connection_limit on a Neon pooled URL', () => {
    const url =
      'postgresql://app_user:secret@ep-x.pooler.neon.tech/ergane?sslmode=require&pgbouncer=true&connection_limit=1';
    const h = databaseUrlPoolingHints(url);
    expect(h.hasPgbouncer).toBe(true);
    expect(h.hasConnectionLimit).toBe(true);
    expect(h.looksPooledHost).toBe(true);
  });

  it('is false for a local direct URL', () => {
    const h = databaseUrlPoolingHints(
      'postgresql://app_user:app_user@localhost:5432/ergane?schema=public',
    );
    expect(h.hasPgbouncer).toBe(false);
    expect(h.hasConnectionLimit).toBe(false);
    expect(h.looksPooledHost).toBe(false);
  });

  it('handles empty / invalid input without throwing', () => {
    expect(databaseUrlPoolingHints('')).toEqual({
      hasPgbouncer: false,
      hasConnectionLimit: false,
      looksPooledHost: false,
    });
    expect(databaseUrlPoolingHints('not-a-url')).toEqual({
      hasPgbouncer: false,
      hasConnectionLimit: false,
      looksPooledHost: false,
    });
  });
});

describe('pooling docs in repo', () => {
  it('.env.example and prisma.ts document pgbouncer + connection_limit', () => {
    const root = join(__dirname, '..');
    const env = readFileSync(join(root, '.env.example'), 'utf8');
    const prisma = readFileSync(join(root, 'src/lib/prisma.ts'), 'utf8');
    expect(env).toMatch(/pgbouncer=true/);
    expect(env).toMatch(/connection_limit=1/);
    expect(prisma).toMatch(/pgbouncer=true/);
    expect(prisma).toMatch(/connection_limit=1/);
  });
});
