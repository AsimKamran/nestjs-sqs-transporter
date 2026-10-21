import { IsString, IsNumber, IsNotEmpty, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @IsNumber()
  @Min(0.01, { message: 'Amount must be greater than zero.' })
  amount: number;
}