// Token encryption for connector installs. Prefers CONNECTOR_TOKEN_ENC_KEY;
// falls back to SLACK_TOKEN_ENC_KEY so existing deploys work without a second key.
import { decryptString, encryptString } from '../crypto';

function tokenKeyEnv(): string {
  if (process.env.CONNECTOR_TOKEN_ENC_KEY?.trim()) return 'CONNECTOR_TOKEN_ENC_KEY';
  if (process.env.SLACK_TOKEN_ENC_KEY?.trim()) return 'SLACK_TOKEN_ENC_KEY';
  throw new Error(
    'connectors: set CONNECTOR_TOKEN_ENC_KEY (preferred) or SLACK_TOKEN_ENC_KEY to store OAuth tokens.',
  );
}

export function encryptConnectorToken(plaintext: string): string {
  return `enc:${encryptString(plaintext, tokenKeyEnv())}`;
}

export function decryptConnectorToken(ref: string | null | undefined): string | null {
  if (!ref) return null;
  if (ref.startsWith('env:')) {
    const name = ref.slice(4);
    const v = process.env[name]?.trim();
    return v || null;
  }
  if (ref.startsWith('enc:')) {
    return decryptString(ref.slice(4), tokenKeyEnv());
  }
  // Refuse bare secrets that look like live tokens.
  throw new Error('connectors: access_token_ref must be enc:… or env:… — refusing plaintext.');
}
