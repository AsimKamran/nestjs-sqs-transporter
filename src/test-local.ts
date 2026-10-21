// src/test-local.ts
import { handler } from './main'; // 👈 Updated relative import path
import { SQSEvent } from './transporter/sqs-event.interface';

const mockSqsEvent: SQSEvent = {
  Records: [
    {
      messageId: 'msg-success-101',
      receiptHandle: 'receipt-handle-1',
      body: JSON.stringify({ orderId: 'ORD-123', amount: 250 }),
      attributes: {} as any,
      messageAttributes: {
        event_type: {
          stringValue: 'order.created',
          dataType: 'String',
        },
      },
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:orders-queue',
    },
    {
      messageId: 'msg-failed-102',
      receiptHandle: 'receipt-handle-2',
      body: JSON.stringify({ orderId: 'ORD-999', amount: -50 }),
      attributes: {} as any,
      messageAttributes: {
        event_type: {
          stringValue: 'order.created',
          dataType: 'String',
        },
      },
      eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:orders-queue',
    },
  ],
};

async function runLocalTest() {
  console.log('🚀 Invoking NestJS SQS Transporter locally...\n');
  const mockContext = { awsRequestId: 'local-test-request-id-001' };

  const result = await handler(mockSqsEvent, mockContext);

  console.log('\n========================================');
  console.log('RESULT RETURNED TO AWS SQS:');
  console.log(JSON.stringify(result, null, 2));
  console.log('========================================');
}

runLocalTest();