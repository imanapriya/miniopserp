import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { WorkOrdersService } from './work-orders.service';
import {
  CreateWorkOrderDto,
  UpdateWorkOrderStatusDto,
  WorkOrderQueryDto,
} from './dto/work-order.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums';
import { AuthUser } from '../common/types';

@ApiTags('Work orders')
@ApiBearerAuth()
@Controller('work-orders')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post()
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Create a work order (Admin only)',
    description: 'The response includes the automatically calculated material shortage.',
  })
  @ApiForbiddenResponse({ description: 'Only Admin may create work orders' })
  create(@Body() dto: CreateWorkOrderDto, @CurrentUser() user: AuthUser) {
    return this.workOrders.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List work orders with live availability and shortage' })
  list(@Query() query: WorkOrderQueryDto) {
    return this.workOrders.list(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Work order detail, including shortage and suggested transfer sources',
  })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.workOrders.detail(id);
  }

  @Patch(':id/status')
  @Roles(Role.ADMIN, Role.OPERATIONS)
  @ApiOperation({
    summary: 'Advance the work order',
    description:
      'ASSIGNED to IN_PROGRESS reserves the required material; IN_PROGRESS to COMPLETED consumes it. ' +
      'Both happen in a single database transaction with the status change.',
  })
  @ApiConflictResponse({ description: 'Invalid transition, or not enough stock to reserve' })
  @ApiForbiddenResponse({ description: 'Sales users cannot progress work orders' })
  updateStatus(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateWorkOrderStatusDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.workOrders.updateStatus(id, dto, user.id);
  }
}
