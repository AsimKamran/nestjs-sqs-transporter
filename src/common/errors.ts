/** Throw for failures that retrying can never fix (bad payload, unknown event type...). */
export class NonRetryableError extends Error {
  readonly retryable = false;
  constructor(message: string, readonly code: string = 'NON_RETRYABLE') {
    super(message);
    this.name = 'NonRetryableError';
  }
}

export interface NormalizedError {
  message: string;
  stack?: string;
  retryable: boolean;
  code?: string;
}

const isValidationErrors = (e: unknown): e is any[] =>
  Array.isArray(e) && e.length > 0 && e.every((x) => x && typeof x === 'object' && 'property' in x);

/**
 * Turns whatever was thrown into something loggable.
 * Handles: Error, class-validator ValidationError[] (what validateOrReject throws), plain objects, strings.
 * Unknown errors default to retryable (the safe choice for SQS).
 */
export function normalizeError(err: unknown): NormalizedError {
  if (isValidationErrors(err)) {
    const details = err
      .map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`)
      .join('; ');
    return { message: `Validation failed -> ${details}`, retryable: false, code: 'VALIDATION_FAILED' };
  }
  if (err instanceof Error) {
    const e = err as any;
    return { message: err.message, stack: err.stack, retryable: e.retryable !== false, code: e.code };
  }
  if (err && typeof err === 'object') {
    const o = err as any;
    return {
      message: String(o.message ?? JSON.stringify(o)),
      retryable: o.retryable !== false,
      code: o.code,
    };
  }
  return { message: String(err), retryable: true };
}