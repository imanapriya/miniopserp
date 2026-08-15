import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive, IsString, IsUUID, MaxLength } from 'class-validator';
import { WorkOrderStatus } from '../../common/enums';
import { PaginationDto } from '../../common/dto/pagination.dto';

export class CreateWorkOrderDto {
  @ApiProperty({ format: 'uuid', description: 'Where the work happens - material is consumed here' })
  @IsUUID()
  locationId: string;

  @ApiProperty({ format: 'uuid', description: 'Material the job consumes' })
  @IsUUID()
  itemId: string;

  @ApiProperty({ example: 50, minimum: 1 })
  @Type(() => Number)
  @IsInt({ message: 'Required quantity must be a whole number of units.' })
  @IsPositive({ message: 'Required quantity must be greater than zero.' })
  requiredQty: number;

  @ApiProperty({ format: 'uuid', description: 'Operations user responsible for the job' })
  @IsUUID()
  assignedToId: string;

  @ApiPropertyOptional()
  @IsString()
  @MaxLength(500)
  @IsOptional()
  notes?: string;
}

export class UpdateWorkOrderStatusDto {
  @ApiProperty({ enum: WorkOrderStatus, example: WorkOrderStatus.IN_PROGRESS })
  @IsEnum(WorkOrderStatus)
  status: WorkOrderStatus;
}

export class WorkOrderQueryDto extends PaginationDto {
  @ApiPropertyOptional({ enum: WorkOrderStatus })
  @IsEnum(WorkOrderStatus)
  @IsOptional()
  status?: WorkOrderStatus;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsUUID()
  @IsOptional()
  assignedToId?: string;
}
