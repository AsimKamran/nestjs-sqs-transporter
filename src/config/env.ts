import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, Min, validateSync } from 'class-validator';

export class EnvSchema {
  @IsIn(['development', 'test', 'production'])
  NODE_ENV: string = 'development';

  @IsString() @IsNotEmpty()
  SERVICE_NAME: string = 'nestjs-sqs-worker';

  @IsIn(['DEBUG', 'INFO', 'WARN', 'ERROR', 'SILENT'])
  LOG_LEVEL: string = 'INFO';

  @IsString() @IsNotEmpty()
  METRICS_NAMESPACE: string = 'SqsWorker';

  @IsInt() @Min(1) @Max(100)
  BATCH_CONCURRENCY: number = 5;

  /** Stop starting new records when fewer than this many ms remain. */
  @IsInt() @Min(0)
  TIMEOUT_SAFETY_MS: number = 5000;

  @IsOptional() @IsString()
  IDEMPOTENCY_TABLE?: string;

  @IsInt() @Min(1)
  IDEMPOTENCY_RETENTION_SEC: number = 86400;

  @IsInt() @Min(1)
  IDEMPOTENCY_LOCK_SEC: number = 900;
}

export function validateEnv(source: NodeJS.ProcessEnv = process.env): EnvSchema {
  // Treat empty strings (e.g. "IDEMPOTENCY_TABLE=") as unset.
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const env = plainToInstance(EnvSchema, cleaned, { enableImplicitConversion: true, exposeDefaultValues: true });
  const errors = validateSync(env);
  if (errors.length) {
    const details = errors.map((e) => `${e.property}: ${Object.values(e.constraints ?? {}).join(', ')}`).join('; ');
    throw new Error(`Invalid environment configuration -> ${details}`);
  }
  return env;
}