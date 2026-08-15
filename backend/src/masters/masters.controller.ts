import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { MastersService } from './masters.service';
import {
  CreateBatchDto,
  CreateCategoryDto,
  CreateItemDto,
  CreateLocationDto,
} from './dto/master.dto';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums';

@ApiTags('Master data')
@ApiBearerAuth()
@Controller()
export class MastersController {
  constructor(private readonly masters: MastersService) {}

  @Get('locations')
  @ApiOperation({ summary: 'All active locations' })
  listLocations() {
    return this.masters.listLocations();
  }

  @Post('locations')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a location (Admin)' })
  createLocation(@Body() dto: CreateLocationDto) {
    return this.masters.createLocation(dto);
  }

  @Get('categories')
  @ApiOperation({ summary: 'All item categories' })
  listCategories() {
    return this.masters.listCategories();
  }

  @Post('categories')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create a category (Admin)' })
  createCategory(@Body() dto: CreateCategoryDto) {
    return this.masters.createCategory(dto);
  }

  @Get('items')
  @ApiOperation({ summary: 'All active items with their category' })
  listItems() {
    return this.masters.listItems();
  }

  @Post('items')
  @Roles(Role.ADMIN)
  @ApiOperation({ summary: 'Create an item (Admin)' })
  createItem(@Body() dto: CreateItemDto) {
    return this.masters.createItem(dto);
  }

  @Get('batches')
  @ApiOperation({ summary: 'Batches, optionally filtered to one item, earliest expiry first' })
  @ApiQuery({ name: 'itemId', required: false, format: 'uuid' })
  listBatches(@Query('itemId') itemId?: string) {
    return this.masters.listBatches(itemId);
  }

  @Post('batches')
  @Roles(Role.ADMIN, Role.OPERATIONS)
  @ApiOperation({ summary: 'Create a batch' })
  createBatch(@Body() dto: CreateBatchDto) {
    return this.masters.createBatch(dto);
  }

  @Get('users')
  @ApiOperation({ summary: 'Active users, for assigning work orders' })
  listUsers() {
    return this.masters.listUsers();
  }
}
