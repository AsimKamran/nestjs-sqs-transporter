export class CircuitOpenError extends Error {
  constructor(name: string) {
    super(`Circuit "${name}" is open`);
    this.name = 'CircuitOpenError';
  }
}

export interface CircuitBreakerOptions {
  name: string;
  failureThreshold?: number; // consecutive failures before opening (default 5)
  resetTimeoutMs?: number;   // how long to stay open before a probe (default 30s)
}

export class CircuitBreaker {
  private state: 'closed' | 'open' | 'half_open' = 'closed';
  private failures = 0;
  private openedAt = 0;
  private probing = false;
  private readonly threshold: number;
  private readonly resetMs: number;

  constructor(private readonly opts: CircuitBreakerOptions) {
    this.threshold = opts.failureThreshold ?? 5;
    this.resetMs = opts.resetTimeoutMs ?? 30_000;
  }

  async exec<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.resetMs) throw new CircuitOpenError(this.opts.name);
      this.state = 'half_open';
    }
    if (this.state === 'half_open') {
      if (this.probing) throw new CircuitOpenError(this.opts.name); // only one probe at a time
      this.probing = true;
    }
    try {
      const result = await fn();
      this.failures = 0;
      this.state = 'closed';
      return result;
    } catch (err) {
      this.failures++;
      if (this.state === 'half_open' || this.failures >= this.threshold) {
        this.state = 'open';
        this.openedAt = Date.now();
      }
      throw err;
    } finally {
      this.probing = false;
    }
  }
}