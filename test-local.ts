// test-local.ts
import { handler } from './src/main';
import { SQSEvent } from './src/transporter/sqs-event.interface';

// Mock SQS Event Batch simulating 2 messages from AWS SQS:
// Message 1: Valid payload (should succeed)
// Message 2: Invalid payload with negative amount (should fail & return in batchItemFailures)
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

  // Simulated AWS Lambda Context object
  const mockContext = {
    awsRequestId: 'local-test-request-id-001',
    functionName: 'nestjs-sqs-worker',
  };

  const result = await handler(mockSqsEvent, mockContext);

  console.log('\n========================================');
  console.log('RESULT RETURNED TO AWS SQS:');
  console.log(JSON.stringify(result, null, 2));
  console.log('========================================');
}

runLocalTest().catch((err) => {
  console.error('Test execution error:', err);
});