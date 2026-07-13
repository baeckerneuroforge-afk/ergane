// GitHub webhook: signature → workspace → org → claim → ack-then-work → ingest.
import { getEmbeddingProvider } from '../../ai';
import { logError } from '../../log';
import { ingestDocument } from '../../rag/ingest';
import { deferWork } from '../../slack/defer';
import { claimConnectorEvent } from '../idempotency';
import { resolveConnectorWorkspace } from '../team';
import type { NormalizedToolItem } from '../types';
import {
  githubWorkspaceId,
  normalizeGitHubPullRequest,
  normalizePushPayload,
  type GitHubPullRequestPayload,
  type GitHubPushPayload,
} from './normalize';
import { verifyGitHubSignature } from './verify';

const ACTOR = 'connector:github';

export async function processGitHubItems(
  orgId: string,
  items: NormalizedToolItem[],
): Promise<string[]> {
  const ids: string[] = [];
  const embedder = getEmbeddingProvider();
  for (const item of items) {
    const result = await ingestDocument({
      orgId,
      actorId: ACTOR,
      title: item.title,
      source: item.source,
      text: item.text,
      externalRef: item.externalRef,
      sourceMeta: item.sourceMeta,
      embedder,
    });
    ids.push(result.documentId);
  }
  return ids;
}

export async function handleGitHubWebhook(req: Request): Promise<Response> {
  const signingSecret = process.env.GITHUB_WEBHOOK_SECRET?.trim() ?? '';
  const rawBody = await req.text();
  const signature =
    req.headers.get('x-hub-signature-256') ?? req.headers.get('X-Hub-Signature-256');

  if (
    !verifyGitHubSignature({
      signingSecret,
      rawBody,
      signatureHeader: signature,
    })
  ) {
    return new Response('unauthorized', { status: 401 });
  }

  const event = req.headers.get('x-github-event') ?? req.headers.get('X-GitHub-Event') ?? '';
  if (event === 'ping') {
    return new Response('ok', { status: 200 });
  }

  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(rawBody) as Record<string, unknown>;
  } catch {
    return new Response('invalid json', { status: 400 });
  }

  const push = payload as GitHubPushPayload & {
    sender?: { id?: number };
    repository?: { id?: number; owner?: { id?: number } };
  };
  const workspaceId = githubWorkspaceId(push);
  // OAuth stores user:<githubUserId>; webhooks often only have repo/install ids.
  // Try every stable key we may have stored so OAuth-connected orgs receive events.
  const candidates = [
    workspaceId,
    push.repository?.id != null ? `repo:${push.repository.id}` : null,
    push.sender?.id != null ? `user:${push.sender.id}` : null,
    push.repository?.owner?.id != null ? `user:${push.repository.owner.id}` : null,
    push.installation?.id != null ? `install:${push.installation.id}` : null,
    push.organization?.id != null ? `org:${push.organization.id}` : null,
  ].filter((x): x is string => Boolean(x));

  let install = null;
  for (const key of candidates) {
    install = await resolveConnectorWorkspace('github', key);
    if (install) break;
  }
  if (!install) {
    return new Response('workspace not mapped', { status: 403 });
  }

  let items: NormalizedToolItem[] = [];
  if (event === 'push') {
    items = normalizePushPayload(payload as GitHubPushPayload);
  } else if (event === 'pull_request') {
    const item = normalizeGitHubPullRequest(payload as GitHubPullRequestPayload);
    if (item) items = [item];
  } else {
    return new Response('ok', { status: 200 }); // ignore other events
  }

  if (items.length === 0) {
    return new Response('ok', { status: 200 });
  }

  const delivery =
    req.headers.get('x-github-delivery') ??
    req.headers.get('X-GitHub-Delivery') ??
    `${event}:${items[0]!.externalRef}`;
  const claimed = await claimConnectorEvent(install.orgId, 'github', delivery);
  if (!claimed) {
    return new Response('ok', { status: 200 });
  }

  const orgId = install.orgId;
  const toIngest = items;
  deferWork(async () => {
    try {
      await processGitHubItems(orgId, toIngest);
    } catch (err) {
      logError('github webhook: ingest failed', err, { orgId });
    }
  });

  return new Response('ok', { status: 200 });
}
