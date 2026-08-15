import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrdersService } from './orders.service';
import { CreateOrderDto, OrderQueryDto } from './dto/order.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums';
import { AuthUser } from '../common/types';

@ApiTags('Customer orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  @Roles(Role.SALES, Role.ADMIN)
  @ApiOperation({
    summary: 'Create a customer order (Sales)',
    description: 'Pass reserveImmediately=true to allocate stock in the same database transaction.',
  })
  @ApiConflictResponse({ description: 'Not enough available stock to reserve' })
  @ApiForbiddenResponse({ description: 'Operations users cannot raise customer orders' })
  create(@Body() dto: CreateOrderDto, @CurrentUser() user: AuthUser) {
    return this.orders.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List customer orders with their lines' })
  list(@Query() query: OrderQueryDto) {
    return this.orders.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Order detail including active reservations per line' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.detail(id);
  }

  @Post(':id/reserve')
  @Roles(Role.SALES, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reserve stock for the order',
    description:
      'Allocates FEFO across batches under a row lock. All lines succeed or the whole request rolls back - ' +
      'two users can never reserve more stock than physically exists.',
  })
  @ApiConflictResponse({ description: 'Insufficient available stock, or the order is already reserved' })
  reserve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.reserve(id, user.id);
  }

  @Post(':id/cancel')
  @Roles(Role.SALES, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel the order and release its reserved stock back to available',
  })
  @ApiConflictResponse({ description: 'Already cancelled, or already fulfilled' })
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.cancel(id, user.id);
  }

  @Post(':id/fulfil')
  @Roles(Role.SALES, Role.ADMIN)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Ship the order: reserved stock physically leaves inventory',
  })
  @ApiConflictResponse({ description: 'Order is not in RESERVED state' })
  fulfil(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.orders.fulfil(id, user.id);
  }
}
