// Symmetric secret encryption (AES-256-GCM) for values that must live in the
// database but are secrets — currently the per-installation Slack bot token
// from the OAuth flow (stored as bot_token_ref = 'enc:<payload>').
//
// Key: SLACK_TOKEN_ENC_KEY — 32 bytes, base64-encoded, generated once, e.g.
//   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
// The KEY stays in the environment; the DB holds only ciphertext. When a real
// vault/KMS arrives, only this module changes.
//
// Payload format: base64(iv).base64(ciphertext).base64(authTag) — GCM, so any
// tampering fails the auth tag check (throws), never returns garbage.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';

function loadKey(envName: string): Buffer {
  const raw = process.env[envName];
  if (!raw) {
    throw new Error(`crypto: ${envName} is not set — cannot handle encrypted secrets.`);
  }
  const key = Buffer.from(raw, 'base64');
  if (key.length !== 32) {
    throw new Error(`crypto: ${envName} must be 32 bytes, base64-encoded (got ${key.length} bytes).`);
  }
  return key;
}

export function encryptString(plaintext: string, envName = 'SLACK_TOKEN_ENC_KEY'): string {
  const key = loadKey(envName);
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString('base64')}.${ct.toString('base64')}.${tag.toString('base64')}`;
}

export function decryptString(payload: string, envName = 'SLACK_TOKEN_ENC_KEY'): string {
  const key = loadKey(envName);
  const [ivB64, ctB64, tagB64] = payload.split('.');
  if (!ivB64 || !ctB64 || !tagB64) {
    throw new Error('crypto: malformed encrypted payload.');
  }
  const decipher = createDecipheriv(ALGO, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(tagB64, 'base64'));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, 'base64')),
    decipher.final(), // throws on tampering (auth tag mismatch)
  ]).toString('utf8');
}
