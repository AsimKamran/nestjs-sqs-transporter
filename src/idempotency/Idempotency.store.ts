export type BeginResult = 'acquired' | 'in_progress' | 'completed';

export interface IdempotencyStore {
  /** Atomically claim a key. Expired locks / expired completions can be re-claimed. */
  begin(key: string, lockMs: number): Promise<BeginResult>;
  /** Mark the key as successfully processed for `retentionMs`. */
  complete(key: string, retentionMs: number): Promise<void>;
  /** Release the lock after a failure so a retry can run. */
  release(key: string): Promise<void>;
}

/** Single-process store for local dev / tests. NOT safe across Lambda containers. */
export class InMemoryIdempotencyStore implements IdempotencyStore {
  private readonly items = new Map<string, { status: 'IN_PROGRESS' | 'COMPLETED'; expiresAt: number }>();

  async begin(key: string, lockMs: number): Promise<BeginResult> {
    const now = Date.now();
    const item = this.items.get(key);
    if (item && item.expiresAt > now) {
      return item.status === 'COMPLETED' ? 'completed' : 'in_progress';
    }
    this.items.set(key, { status: 'IN_PROGRESS', expiresAt: now + lockMs });
    return 'acquired';
  }

  async complete(key: string, retentionMs: number): Promise<void> {
    this.items.set(key, { status: 'COMPLETED', expiresAt: Date.now() + retentionMs });
  }

  async release(key: string): Promise<void> {
    this.items.delete(key);
  }
}