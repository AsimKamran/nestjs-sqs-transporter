// One-shot local test: npm run test:local
import { handler } from '../src/main';

const record = (messageId: string, payload: object) =>
  ({
    messageId,
    receiptHandle: `receipt-${messageId}`,
    body: JSON.stringify(payload),
    attributes: {} as any,
    messageAttributes: { event_type: { stringValue: 'order.created', dataType: 'String' } },
    eventSourceARN: 'arn:aws:sqs:us-east-1:123456789012:orders-queue',
  }) as any;

const mockSqsEvent = {
  Records: [
    record('msg-success-101', { orderId: 'ORD-123', amount: 250 }), // should succeed
    record('msg-failed-102', { orderId: 'ORD-999', amount: -50 }), // should fail -> batchItemFailures
  ],
};

const mockContext = () => {
  const deadline = Date.now() + 30_000;
  return {
    awsRequestId: 'local-test-request-id-001',
    functionName: 'nestjs-sqs-worker',
    getRemainingTimeInMillis: () => deadline - Date.now(),
  };
};

async function run() {
  console.log('🚀 Invocation #1 (expect: 101 ok, 102 failed)\n');
  console.log(JSON.stringify(await handler(mockSqsEvent as any, mockContext()), null, 2));

  console.log('\n🔁 Invocation #2 — redelivery (expect: 101 skipped as duplicate, 102 failed again)\n');
  console.log(JSON.stringify(await handler(mockSqsEvent as any, mockContext()), null, 2));
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});