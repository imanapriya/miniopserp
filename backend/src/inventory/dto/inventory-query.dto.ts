import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBooleanString, IsOptional, IsString, IsUUID } from 'class-validator';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class InventoryQueryDto extends PaginationDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  itemId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  categoryId?: string;

  @ApiPropertyOptional({ description: 'Free-text search over SKU, item name and batch code' })
  @IsString()
  @IsOptional()
  q?: string;

  @ApiPropertyOptional({ description: 'When "true", only rows with availableQty = 0' })
  @IsBooleanString()
  @IsOptional()
  outOfStock?: string;
}
