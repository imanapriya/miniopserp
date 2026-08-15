import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Batch, Category, Item, Location, User } from '../database/entities';
import {
  CreateBatchDto,
  CreateCategoryDto,
  CreateItemDto,
  CreateLocationDto,
} from './dto/master.dto';

/**
 * Reference data used to populate the operational screens.
 *
 * Reads are open to every authenticated user (a Sales user needs the item list
 * to raise an order); writes are Admin-only, enforced on the controller.
 */
@Injectable()
export class MastersService {
  constructor(
    @InjectRepository(Location) private readonly locations: Repository<Location>,
    @InjectRepository(Category) private readonly categories: Repository<Category>,
    @InjectRepository(Item) private readonly items: Repository<Item>,
    @InjectRepository(Batch) private readonly batches: Repository<Batch>,
    @InjectRepository(User) private readonly users: Repository<User>,
  ) {}

  listLocations() {
    return this.locations.find({ where: { isActive: true }, order: { code: 'ASC' } });
  }

  createLocation(dto: CreateLocationDto) {
    return this.locations.save(this.locations.create(dto));
  }

  listCategories() {
    return this.categories.find({ order: { name: 'ASC' } });
  }

  createCategory(dto: CreateCategoryDto) {
    return this.categories.save(this.categories.create(dto));
  }

  async listItems() {
    const items = await this.items.find({
      where: { isActive: true },
      relations: { category: true },
      order: { sku: 'ASC' },
    });
    return items.map((i) => ({
      id: i.id,
      sku: i.sku,
      name: i.name,
      uom: i.uom,
      categoryId: i.categoryId,
      categoryName: i.category?.name ?? null,
    }));
  }

  async createItem(dto: CreateItemDto) {
    const category = await this.categories.findOne({ where: { id: dto.categoryId } });
    if (!category) throw new NotFoundException(`Category ${dto.categoryId} not found.`);
    return this.items.save(this.items.create({ ...dto, uom: dto.uom ?? 'EA' }));
  }

  /** Batches of an item, FEFO-ordered so the UI offers the same one the allocator would pick. */
  listBatches(itemId?: string) {
    return this.batches.find({
      where: itemId ? { itemId } : {},
      order: { expiryDate: 'ASC', code: 'ASC' },
      take: 200,
    });
  }

  async createBatch(dto: CreateBatchDto) {
    const item = await this.items.findOne({ where: { id: dto.itemId } });
    if (!item) throw new NotFoundException(`Item ${dto.itemId} not found.`);
    return this.batches.save(
      this.batches.create({ ...dto, expiryDate: dto.expiryDate ?? null }),
    );
  }

  /** Users available to be assigned to a work order. No password data leaves here. */
  async listUsers() {
    const users = await this.users.find({
      where: { isActive: true },
      relations: { location: true },
      order: { name: 'ASC' },
    });
    return users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      locationId: u.locationId,
      locationCode: u.location?.code ?? null,
    }));
  }
}
