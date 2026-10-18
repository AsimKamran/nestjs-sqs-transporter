// src/orders/orders.controller.ts
import { Controller, Logger } from '@nestjs/common';
import { EventPattern, Payload, Ctx } from '@nestjs/microservices';
import { SQSRecord } from '../transporter/sqs-event.interface';

@Controller()
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);

  @EventPattern('order.created')
  async handleOrderCreated(
    @Payload() data: { orderId: string; amount: number },
    @Ctx() ctx: any, // 👈 Use 'any' here to satisfy the @EventPattern decorator signature
  ) {
    // Type-cast context internally for type safety
    const { record } = ctx as { record: SQSRecord; context: any };

    this.logger.log(`Processing Order [${data.orderId}] from SQS Message ID: ${record?.messageId}`);

    if (!data.amount || data.amount <= 0) {
      throw new Error(`Invalid order amount for order ${data.orderId}`);
    }

    return { status: 'PROCESSED', orderId: data.orderId };
  }

  @EventPattern('order.cancelled')
  async handleOrderCancelled(@Payload() data: { orderId: string }) {
    this.logger.log(`Handling cancellation for Order [${data.orderId}]`);
    return { status: 'CANCELLED', orderId: data.orderId };
  }
}