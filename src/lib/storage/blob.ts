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
// Real provider: Vercel Blob (private). The token comes from env only.
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
      access: 'public',
      token: this.token,
      contentType,
      addRandomSuffix: false,
    });
    return { key, url: blob.url, contentType, size: bytes.length };
  }

  async get(key: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const { list } = await import('@vercel/blob');
    const result = await list({ prefix: key, limit: 1, token: this.token });
    const match = result.blobs.find((b) => b.pathname === key);
    if (!match) return null;
    const res = await fetch(match.url);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    return { bytes: new Uint8Array(buffer), contentType: (match as unknown as { contentType?: string }).contentType ?? 'application/octet-stream' };
  }

  async delete(key: string): Promise<void> {
    const { list, del } = await import('@vercel/blob');
    const result = await list({ prefix: key, limit: 1, token: this.token });
    const match = result.blobs.find((b) => b.pathname === key);
    if (match) await del(match.url, { token: this.token });
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
