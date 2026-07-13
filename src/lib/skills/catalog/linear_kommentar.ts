// Skill: linear_kommentar — post a comment on a Linear issue AFTER human approval.
//
// P3-A write effect: the external HTTP call runs in prepare() (no withTenant),
// using the org's connector install token decrypted outside the tenant tx.
// acts:true + always-on guardrail — irreversible external write never auto-runs.
//
// Token scopes: Linear OAuth must include comments:create (and/or write). Installs
// created with only `read` need re-consent via Connectors → Connect Linear again.
// Production still requires HELIX_LINEAR_WRITE to select the real write provider.
import { withTenant } from '../../tenant';
import { decryptConnectorToken } from '../../connectors/crypto';
import {
  describeLinearComment,
  getToolWriteProvider,
} from '../../effects';
import type { SkillDef, SkillJson } from '../types';

export const LINEAR_COMMENT_GUARDRAIL_REASON =
  'External write — Linear comment leaves helix, human approval required';

const ISSUE_UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseInput(input: SkillJson): { issueId: string; body: string } {
  const issueId = String(input.issueId ?? input.linearIssueId ?? '').trim();
  const body = String(input.body ?? input.kommentar ?? '').trim();
  if (!issueId) throw new Error('linear_kommentar: issueId is required.');
  if (!ISSUE_UUID_RE.test(issueId)) {
    throw new Error(
      'linear_kommentar: issueId must be a Linear issue UUID (not the ENG-123 identifier).',
    );
  }
  if (!body) throw new Error('linear_kommentar: body is required.');
  if (body.length > 10_000) throw new Error('linear_kommentar: body too long (max 10000).');
  return { issueId, body };
}

/**
 * Resolve Linear OAuth token for this org WITHOUT holding a long tenant tx
 * around the network call. Short withTenant only for the DB read.
 */
export async function resolveLinearAccessToken(orgId: string): Promise<string> {
  const install = await withTenant(orgId, (tx) =>
    tx.connectorInstallation.findUnique({
      where: { orgId_provider: { orgId, provider: 'linear' } },
      select: { accessTokenRef: true },
    }),
  );
  if (!install?.accessTokenRef) {
    throw new Error(
      'linear_kommentar: Linear is not connected for this organization. Connect it under Connectors first.',
    );
  }
  // Decrypt OUTSIDE the transaction (crypto only; no tenant rows open).
  const token = decryptConnectorToken(install.accessTokenRef);
  if (!token) {
    throw new Error('linear_kommentar: could not resolve Linear access token.');
  }
  return token;
}

export const linearKommentar: SkillDef = {
  key: 'linear_kommentar',
  title: 'Post a Linear comment',
  handlesMoney: false,
  // Irreversible external write — policy "never" is overridden by the engine.
  requiresHumanApproval: true,
  guardrail: () => ({ triggered: true, reason: LINEAR_COMMENT_GUARDRAIL_REASON }),
  steps: [
    {
      name: 'kommentar_vorbereiten',
      run: async ({ input }) => {
        const { issueId, body } = parseInput(input);
        return {
          issueId,
          body,
          preview: describeLinearComment(issueId, body),
        };
      },
    },
    {
      name: 'kommentar_senden',
      acts: true,
      describeEffect: ({ state }) => {
        const issueId = String(state.kommentar_vorbereiten?.issueId ?? '');
        const body = String(state.kommentar_vorbereiten?.body ?? '');
        return {
          wirkung: describeLinearComment(issueId, body),
          issueId,
          externalWrite: true,
        };
      },
      // Network + token decrypt happen here — BEFORE withTenant opens for run().
      prepare: async ({ orgId, state }) => {
        const issueId = String(state.kommentar_vorbereiten?.issueId ?? '');
        const body = String(state.kommentar_vorbereiten?.body ?? '');
        if (!issueId || !body) {
          throw new Error('linear_kommentar: missing prepared comment state.');
        }
        const accessToken = await resolveLinearAccessToken(orgId);
        const writer = getToolWriteProvider();
        const result = await writer.postLinearComment({ issueId, body, accessToken });
        return {
          commentId: result.id,
          provider: result.provider,
          simulated: result.simulated === true,
          issueId,
        };
      },
      run: async ({ prepared }) => {
        return {
          gesendet: true,
          commentId: prepared?.commentId ?? null,
          provider: prepared?.provider ?? null,
          simulated: prepared?.simulated === true,
          issueId: prepared?.issueId ?? null,
        };
      },
    },
  ],
};
