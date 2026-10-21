export interface RetryOptions {
  retries?: number;        // additional attempts after the first (default 3)
  baseMs?: number;         // default 200
  maxMs?: number;          // default 5000
  shouldRetry?: (err: unknown, attempt: number) => boolean;
  onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Exponential backoff with full jitter: delay ~ U(0, min(maxMs, baseMs * 2^attempt)). */
export async function retry<T>(fn: (attempt: number) => Promise<T>, opts: RetryOptions = {}): Promise<T> {
  const { retries = 3, baseMs = 200, maxMs = 5000, shouldRetry = () => true, onRetry } = opts;
  for (let attempt = 0; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries || !shouldRetry(err, attempt)) throw err;
      const delay = Math.floor(Math.random() * Math.min(maxMs, baseMs * 2 ** attempt));
      onRetry?.(err, attempt + 1, delay);
      await sleep(delay);
    }
  }
}