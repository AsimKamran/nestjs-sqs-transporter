
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { handler } from '../src/main';

const PORT = Number(process.env.LOCAL_SQS_PORT ?? 3001);
const BATCH_SIZE = Number(process.env.LOCAL_BATCH_SIZE ?? 10);
const POLL_MS = Number(process.env.LOCAL_POLL_MS ?? 1000);
const RETRY_DELAY_MS = Number(process.env.LOCAL_RETRY_DELAY_MS ?? 3000); // simulated visibility timeout
const MAX_RECEIVE = Number(process.env.LOCAL_MAX_RECEIVE_COUNT ?? 3);
const FUNCTION_TIMEOUT_MS = 30_000;
const QUEUE_ARN = 'arn:aws:sqs:us-east-1:000000000000:local-queue';

interface Msg {
  messageId: string;
  body: string;
  eventType?: string;
  groupId?: string;
  attributes: Record<string, string>;
  visibleAt: number;
  receiveCount: number;
  sentAt: number;
}

const queue: Msg[] = [];
const dlq: Msg[] = [];

function enqueue(input: any): string {
  const msg: Msg = {
    messageId: input.messageId ?? randomUUID(),
    body: typeof input.body === 'string' ? input.body : JSON.stringify(input.body ?? {}),
    eventType: input.eventType,
    groupId: input.groupId,
    attributes: input.attributes ?? {},
    visibleAt: Date.now() + (input.delaySeconds ?? 0) * 1000,
    receiveCount: 0,
    sentAt: Date.now(),
  };
  queue.push(msg);
  return msg.messageId;
}

function toRecord(m: Msg): any {
  const messageAttributes: Record<string, any> = {};
  if (m.eventType) messageAttributes.event_type = { stringValue: m.eventType, dataType: 'String' };
  for (const [k, v] of Object.entries(m.attributes)) messageAttributes[k] = { stringValue: v, dataType: 'String' };
  return {
    messageId: m.messageId,
    receiptHandle: randomUUID(),
    body: m.body,
    attributes: {
      ApproximateReceiveCount: String(m.receiveCount),
      SentTimestamp: String(m.sentAt),
      ...(m.groupId ? { MessageGroupId: m.groupId } : {}),
    },
    messageAttributes,
    md5OfBody: '',
    eventSource: 'aws:sqs',
    eventSourceARN: QUEUE_ARN,
    awsRegion: 'us-east-1',
  };
}

let polling = false;
async function poll() {
  if (polling) return; // Lambda-style: one batch at a time per poller
  polling = true;
  try {
    const now = Date.now();
    const batch = queue.filter((m) => m.visibleAt <= now).slice(0, BATCH_SIZE);
    if (!batch.length) return;

    for (const m of batch) {
      m.receiveCount++;
      m.visibleAt = now + RETRY_DELAY_MS; // in-flight until deleted or timeout elapses
    }

    const deadline = Date.now() + FUNCTION_TIMEOUT_MS;
    const context = {
      awsRequestId: randomUUID(),
      functionName: 'local-sqs-worker',
      memoryLimitInMB: '512',
      invokedFunctionArn: 'arn:aws:lambda:us-east-1:000000000000:function:local-sqs-worker',
      logGroupName: '/aws/lambda/local',
      logStreamName: 'local',
      callbackWaitsForEmptyEventLoop: true,
      getRemainingTimeInMillis: () => deadline - Date.now(),
    };

    const failedIds = new Set<string>();
    try {
      const res = await handler({ Records: batch.map(toRecord) } as any, context);
      res?.batchItemFailures?.forEach((f) => failedIds.add(f.itemIdentifier));
    } catch (err) {
      console.error('💥 Handler threw — whole batch returns to queue:', err);
      batch.forEach((m) => failedIds.add(m.messageId));
    }

    for (const m of batch) {
      if (!failedIds.has(m.messageId)) {
        queue.splice(queue.indexOf(m), 1); // deleted
      } else if (m.receiveCount >= MAX_RECEIVE) {
        queue.splice(queue.indexOf(m), 1);
        dlq.push(m);
        console.warn(`☠️  ${m.messageId} moved to DLQ after ${m.receiveCount} receives`);
      } else {
        console.warn(`↩️  ${m.messageId} will be redelivered (receive ${m.receiveCount}/${MAX_RECEIVE})`);
      }
    }
  } finally {
    polling = false;
  }
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => (data += c));
    req.on('end', () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (e) {
        reject(e);
      }
    });
  });
}

const send = (res: http.ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(payload, null, 2));
};

http
  .createServer(async (req, res) => {
    try {
      if (req.method === 'POST' && req.url === '/send') {
        const input = await readJson(req);
        const count = Math.min(Number(input.count ?? 1), 1000); // count > 1 for quick load tests
        const ids = Array.from({ length: count }, () => enqueue({ ...input, messageId: count === 1 ? input.messageId : undefined }));
        return send(res, 200, { enqueued: ids.length, messageIds: ids.slice(0, 20) });
      }
      if (req.method === 'GET' && req.url === '/stats') {
        const now = Date.now();
        return send(res, 200, {
          visible: queue.filter((m) => m.visibleAt <= now).length,
          inFlightOrDelayed: queue.filter((m) => m.visibleAt > now).length,
          dlq: dlq.length,
        });
      }
      if (req.method === 'GET' && req.url === '/dlq') return send(res, 200, dlq);
      if (req.method === 'POST' && req.url === '/dlq/redrive') {
        const moved = dlq.splice(0, dlq.length).map((m) => ({ ...m, receiveCount: 0, visibleAt: 0 }));
        queue.push(...moved);
        return send(res, 200, { redriven: moved.length });
      }
      send(res, 404, { error: 'not found' });
    } catch (err: any) {
      send(res, 400, { error: err?.message });
    }
  })
  .listen(PORT, () => {
    console.log(`🧪 Local SQS emulator on http://localhost:${PORT}`);
    console.log(`   POST /send | GET /stats | GET /dlq | POST /dlq/redrive`);
  });

setInterval(() => void poll(), POLL_MS);