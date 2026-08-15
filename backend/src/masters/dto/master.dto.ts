import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { Transform } from 'class-transformer';

const upperTrim = ({ value }: { value: any }) =>
  typeof value === 'string' ? value.trim().toUpperCase() : value;

export class CreateLocationDto {
  @ApiProperty({ example: 'WH-C' })
  @Transform(upperTrim)
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code: string;

  @ApiProperty({ example: 'Warehouse C - Pune' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;
}

export class CreateCategoryDto {
  @ApiProperty({ example: 'PACK' })
  @Transform(upperTrim)
  @IsString()
  @MinLength(2)
  @MaxLength(32)
  code: string;

  @ApiProperty({ example: 'Packaging' })
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name: string;
}

export class CreateItemDto {
  @ApiProperty({ example: 'BOX-STD-01' })
  @Transform(upperTrim)
  @IsString()
  @MinLength(2)
  @MaxLength(64)
  sku: string;

  @ApiProperty({ example: 'Standard Carton Box' })
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  categoryId: string;

  @ApiPropertyOptional({ example: 'EA', default: 'EA' })
  @Transform(upperTrim)
  @IsString()
  @MaxLength(16)
  @IsOptional()
  uom?: string;
}

export class CreateBatchDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 'B-2026-09' })
  @IsString()
  @MinLength(1)
  @MaxLength(64)
  code: string;

  @ApiPropertyOptional({ example: '2027-06-30' })
  @IsDateString()
  @IsOptional()
  expiryDate?: string;
}
