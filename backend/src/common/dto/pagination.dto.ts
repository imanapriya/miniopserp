import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class PaginationDto {
  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @IsOptional()
  page = 1;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 200 })
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @IsOptional()
  limit = 25;

  get skip(): number {
    return (this.page - 1) * this.limit;
  }
}

export interface Paginated<T> {
  data: T[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export function paginated<T>(data: T[], total: number, dto: PaginationDto): Paginated<T> {
  return {
    data,
    meta: {
      page: dto.page,
      limit: dto.limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / dto.limit)),
    },
  };
}
