// Retrying fetch for flaky external providers (FAL, OpenAI, ElevenLabs).
//
// One transient 429/5xx on the Nth image used to fail an entire ~60s story
// build. This wrapper retries network errors and retryable statuses with
// exponential backoff, and leaves all other responses (including 4xx) to
// the caller's normal error handling.
//
// Note: bodies passed via `init` must be reusable (string / ArrayBuffer /
// FormData) — streams would be consumed by the first attempt.

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface RetryOpts {
  attempts?: number; // total tries, including the first (default 3)
  baseDelayMs?: number; // first backoff delay (default 1000)
  timeoutMs?: number; // per-attempt timeout (default none)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function fetchWithRetry(
  url: string,
  init: RequestInit = {},
  opts: RetryOpts = {},
): Promise<Response> {
  const attempts = opts.attempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 1000;

  let lastError: Error | null = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const res = await fetch(url, {
        ...init,
        ...(opts.timeoutMs ? { signal: AbortSignal.timeout(opts.timeoutMs) } : {}),
      });
      if (!RETRYABLE_STATUSES.has(res.status) || attempt === attempts) return res;
      // Drain the body so the connection can be reused, then back off.
      await res.text().catch(() => undefined);
      lastError = new Error(`HTTP ${res.status}`);
    } catch (e) {
      // Network error or per-attempt timeout.
      if (attempt === attempts) throw e;
      lastError = e as Error;
    }
    const delay = baseDelayMs * 2 ** (attempt - 1);
    console.warn(`[retry] ${url.split('?')[0]} attempt ${attempt}/${attempts} failed (${lastError?.message}); retrying in ${delay}ms`);
    await sleep(delay);
  }
  // Unreachable, but satisfies the compiler.
  throw lastError ?? new Error('fetchWithRetry exhausted');
}
