import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { SqsServer } from './transporter/sqs.server';
import { SQSEvent, SQSBatchResponse } from './transporter/sqs-event.interface';

let sqsServer: SqsServer;

async function bootstrap() {
  sqsServer = new SqsServer();

  const app = await NestFactory.createMicroservice(AppModule, {
    strategy: sqsServer,
  });

  await app.listen();
}

/**
 * AWS Lambda Exported Handler Function
 */
export const handler = async (event: SQSEvent, context: any): Promise<SQSBatchResponse> => {
  // Cold Start Check: Initialize NestJS Container once per Lambda instance lifecycle
  if (!sqsServer) {
    await bootstrap();
  }

  // Delegate processing to the custom transporter strategy
  return sqsServer.handleSqsEvent(event, context);
};