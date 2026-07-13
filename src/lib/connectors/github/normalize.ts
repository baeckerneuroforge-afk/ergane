// Pure normalize for GitHub push commits + pull_request events.
import type { NormalizedToolItem } from '../types';

/** Ticket-like refs in commit messages / PR titles (Linear/Jira/GitHub style). */
export const TICKET_REF_RE = /\b([A-Z][A-Z0-9]+-\d+)\b/g;

export function extractTicketRefs(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(TICKET_REF_RE)) {
    if (m[1]) found.add(m[1]);
  }
  return [...found];
}

export function hasTicketRef(text: string): boolean {
  return extractTicketRefs(text).length > 0;
}

export interface GitHubCommit {
  id?: string;
  message?: string;
  timestamp?: string;
  url?: string;
  author?: { name?: string; email?: string; username?: string };
}

export interface GitHubPushPayload {
  ref?: string;
  before?: string;
  after?: string;
  repository?: { id?: number; full_name?: string; html_url?: string };
  installation?: { id?: number };
  organization?: { id?: number; login?: string };
  commits?: GitHubCommit[];
  head_commit?: GitHubCommit | null;
  sender?: { login?: string };
}

export interface GitHubPullRequestPayload {
  action?: string;
  number?: number;
  pull_request?: {
    id?: number;
    number?: number;
    title?: string;
    body?: string | null;
    html_url?: string;
    state?: string;
    merged?: boolean;
    user?: { login?: string };
    head?: { ref?: string; sha?: string };
    base?: { ref?: string };
    updated_at?: string;
    created_at?: string;
  };
  repository?: { id?: number; full_name?: string };
  installation?: { id?: number };
  organization?: { id?: number; login?: string };
}

export function githubWorkspaceId(payload: {
  installation?: { id?: number };
  organization?: { id?: number };
  repository?: { id?: number };
}): string | null {
  if (payload.installation?.id != null) return `install:${payload.installation.id}`;
  if (payload.organization?.id != null) return `org:${payload.organization.id}`;
  if (payload.repository?.id != null) return `repo:${payload.repository.id}`;
  return null;
}

export function normalizeGitHubCommit(
  commit: GitHubCommit,
  repoFullName: string,
): NormalizedToolItem | null {
  const id = commit.id?.trim();
  const message = (commit.message ?? '').trim();
  if (!id || !message) return null;
  const title = message.split('\n')[0]!.slice(0, 200);
  const refs = extractTicketRefs(message);
  const text = [
    `# Commit ${id.slice(0, 7)} on ${repoFullName}`,
    '',
    message,
    commit.url ? `\nURL: ${commit.url}` : '',
    refs.length ? `\nTicket refs: ${refs.join(', ')}` : '',
  ]
    .join('\n')
    .trim();

  return {
    externalRef: `github:commit:${id}`,
    title: `${repoFullName}: ${title}`.slice(0, 500),
    text,
    source: 'code',
    sourceMeta: {
      provider: 'github',
      kind: 'commit',
      sha: id,
      repo: repoFullName,
      message,
      ticketRefs: refs,
      hasTicketRef: refs.length > 0,
      author: commit.author?.username ?? commit.author?.name ?? null,
      url: commit.url ?? null,
      lastActivityAt: commit.timestamp ?? null,
      text,
    },
    occurredAt: commit.timestamp ? new Date(commit.timestamp) : undefined,
  };
}

export function normalizeGitHubPullRequest(
  payload: GitHubPullRequestPayload,
): NormalizedToolItem | null {
  const pr = payload.pull_request;
  if (!pr?.id || !pr.title) return null;
  const repo = payload.repository?.full_name ?? 'unknown';
  const body = (pr.body ?? '').trim();
  const combined = `${pr.title}\n${body}`;
  const refs = extractTicketRefs(combined);
  const number = pr.number ?? payload.number ?? 0;
  const text = [
    `# PR #${number}: ${pr.title}`,
    body ? `\n${body}` : '',
    pr.html_url ? `\nURL: ${pr.html_url}` : '',
    refs.length ? `\nTicket refs: ${refs.join(', ')}` : '',
  ]
    .join('\n')
    .trim();

  return {
    externalRef: `github:pr:${pr.id}`,
    title: `${repo}#${number}: ${pr.title}`.slice(0, 500),
    text,
    source: 'code',
    sourceMeta: {
      provider: 'github',
      kind: 'pull_request',
      prId: pr.id,
      number,
      repo,
      state: pr.merged ? 'merged' : pr.state ?? null,
      ticketRefs: refs,
      hasTicketRef: refs.length > 0,
      url: pr.html_url ?? null,
      lastActivityAt: pr.updated_at ?? pr.created_at ?? null,
      text,
    },
    occurredAt: pr.updated_at ? new Date(pr.updated_at) : undefined,
  };
}

export function normalizePushPayload(payload: GitHubPushPayload): NormalizedToolItem[] {
  const repo = payload.repository?.full_name ?? 'unknown';
  const commits = payload.commits ?? [];
  const items: NormalizedToolItem[] = [];
  for (const c of commits) {
    const item = normalizeGitHubCommit(c, repo);
    if (item) items.push(item);
  }
  return items;
}
