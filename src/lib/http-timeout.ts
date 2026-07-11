// Shared outbound HTTP timeout — every plain-fetch adapter (Voyage, Slack,
// Resend, OAuth) must abort after a finite budget instead of hanging until the
// platform kills the function. LLM calls use a longer budget (OUTBOUND_LLM_TIMEOUT_MS)
// because a single Messages request can legitimately take longer than short API posts.
//
// AbortSignal.timeout is Node 18+ / modern browsers. AbortSignal.any merges a
// caller-supplied signal with our timeout so neither path can hang forever.

/** Default budget for short outbound APIs (embeddings, Slack, email, OAuth). */
export const OUTBOUND_HTTP_TIMEOUT_MS = 30_000;

/** Budget for LLM completions (Anthropic SDK client timeout). */
export const OUTBOUND_LLM_TIMEOUT_MS = 180_000;

export class OutboundTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(timeoutMs: number) {
    super(`Outbound HTTP request timed out after ${timeoutMs}ms`);
    this.name = 'OutboundTimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

function isAbortOrTimeout(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return (
    err.name === 'TimeoutError' ||
    err.name === 'AbortError' ||
    // undici / Node fetch sometimes wrap the abort
    /aborted|timeout/i.test(err.message)
  );
}

/**
 * fetch() with a hard abort deadline. Pass `timeoutMs` to override the default
 * short-API budget. Caller signals are merged so either side can cancel.
 */
export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit = {},
  timeoutMs: number = OUTBOUND_HTTP_TIMEOUT_MS,
): Promise<Response> {
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal =
    init.signal != null
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

  try {
    return await fetch(input, { ...init, signal });
  } catch (err) {
    if (isAbortOrTimeout(err)) {
      throw new OutboundTimeoutError(timeoutMs);
    }
    throw err;
  }
}
