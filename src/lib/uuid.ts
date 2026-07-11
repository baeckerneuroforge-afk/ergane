// Dependency-free UUID helpers (Node's built-in crypto only).
//
// - isUuid(): strict RFC-4122 validation. withTenant() rejects anything that is
//   not a UUID *before* it touches the database, so the value bound into
//   `app.current_org` can never be attacker-controlled junk.
// - clerkOrgIdToUuid(): deterministically derives our internal org UUID from the
//   verified Clerk organization id (e.g. "org_2ab…"). UUID v5 = SHA-1 of
//   (namespace + name). Same Clerk org id always yields the same internal UUID,
//   so we never need a lookup table to resolve the tenant from the session.
import { createHash } from 'node:crypto';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/**
 * Parse a form/route entity id: non-empty + strict UUID, fail-closed.
 * Use at dashboard mutation boundaries before any tenant work.
 */
export function requireUuid(value: unknown, field: string): string {
  const id = typeof value === 'string' ? value.trim() : String(value ?? '').trim();
  if (!id) throw new Error(`${field} is required.`);
  if (!isUuid(id)) throw new Error(`Invalid ${field}.`);
  return id;
}

// Stable namespace for helix.ai org ids (value predates the rebrand — never change it). Generated once; never change it, or every
// derived org UUID would change. (Itself a valid v4 UUID.)
const HELIX_ORG_NAMESPACE = 'b3f1c0de-1a2b-4c3d-8e4f-5a6b7c8d9e0f';

function hexToBytes(hex: string): Buffer {
  return Buffer.from(hex.replace(/-/g, ''), 'hex');
}

function bytesToUuid(buf: Buffer): string {
  const hex = buf.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/** RFC-4122 v5 (SHA-1, name-based) UUID derivation. */
export function uuidV5(name: string, namespace = HELIX_ORG_NAMESPACE): string {
  const ns = hexToBytes(namespace);
  const hash = createHash('sha1')
    .update(ns)
    .update(Buffer.from(name, 'utf8'))
    .digest()
    .subarray(0, 16);
  // Set version (5) and the RFC-4122 variant bits.
  hash[6] = (hash[6] & 0x0f) | 0x50;
  hash[8] = (hash[8] & 0x3f) | 0x80;
  return bytesToUuid(hash);
}

export function clerkOrgIdToUuid(clerkOrgId: string): string {
  if (!clerkOrgId || typeof clerkOrgId !== 'string') {
    throw new Error('clerkOrgIdToUuid: a non-empty Clerk organization id is required');
  }
  return uuidV5(clerkOrgId);
}
