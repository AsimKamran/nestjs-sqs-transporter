import { Server, CustomTransportStrategy } from '@nestjs/microservices';
import { Observable, lastValueFrom } from 'rxjs';
import { SQSEvent, SQSRecord, SQSBatchResponse } from './sqs-event.interface';

export class SqsServer extends Server implements CustomTransportStrategy {
  public listen(callback: () => void) {
    this.logger.log('SQS Custom Transporter listener initialized.');
    callback();
  }

  public close() {
    this.logger.log('SQS Custom Transporter closed.');
  }

  /**
   * Required by NestJS Server abstract class:
   * Handles internal event registration (No-op in Lambda contexts).
   */
  public on(event: string, callback: Function) {
    // Left empty as Lambda receives events imperatively per invocation
  }

  /**
   * Required by NestJS Server abstract class:
   * Exposes driver instance (Returns null as Lambda has no persistent driver).
   */
  public unwrap<T = any>(): T {
    return null as unknown as T;
  }

  /**
   * Called by the Lambda entry point to process an SQS event batch.
   */
  public async handleSqsEvent(event: SQSEvent, context: any): Promise<SQSBatchResponse> {
    const failedMessageIds: string[] = [];

    // Process all messages concurrently within the SQS batch
    await Promise.all(
      event.Records.map(async (record: SQSRecord) => {
        try {
          await this.processRecord(record, context);
        } catch (error) {
          this.logger.error(`Error processing SQS message ${record.messageId}:`, error);
          // Register failed message ID for AWS SQS partial batch retry
          failedMessageIds.push(record.messageId);
        }
      })
    );

    return {
      batchItemFailures: failedMessageIds.map((id) => ({ itemIdentifier: id })),
    };
  }

  private async processRecord(record: SQSRecord, context: any): Promise<any> {
    // Extract routing pattern from SQS MessageAttributes (e.g. event_type = "order.created")
    const pattern = record.messageAttributes?.event_type?.stringValue;

    if (!pattern) {
      throw new Error(`Missing "event_type" in MessageAttributes for message ID: ${record.messageId}`);
    }

    const handler = this.getHandlerByPattern(pattern);
    if (!handler) {
      throw new Error(`No handler registered for pattern: "${pattern}"`);
    }

    // Safely parse JSON body payload
    let payload: any;
    try {
      payload = JSON.parse(record.body);
    } catch {
      payload = record.body;
    }

    const executionContext = { record, context };

    // Execute the NestJS controller handler
    const resultOrStream = await handler(payload, executionContext);

    if (resultOrStream instanceof Observable) {
      return await lastValueFrom(resultOrStream);
    }

    return resultOrStream;
  }
}