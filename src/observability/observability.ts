import { Logger } from '@aws-lambda-powertools/logger';
import { Metrics, MetricUnit } from '@aws-lambda-powertools/metrics';

const serviceName = process.env.SERVICE_NAME ?? 'nestjs-sqs-worker';

export const logger = new Logger({
  serviceName,
  logLevel: (process.env.LOG_LEVEL ?? 'INFO') as any,
});

/** Emits CloudWatch Embedded Metric Format JSON to stdout (no API calls, no extra latency). */
export const metrics = new Metrics({
  namespace: process.env.METRICS_NAMESPACE ?? 'SqsWorker',
  serviceName,
});

export { MetricUnit };