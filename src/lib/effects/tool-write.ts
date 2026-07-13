// Write-side tool effects (P3-A) — network I/O only, never inside withTenant.
// Used from acting skill steps AFTER the guardrail/approval gate.
//
// Pattern mirrors EmailProvider: fake in dev/test when secrets unset; production
// fails closed without configuration.

export interface LinearCommentInput {
  /** Linear issue UUID (not the identifier ENG-123). */
  issueId: string;
  body: string;
  /** Decrypted API token (caller resolves enc:… BEFORE the call). */
  accessToken: string;
}

export interface LinearCommentResult {
  id: string;
  provider: string;
  /** True when the fake adapter recorded without network. */
  simulated?: boolean;
}

export interface ToolWriteProvider {
  readonly name: string;
  postLinearComment(input: LinearCommentInput): Promise<LinearCommentResult>;
}

export class FakeToolWriteProvider implements ToolWriteProvider {
  readonly name = 'fake-tool-write';
  readonly comments: LinearCommentInput[] = [];
  failNext = false;

  reset(): void {
    this.comments.length = 0;
    this.failNext = false;
  }

  async postLinearComment(input: LinearCommentInput): Promise<LinearCommentResult> {
    if (this.failNext) {
      this.failNext = false;
      throw new Error('FakeToolWriteProvider: simulated failure');
    }
    if (!input.issueId?.trim()) throw new Error('FakeToolWriteProvider: issueId required');
    if (!input.body?.trim()) throw new Error('FakeToolWriteProvider: body required');
    if (!input.accessToken?.trim()) throw new Error('FakeToolWriteProvider: accessToken required');
    this.comments.push({ ...input });
    return {
      id: `fake-comment-${this.comments.length}`,
      provider: this.name,
      simulated: true,
    };
  }
}

const fakeWrite = new FakeToolWriteProvider();

export function getFakeToolWriteProvider(): FakeToolWriteProvider {
  return fakeWrite;
}

/** Real Linear GraphQL comment create — only when LINEAR write is enabled. */
export class LinearToolWriteProvider implements ToolWriteProvider {
  readonly name = 'linear-api';

  async postLinearComment(input: LinearCommentInput): Promise<LinearCommentResult> {
    const { fetchWithTimeout } = await import('../http-timeout');
    const res = await fetchWithTimeout('https://api.linear.app/graphql', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: input.accessToken,
      },
      body: JSON.stringify({
        query: `
          mutation CommentCreate($input: CommentCreateInput!) {
            commentCreate(input: $input) {
              success
              comment { id }
            }
          }
        `,
        variables: {
          input: { issueId: input.issueId, body: input.body },
        },
      }),
    });
    const text = await res.text();
    if (!res.ok) {
      throw new Error(`linear commentCreate HTTP ${res.status}: ${text.slice(0, 200)}`);
    }
    let data: {
      data?: { commentCreate?: { success?: boolean; comment?: { id?: string } } };
      errors?: Array<{ message?: string }>;
    };
    try {
      data = JSON.parse(text) as typeof data;
    } catch {
      throw new Error(`linear commentCreate: non-JSON response: ${text.slice(0, 120)}`);
    }
    const id = data.data?.commentCreate?.comment?.id;
    if (!data.data?.commentCreate?.success || !id) {
      throw new Error(
        `linear commentCreate failed: ${data.errors?.[0]?.message ?? 'malformed response'}`,
      );
    }
    return { id, provider: this.name };
  }
}

/**
 * Select write provider:
 *   HELIX_LINEAR_WRITE=1|true → real Linear API
 *   missing in production → throw (fail-closed, never silent fake)
 *   missing in dev/test → fake
 */
export function getToolWriteProvider(): ToolWriteProvider {
  const raw = process.env.HELIX_LINEAR_WRITE?.trim().toLowerCase() ?? '';
  const writeEnabled = ['1', 'true', 'yes', 'on'].includes(raw);
  if (writeEnabled) {
    return new LinearToolWriteProvider();
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'getToolWriteProvider: HELIX_LINEAR_WRITE is not enabled. Refusing silent fake writes in production.',
    );
  }
  return fakeWrite;
}

/** Human-readable dry-run description (no network). */
export function describeLinearComment(issueId: string, body: string): string {
  const preview = body.trim().slice(0, 80);
  return `Would post a Linear comment on issue ${issueId}: "${preview}${body.length > 80 ? '…' : ''}"`;
}
