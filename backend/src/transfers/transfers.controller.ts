import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiConflictResponse,
  ApiForbiddenResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { TransfersService } from './transfers.service';
import { CreateTransferDto, ReceiveTransferDto, TransferQueryDto } from './dto/transfer.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { Role } from '../common/enums';
import { AuthUser } from '../common/types';

@ApiTags('Internal transfers')
@ApiBearerAuth()
@Controller('transfers')
export class TransfersController {
  constructor(private readonly transfers: TransfersService) {}

  @Post()
  @Roles(Role.ADMIN, Role.OPERATIONS)
  @ApiOperation({ summary: 'Raise an internal transfer (status REQUESTED - no stock moves yet)' })
  @ApiConflictResponse({ description: 'Requested quantity exceeds availability at the source' })
  @ApiForbiddenResponse({ description: 'Sales users cannot move stock between locations' })
  create(@Body() dto: CreateTransferDto, @CurrentUser() user: AuthUser) {
    return this.transfers.create(dto, user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List transfers' })
  list(@Query() query: TransferQueryDto) {
    return this.transfers.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Transfer detail' })
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.transfers.detail(id);
  }

  @Post(':id/dispatch')
  @Roles(Role.ADMIN, Role.OPERATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Dispatch: reduce source stock',
    description: 'The destination is NOT credited here. The quantity is in transit until it is received.',
  })
  @ApiConflictResponse({ description: 'Already dispatched, or insufficient stock at the source' })
  dispatch(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user: AuthUser) {
    return this.transfers.dispatch(id, user.id);
  }

  @Post(':id/receive')
  @Roles(Role.ADMIN, Role.OPERATIONS)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Receive: increase destination stock',
    description:
      'Omit the body to receive everything outstanding, or pass a smaller quantity for a partial receipt. ' +
      'Receiving an already-received transfer returns 409.',
  })
  @ApiConflictResponse({ description: 'Not dispatched yet, already received, or quantity exceeds outstanding' })
  receive(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveTransferDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.transfers.receive(id, dto ?? {}, user.id);
  }
}
