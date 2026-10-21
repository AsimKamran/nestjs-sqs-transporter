import { Server, CustomTransportStrategy } from '@nestjs/microservices';
import { isObservable, lastValueFrom } from 'rxjs';
import { logger } from '../observability/observability';
import { normalizeError, NonRetryableError } from '../common/errors';
import { SQSEvent, SQSRecord, SQSBatchResponse } from './sqs-event.interface';


export const powertoolsLogger = logger;

export class SqsServer extends Server implements CustomTransportStrategy {
  public listen(callback: () => void) {
    logger.info('SQS Custom Transporter listener initialized.');
    callback();
  }

  public close() {
    logger.info('SQS Custom Transporter closed.');
  }

  public on(event: string, callback: Function) {
    
  }

  public unwrap<T = any>(): T {
    return null as unknown as T;
  }

  
  public async handleRecord(record: SQSRecord, context: any): Promise<unknown> {
    const pattern = record.messageAttributes?.event_type?.stringValue;

    if (!pattern) {
      throw new NonRetryableError(
        `Missing "event_type" in MessageAttributes for message ID: ${record.messageId}`,
        'MISSING_EVENT_TYPE',
      );
    }

    const handler = this.getHandlerByPattern(pattern);
    if (!handler) {
      throw new NonRetryableError(`No handler registered for pattern: "${pattern}"`, 'NO_HANDLER');
    }

    let payload: any;
    try {
      payload = JSON.parse(record.body);
    } catch {
      payload = record.body;
    }

    const resultOrStream = await handler(payload, { record, context });
    // isObservable is safer than instanceof when rxjs gets bundled/duplicated
    return isObservable(resultOrStream) ? lastValueFrom(resultOrStream) : resultOrStream;
  }

  
  public async handleSqsEvent(event: SQSEvent, context: any): Promise<SQSBatchResponse> {
    logger.addContext(context);
    const records = event.Records ?? [];
    logger.info(`Processing SQS batch containing ${records.length} records.`);

    const results = await Promise.all(
      records.map(async (record) => {
        const startTime = Date.now();
        try {
          await this.handleRecord(record, context);
          logger.info('Successfully processed SQS message', {
            messageId: record.messageId,
            durationMs: Date.now() - startTime,
          });
          return true;
        } catch (error) {
          const e = normalizeError(error);
          logger.error('Failed to process SQS message', {
            messageId: record.messageId,
            errorMessage: e.message,
            errorCode: e.code,
            retryable: e.retryable,
            errorStack: e.stack,
            durationMs: Date.now() - startTime,
          });
          return false;
        }
      }),
    );

    const batchItemFailures = records
      .filter((_, i) => !results[i])
      .map((r) => ({ itemIdentifier: r.messageId }));
    logger.info(`Batch processing completed. Failures: ${batchItemFailures.length}`);
    return { batchItemFailures };
  }
}