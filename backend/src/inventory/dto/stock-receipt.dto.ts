import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  NotEquals,
} from 'class-validator';

export class StockReceiptDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  locationId: string;

  @ApiPropertyOptional({ format: 'uuid', description: 'Existing batch. Omit to create/reuse one by code.' })
  @IsUUID()
  @IsOptional()
  batchId?: string;

  @ApiPropertyOptional({ example: 'B-2026-04', description: 'Batch code. Created if it does not exist for this item.' })
  @IsString()
  @MaxLength(64)
  @IsOptional()
  batchCode?: string;

  @ApiPropertyOptional({ example: '2027-01-31', description: 'Only used when creating a new batch' })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;

  @ApiProperty({ example: 100, minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: 'Quantity must be a whole number of units.' })
  @IsPositive({ message: 'Quantity must be greater than zero.' })
  quantity: number;

  @ApiPropertyOptional({ description: 'Supply a stable value to make a retried receipt safe to send twice.' })
  @IsString()
  @MaxLength(120)
  @IsOptional()
  reference?: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(255)
  @IsOptional()
  note?: string;
}

export class StockAdjustmentDto {
  @ApiProperty({ format: 'uuid', description: 'The inventory bucket to correct' })
  @IsUUID()
  inventoryId: string;

  @ApiProperty({
    example: -5,
    description: 'Signed change to physical stock. Negative writes stock off, positive adds it.',
  })
  @Type(() => Number)
  @IsInt({ message: 'Adjustment must be a whole number of units.' })
  @NotEquals(0, { message: 'Adjustment cannot be zero.' })
  @Min(-1_000_000)
  delta: number;

  @ApiProperty({ example: 'Cycle count correction', description: 'Adjustments must always be explained.' })
  @IsString()
  @MaxLength(255)
  reason: string;
}
