import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { InventoryService } from './inventory.service';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { StockAdjustmentDto, StockReceiptDto } from './dto/stock-receipt.dto';
import { PaginationDto } from '../common/dto/pagination.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums';
import { AuthUser } from '../common/types';

@ApiTags('Inventory')
@ApiBearerAuth()
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventory: InventoryService) {}

  @Get()
  @ApiOperation({ summary: 'List stock by item / location / batch with available quantity' })
  list(@Query() query: InventoryQueryDto) {
    return this.inventory.list(query);
  }

  @Get('reconcile')
  @Roles(Role.ADMIN)
  @ApiOperation({
    summary: 'Verify that stored balances match the ledger and the active reservations',
    description:
      'Returns balanced=true when every bucket agrees with the sum of its ledger deltas and its active reservations.',
  })
  @ApiForbiddenResponse({ description: 'Admin only' })
  reconcile() {
    return this.inventory.reconcile();
  }

  @Get(':id/transactions')
  @ApiOperation({ summary: 'Append-only movement history for one inventory record' })
  transactions(@Param('id', ParseUUIDPipe) id: string, @Query() pagination: PaginationDto) {
    return this.inventory.transactions(id, pagination);
  }

  @Post('receipt')
  @Roles(Role.ADMIN, Role.OPERATIONS)
  @ApiOperation({ summary: 'Receive stock into a location (creates the batch and bucket if new)' })
  @ApiOkResponse({ description: 'Updated balances for the affected bucket' })
  @ApiConflictResponse({ description: 'A receipt with the same reference has already been applied' })
  @ApiForbiddenResponse({ description: 'Sales users cannot change inventory' })
  receive(@Body() dto: StockReceiptDto, @CurrentUser() user: AuthUser) {
    return this.inventory.receive(dto, user.id);
  }

  @Post('adjustment')
  @Roles(Role.ADMIN, Role.OPERATIONS)
  @ApiOperation({ summary: 'Correct stock up or down (cycle count, write-off)' })
  @ApiForbiddenResponse({ description: 'Sales users cannot change inventory' })
  adjust(@Body() dto: StockAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.inventory.adjust(dto, user.id);
  }
}
