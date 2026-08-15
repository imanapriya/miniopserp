import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive, IsUUID } from 'class-validator';
import { TransferStatus } from '../../common/enums';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateTransferDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  sourceLocationId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  destinationLocationId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ format: 'uuid', description: 'Batch being moved - stock is batch-tracked end to end' })
  @IsUUID()
  batchId: string;

  @ApiProperty({ example: 20, minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: 'Quantity must be a whole number of units.' })
  @IsPositive({ message: 'Quantity must be greater than zero.' })
  quantity: number;

  @ApiPropertyOptional({ format: 'uuid', description: 'Work order whose shortage this transfer covers' })
  @IsUUID()
  @IsOptional()
  workOrderId?: string;
}

export class ReceiveTransferDto {
  @ApiPropertyOptional({
    example: 12,
    minimum: 1,
    description:
      'Units actually received. Omit to receive the full outstanding quantity. ' +
      'Supplying less records a partial receipt and leaves the transfer open.',
  })
  @Type(() => Number)
  @IsInt({ message: 'Quantity must be a whole number of units.' })
  @IsPositive({ message: 'Quantity must be greater than zero.' })
  @IsOptional()
  quantity?: number;
}

export class TransferQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: TransferStatus })
  @IsEnum(TransferStatus)
  @IsOptional()
  status?: TransferStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  sourceLocationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  destinationLocationId?: string;
}
