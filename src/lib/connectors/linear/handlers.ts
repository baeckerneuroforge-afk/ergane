// Linear webhook handler — public entry (no Clerk). Gate chain:
// signature → workspace→org → idempotency → ack-then-work → normalize → ingest.
import { getEmbeddingProvider } from '../../ai';
import { logError } from '../../log';
import { ingestDocument } from '../../rag/ingest';
import { deferWork } from '../../slack/defer';
import { claimConnectorEvent } from '../idempotency';
import { resolveConnectorWorkspace } from '../team';
import {
  isIssueEvent,
  normalizeLinearIssue,
  shouldIngestAction,
  type LinearWebhookPayload,
} from './normalize';
import { verifyLinearSignature } from './verify';

const ACTOR = 'connector:linear';

/**
 * Process one verified Linear webhook delivery for a known org.
 * Exported for tests (sync path after gates).
 */
export async function processLinearIssueIngest(
  orgId: string,
  payload: LinearWebhookPayload,
): Promise<{ documentId: string } | null> {
  if (!isIssueEvent(payload) || !shouldIngestAction(payload.action)) {
    return null;
  }
  const item = normalizeLinearIssue(payload.data ?? {});
  if (!item) return null;

  const result = await ingestDocument({
    orgId,
    actorId: ACTOR,
    title: item.title,
    source: item.source,
    text: item.text,
    externalRef: item.externalRef,
    sourceMeta: item.sourceMeta,
    // fail-closed restricted is enforced inside ingest for source=ticket
    embedder: getEmbeddingProvider(),
  });
  return { documentId: result.documentId };
}

export async function handleLinearWebhook(req: Request): Promise<Response> {
  const signingSecret = process.env.LINEAR_WEBHOOK_SECRET?.trim() ?? '';
  const rawBody = await req.text();

  let payload: LinearWebhookPayload = {};
  try {
    payload = JSON.parse(rawBody) as LinearWebhookPayload;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const signature = req.headers.get('linear-signature') ?? req.headers.get('Linear-Signature');
  const ok = verifyLinearSignature({
    signingSecret,
    rawBody,
    signatureHeader: signature,
    webhookTimestampMs:
      typeof payload.webhookTimestamp === 'number' ? payload.webhookTimestamp : null,
  });
  if (!ok) {
    return new Response('unauthorized', { status: 401 });
  }

  // Linear may send a Ping on webhook create — ack without work.
  if (payload.type === 'Ping' || (!payload.type && !payload.data)) {
    return new Response('ok', { status: 200 });
  }

  const organizationId = payload.organizationId;
  const install = await resolveConnectorWorkspace('linear', organizationId);
  if (!install) {
    return new Response('workspace not mapped', { status: 403 });
  }

  // Idempotency key: webhookId + action + issue id (or whole delivery).
  const issueId = payload.data?.id ?? 'none';
  const eventKey =
    payload.webhookId != null
      ? `${payload.webhookId}:${payload.action ?? 'x'}:${issueId}:${payload.webhookTimestamp ?? ''}`
      : `${payload.action ?? 'x'}:${issueId}:${payload.webhookTimestamp ?? rawBody.slice(0, 64)}`;

  const claimed = await claimConnectorEvent(install.orgId, 'linear', eventKey);
  if (!claimed) {
    return new Response('ok', { status: 200 }); // duplicate
  }

  // Ack-then-work: return 200 before ingest (may embed + write).
  const orgId = install.orgId;
  const workPayload = payload;
  deferWork(async () => {
    try {
      await processLinearIssueIngest(orgId, workPayload);
    } catch (err) {
      logError('linear webhook: ingest failed', err, { orgId });
    }
  });

  return new Response('ok', { status: 200 });
}
