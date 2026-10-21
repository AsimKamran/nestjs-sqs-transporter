import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SqsServer } from './transporter/sqs.server';
import { createHandler } from './lambda/create-handler';
import { validateEnv } from './config/env';
import { createIdempotencyStore } from './idempotency/create-store';
import { PassThroughRpcFilter } from './common/passthrough-rpc.filter';

// Fail fast during Lambda init if configuration is wrong.
const env = validateEnv();

async function bootstrap(): Promise<SqsServer> {
  const sqsServer = new SqsServer();
  const app = await NestFactory.createMicroservice(AppModule, {
    strategy: sqsServer,
    logger: env.NODE_ENV === 'production' ? ['error', 'warn'] : ['log', 'error', 'warn', 'debug'],
  });
  app.useGlobalFilters(new PassThroughRpcFilter()); // keep original errors for logging/classification
  await app.listen();
  return sqsServer; // only returned once fully initialised
}

export const handler = createHandler({
  bootstrap,
  getIdempotencyStore: () => createIdempotencyStore(env.IDEMPOTENCY_TABLE),
  concurrency: env.BATCH_CONCURRENCY,
  timeoutSafetyMs: env.TIMEOUT_SAFETY_MS,
  idempotencyRetentionMs: env.IDEMPOTENCY_RETENTION_SEC * 1000,
  idempotencyLockMs: env.IDEMPOTENCY_LOCK_SEC * 1000,
});