import { logger } from '../observability/observability';
import { IdempotencyStore, InMemoryIdempotencyStore } from './Idempotency.store';

export async function createIdempotencyStore(table?: string): Promise<IdempotencyStore> {
  if (!table) {
    if (process.env.NODE_ENV === 'production') {
      logger.warn('IDEMPOTENCY_TABLE not set: using in-memory store, duplicates across Lambda containers are NOT prevented');
    }
    return new InMemoryIdempotencyStore();
  }
  // Lazy import: the AWS SDK is only loaded when a table is configured.
  const { DynamoIdempotencyStore } = await import('./dynamodb-idempotency.store');
  return new DynamoIdempotencyStore(table);
}