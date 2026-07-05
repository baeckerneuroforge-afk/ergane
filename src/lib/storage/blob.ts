// Blob storage provider — mirror of src/lib/effects/index.ts (getEmailProvider):
//   BLOB_READ_WRITE_TOKEN set  → real Vercel Blob adapter (private, no public access)
//   token missing, dev/test    → deterministic in-memory fake (no network)
//   token missing, production  → throw (production must never pretend to store)
//
// ONLY THIS FILE knows about @vercel/blob. All callers code against BlobProvider.
// Swapping to S3 later means changing only this file.

export interface BlobRef {
  key: string;
  url: string;
  contentType: string;
  size: number;
}

export interface BlobProvider {
  readonly name: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<BlobRef>;
  get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  delete(key: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Fake provider: in-memory map, no network. Shared instance so tests can
// inspect/reset the store (exactly like FakeEmailProvider).
// ---------------------------------------------------------------------------

export class FakeBlobProvider implements BlobProvider {
  readonly name = 'fake';
  readonly store = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<BlobRef> {
    this.store.set(key, { bytes, contentType });
    return { key, url: `fake://${key}`, contentType, size: bytes.length };
  }

  async get(key: string) {
    return this.store.get(key) ?? null;
  }

  async delete(key: string) {
    this.store.delete(key);
  }

  reset() {
    this.store.clear();
  }
}

// ---------------------------------------------------------------------------
// Real provider: Vercel Blob (PRIVATE). The token comes from env only.
//
// Artifacts are tenant data (generated offers/invoices/frameworks), so blobs are
// stored with `access: 'private'` — they are NOT reachable via an anonymous URL.
// Reads go through the authenticated SDK `get(pathname, { access: 'private' })`
// (which resolves the store from the token), never a bare `fetch(url)`. The one
// sanctioned read path is the RLS-gated /api/artifacts/[id]/download route, which
// streams these bytes only after confirming the caller's org owns the artifact.
// ---------------------------------------------------------------------------

class VercelBlobProvider implements BlobProvider {
  readonly name = 'vercel-blob';
  private token: string;

  constructor(token: string) {
    this.token = token;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<BlobRef> {
    const { put } = await import('@vercel/blob');
    const blob = await put(key, Buffer.from(bytes), {
      access: 'private',
      token: this.token,
      contentType,
      addRandomSuffix: false,
    });
    // The returned url is the store URL; for a private blob it is not anonymously
    // fetchable. We keep it in the ref for parity, but reads use get() by key.
    return { key, url: blob.url, contentType, size: bytes.length };
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const { get } = await import('@vercel/blob');
    // Authenticated read by pathname (the key). Resolves the store from the
    // read-write token; returns null when the blob does not exist.
    const result = await get(key, { access: 'private', token: this.token });
    if (!result || result.statusCode !== 200) return null;
    const buffer = await new Response(result.stream).arrayBuffer();
    return {
      bytes: new Uint8Array(buffer),
      contentType: result.blob.contentType ?? 'application/octet-stream',
    };
  }

  async delete(key: string): Promise<void> {
    const { del } = await import('@vercel/blob');
    // del accepts a pathname (not only a url) as long as the token has access to
    // the store — so we can delete by key without a preceding list()/fetch.
    await del(key, { token: this.token });
  }
}

// ---------------------------------------------------------------------------
// Shared fake instance (tests inspect it via getFakeBlobProvider).
// ---------------------------------------------------------------------------

const fakeBlob = new FakeBlobProvider();

export function getFakeBlobProvider(): FakeBlobProvider {
  return fakeBlob;
}

export function getBlobProvider(): BlobProvider {
  const token = process.env.BLOB_READ_WRITE_TOKEN;
  if (token) return new VercelBlobProvider(token);
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'getBlobProvider: BLOB_READ_WRITE_TOKEN is not set. Refusing to fall back to the fake provider in production.',
    );
  }
  return fakeBlob;
}
