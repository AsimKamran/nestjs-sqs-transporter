import { Controller } from '@nestjs/common';
import { EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { CreateOrderDto } from './dto/create-order.dto';
import { SQSRecord } from '../transporter/sqs-event.interface';
import { logger } from '../observability/observability';
import { NonRetryableError, normalizeError } from '../common/errors';

@Controller()
export class OrdersController {
  @EventPattern('order.created')
  async handleOrderCreated(@Payload() rawData: any, @Ctx() ctx: any) {
    const { record } = ctx as { record: SQSRecord; context: any };

    // 1. Validate DTO payload at runtime.
    //    A bad payload will never become valid on retry, so flag it as non-retryable.
    if (rawData === null || typeof rawData !== 'object') {
      throw new NonRetryableError('Payload is not a JSON object', 'INVALID_PAYLOAD');
    }
    const dto = plainToInstance(CreateOrderDto, rawData);
    const errors = await validate(dto);
    if (errors.length) {
      throw new NonRetryableError(normalizeError(errors).message, 'VALIDATION_FAILED');
    }

    // Structured fields instead of string interpolation: searchable in CloudWatch Insights
    logger.info('Processing order', {
      orderId: dto.orderId,
      amount: dto.amount,
      messageId: record?.messageId,
    });

    // 2. Perform business logic (wrap downstream calls with retry() / CircuitBreaker)
    return { status: 'PROCESSED', orderId: dto.orderId };
  }
}