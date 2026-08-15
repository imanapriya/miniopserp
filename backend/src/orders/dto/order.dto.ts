import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { OrderStatus } from '../../common/enums';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateOrderLineDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ format: 'uuid', description: 'Location the customer is served from' })
  @IsUUID()
  locationId: string;

  @ApiProperty({ example: 40, minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: 'Quantity must be a whole number of units.' })
  @IsPositive({ message: 'Quantity must be greater than zero.' })
  quantity: number;
}

export class CreateOrderDto {
  @ApiProperty({ example: 'Acme Industries' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  customerName: string;

  @ApiProperty({ type: [CreateOrderLineDto] })
  @IsArray()
  @ArrayMinSize(1, { message: 'An order needs at least one line.' })
  @ValidateNested({ each: true })
  @Type(() => CreateOrderLineDto)
  lines: CreateOrderLineDto[];

  @ApiPropertyOptional({
    default: false,
    description: 'Reserve stock as part of the same transaction that creates the order.',
  })
  @IsBoolean()
  @IsOptional()
  reserveImmediately?: boolean;
}

export class OrderQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: OrderStatus })
  @IsEnum(OrderStatus)
  @IsOptional()
  status?: OrderStatus;

  @ApiPropertyOptional()
  @IsString()
  @IsOptional()
  customerName?: string;
}
