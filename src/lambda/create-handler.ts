import type { Context } from 'aws-lambda';
import { SQSBatchResponse, SQSEvent } from '../transporter/sqs-event.interface';
import { IdempotencyStore } from '../idempotency/Idempotency.store';
import { logger, metrics, MetricUnit } from '../observability/observability';
import { normalizeError } from '../common/errors';

type SqsRecord = SQSEvent['Records'][number];
type Outcome = 'ok' | 'duplicate' | 'failed' | 'skipped';

/** Anything that can process ONE SQS record and throw on failure, i.e. your SqsServer. */
export interface SqsProcessor {
  handleRecord(record: SqsRecord, context: any): Promise<unknown>;
}

export interface HandlerOptions {
  bootstrap: () => Promise<SqsProcessor>;
  getIdempotencyStore?: () => Promise<IdempotencyStore | undefined>;
  /** Max groups (FIFO) / records (standard) processed in parallel. */
  concurrency: number;
  /** Don't start new work when fewer than this many ms remain. */
  timeoutSafetyMs: number;
  idempotencyRetentionMs: number;
  idempotencyLockMs: number;
}

async function runPool<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await fn(items[next++]);
  });
  await Promise.all(workers);
}

const remainingMs = (ctx: any): number =>
  typeof ctx?.getRemainingTimeInMillis === 'function' ? ctx.getRemainingTimeInMillis() : Number.POSITIVE_INFINITY;

/**
 * Production wrapper around the Nest transporter:
 *  - cached bootstrap promise (no cold-start race, failed init is retried next invoke)
 *  - bounded concurrency, FIFO-safe ordering per MessageGroupId
 *  - per-record idempotency (key = `idempotency_key` message attribute, else messageId)
 *  - Lambda timeout guard: unstarted records are returned as failures, not lost
 *  - partial batch response + structured logs + EMF metrics
 */
export function createHandler(opts: HandlerOptions) {
  let initPromise: Promise<{ processor: SqsProcessor; store?: IdempotencyStore }> | undefined;

  const init = () =>
    (initPromise ??= (async () => {
      const t0 = Date.now();
      const [processor, store] = await Promise.all([opts.bootstrap(), opts.getIdempotencyStore?.()]);
      logger.info('Cold start complete', { bootstrapMs: Date.now() - t0 });
      metrics.addMetric('ColdStartInitMs', MetricUnit.Milliseconds, Date.now() - t0);
      return { processor, store };
    })().catch((err) => {
      initPromise = undefined; // allow retry on the next invocation
      throw err;
    }));

  async function processRecord(
    processor: SqsProcessor,
    store: IdempotencyStore | undefined,
    record: SqsRecord,
    context: any,
  ): Promise<Outcome> {
    if (remainingMs(context) < opts.timeoutSafetyMs) return 'skipped';

    const attrs: any = record.messageAttributes ?? {};
    const queue = String(record.eventSourceARN ?? 'queue').split(':').pop();
    const key = `${queue}:${attrs.idempotency_key?.stringValue ?? record.messageId}`;
    let locked = false;
    const startedAt = Date.now();

    try {
      if (store) {
        const state = await store.begin(key, opts.idempotencyLockMs);
        if (state === 'completed') return 'duplicate';
        if (state === 'in_progress') return 'failed'; // another invocation owns it; retry later
        locked = true;
      }
      await processor.handleRecord(record, context);
      if (locked) await store!.complete(key, opts.idempotencyRetentionMs);
      logger.info('Successfully processed SQS message', {
        messageId: record.messageId,
        durationMs: Date.now() - startedAt,
      });
      return 'ok';
    } catch (err) {
      const e = normalizeError(err);
      logger.error('Failed to process SQS message', {
        messageId: record.messageId,
        errorMessage: e.message,
        errorCode: e.code,
        retryable: e.retryable,
        errorStack: e.stack,
        durationMs: Date.now() - startedAt,
      });
      if (!e.retryable) metrics.addMetric('RecordsNonRetryable', MetricUnit.Count, 1);
      if (locked) await store!.release(key).catch(() => undefined);
      return 'failed';
    }
  }

  return async function handler(event: SQSEvent, context: Context | any): Promise<SQSBatchResponse> {
    const started = Date.now();
    logger.addContext(context as Context);
    const counts: Record<Outcome, number> = { ok: 0, duplicate: 0, failed: 0, skipped: 0 };
    const failed = new Set<string>();

    try {
      const { processor, store } = await init();

      // Group by MessageGroupId (FIFO); standard queues get one group per message => full parallelism.
      const groups = new Map<string, SqsRecord[]>();
      for (const r of event.Records) {
        const gid = (r.attributes as any)?.MessageGroupId ?? r.messageId;
        (groups.get(gid) ?? groups.set(gid, []).get(gid)!).push(r);
      }

      await runPool([...groups.values()], opts.concurrency, async (group) => {
        let broken = false;
        for (const record of group) {
          if (broken) {
            // FIFO rule: after the first failure, everything later in the group must be retried too.
            failed.add(record.messageId);
            counts.skipped++;
            continue;
          }
          const outcome = await processRecord(processor, store, record, context);
          counts[outcome]++;
          if (outcome === 'failed' || outcome === 'skipped') {
            failed.add(record.messageId);
            broken = true;
          }
        }
      });

      logger.info('Batch processed', { received: event.Records.length, ...counts });
      return {
        batchItemFailures: event.Records.filter((r) => failed.has(r.messageId)).map((r) => ({
          itemIdentifier: r.messageId,
        })),
      };
    } finally {
      metrics.addMetric('RecordsReceived', MetricUnit.Count, event.Records.length);
      metrics.addMetric('RecordsSucceeded', MetricUnit.Count, counts.ok);
      metrics.addMetric('RecordsFailed', MetricUnit.Count, counts.failed + counts.skipped);
      metrics.addMetric('RecordsDuplicate', MetricUnit.Count, counts.duplicate);
      metrics.addMetric('BatchDurationMs', MetricUnit.Milliseconds, Date.now() - started);
      metrics.publishStoredMetrics();
    }
  };
}