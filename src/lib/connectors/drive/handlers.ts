// Drive webhook / ingest: signature → workspace → claim → ack-then-work → ingest.
import { getEmbeddingProvider } from '../../ai';
import { logError } from '../../log';
import { ingestDocument } from '../../rag/ingest';
import { deferWork } from '../../slack/defer';
import { claimConnectorEvent } from '../idempotency';
import { resolveConnectorWorkspace } from '../team';
import {
  normalizeDriveFile,
  type DriveFilePayload,
} from './normalize';
import { verifyDriveSignature } from './verify';

const ACTOR = 'connector:drive';

export interface DriveWebhookBody {
  workspaceId?: string;
  file?: DriveFilePayload;
  /** Google push notification may only carry resourceId; tests send full file. */
  resourceId?: string;
}

export async function processDriveFileIngest(
  orgId: string,
  file: DriveFilePayload,
): Promise<{ documentId: string } | null> {
  const item = normalizeDriveFile(file);
  if (!item) return null;
  const result = await ingestDocument({
    orgId,
    actorId: ACTOR,
    title: item.title,
    source: item.source,
    text: item.text,
    externalRef: item.externalRef,
    sourceMeta: item.sourceMeta,
    embedder: getEmbeddingProvider(),
  });
  return { documentId: result.documentId };
}

export async function handleDriveWebhook(req: Request): Promise<Response> {
  const signingSecret = process.env.DRIVE_WEBHOOK_SECRET?.trim() ?? '';
  const rawBody = await req.text();
  const signature =
    req.headers.get('x-helix-drive-signature') ??
    req.headers.get('X-Helix-Drive-Signature');
  const channelToken =
    req.headers.get('x-goog-channel-token') ?? req.headers.get('X-Goog-Channel-Token');

  // Channel-token alone may only ACK empty Google push pings (no body content).
  // Any JSON body that will be ingested MUST carry HMAC over the body — otherwise
  // a leaked channel token would allow arbitrary document injection.
  const hasBody = rawBody.trim().length > 0;
  if (hasBody) {
    if (
      !verifyDriveSignature({
        signingSecret,
        rawBody,
        signatureHeader: signature,
        // Do NOT accept channel-token as sufficient for content-bearing bodies.
      })
    ) {
      return new Response('unauthorized', { status: 401 });
    }
  } else {
    if (
      !verifyDriveSignature({
        signingSecret,
        rawBody: '',
        signatureHeader: signature,
        channelTokenHeader: channelToken,
      })
    ) {
      return new Response('unauthorized', { status: 401 });
    }
    // Empty notification — ack only (real fetch-from-Drive is a follow-up path).
    return new Response('ok', { status: 200 });
  }

  let body: DriveWebhookBody = {};
  try {
    body = JSON.parse(rawBody) as DriveWebhookBody;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const workspaceId =
    body.workspaceId ??
    body.file?.workspaceId ??
    (body.file?.driveId ? `drive:${body.file.driveId}` : null);
  if (!workspaceId) {
    return new Response('workspace not resolvable', { status: 400 });
  }

  const install = await resolveConnectorWorkspace('drive', workspaceId);
  if (!install) {
    return new Response('workspace not mapped', { status: 403 });
  }

  const file = body.file;
  if (!file?.id) {
    // Notification without content — acknowledged; poller would fetch later.
    return new Response('ok', { status: 200 });
  }

  const eventKey = `drive:${file.id}:${file.modifiedTime ?? body.resourceId ?? 'x'}`;
  const claimed = await claimConnectorEvent(install.orgId, 'drive', eventKey);
  if (!claimed) {
    return new Response('ok', { status: 200 });
  }

  const orgId = install.orgId;
  deferWork(async () => {
    try {
      await processDriveFileIngest(orgId, file);
    } catch (err) {
      logError('drive webhook: ingest failed', err, { orgId });
    }
  });

  return new Response('ok', { status: 200 });
}
