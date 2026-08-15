import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Batch, Inventory, InventoryTransaction, Item, Location } from '../database/entities';
import { InventoryTxnType } from '../common/enums';
import { StockService } from './stock.service';
import { InventoryQueryDto } from './dto/inventory-query.dto';
import { StockAdjustmentDto, StockReceiptDto } from './dto/stock-receipt.dto';
import { paginated, PaginationDto } from '../common/dto/pagination.dto';

@Injectable()
export class InventoryService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Inventory) private readonly inventory: Repository<Inventory>,
    @InjectRepository(InventoryTransaction) private readonly ledger: Repository<InventoryTransaction>,
    private readonly stock: StockService,
  ) {}

  /** Paginated stock list, flattened for the Inventory screen. */
  async list(query: InventoryQueryDto) {
    const qb = this.inventory
      .createQueryBuilder('inv')
      .innerJoin('inv.item', 'item')
      .innerJoin('item.category', 'category')
      .innerJoin('inv.location', 'location')
      .innerJoin('inv.batch', 'batch')
      .select([
        'inv.id            AS "id"',
        'item.id           AS "itemId"',
        'item.sku          AS "sku"',
        'item.name         AS "itemName"',
        'item.uom          AS "uom"',
        'category.id       AS "categoryId"',
        'category.name     AS "categoryName"',
        'location.id       AS "locationId"',
        'location.code     AS "locationCode"',
        'location.name     AS "locationName"',
        'batch.id          AS "batchId"',
        'batch.code        AS "batchCode"',
        'batch.expiryDate  AS "expiryDate"',
        'inv.physicalQty   AS "physicalQty"',
        'inv.reservedQty   AS "reservedQty"',
        'inv.availableQty  AS "availableQty"',
      ]);

    if (query.locationId) qb.andWhere('inv.location_id = :locationId', { locationId: query.locationId });
    if (query.itemId) qb.andWhere('inv.item_id = :itemId', { itemId: query.itemId });
    if (query.categoryId) qb.andWhere('item.category_id = :categoryId', { categoryId: query.categoryId });
    if (query.outOfStock === 'true') qb.andWhere('inv.available_qty = 0');
    if (query.q) {
      qb.andWhere('(item.sku ILIKE :q OR item.name ILIKE :q OR batch.code ILIKE :q)', {
        q: `%${query.q}%`,
      });
    }

    const total = await qb.getCount();
    const data = await qb
      .orderBy('location.code', 'ASC')
      .addOrderBy('item.sku', 'ASC')
      .addOrderBy('batch.code', 'ASC')
      .offset(query.skip)
      .limit(query.limit)
      .getRawMany();

    return paginated(data, total, query);
  }

  /** The append-only movement history for one bucket. */
  async transactions(inventoryId: string, pagination: PaginationDto) {
    const bucket = await this.inventory.findOne({ where: { id: inventoryId } });
    if (!bucket) throw new NotFoundException(`Inventory record ${inventoryId} not found.`);

    const [data, total] = await this.ledger.findAndCount({
      where: { inventoryId },
      relations: { createdBy: true },
      order: { createdAt: 'DESC' },
      skip: pagination.skip,
      take: pagination.limit,
    });

    return paginated(
      data.map((t) => ({
        id: t.id,
        type: t.type,
        physicalDelta: t.physicalDelta,
        reservedDelta: t.reservedDelta,
        refType: t.refType,
        refId: t.refId,
        note: t.note,
        idempotencyKey: t.idempotencyKey,
        createdAt: t.createdAt,
        createdBy: t.createdBy ? { id: t.createdBy.id, name: t.createdBy.name } : null,
      })),
      total,
      pagination,
    );
  }

  /**
   * Receive stock into a location.
   *
   * Wrapped in a transaction even though it touches one bucket: the ledger row
   * and the balance change must land together or not at all.
   */
  async receive(dto: StockReceiptDto, userId: string) {
    if (!dto.batchId && !dto.batchCode) {
      throw new BadRequestException('Provide either batchId or batchCode.');
    }

    return this.dataSource.transaction(async (manager) => {
      const item = await manager.findOne(Item, { where: { id: dto.itemId } });
      if (!item) throw new NotFoundException(`Item ${dto.itemId} not found.`);

      const location = await manager.findOne(Location, { where: { id: dto.locationId } });
      if (!location) throw new NotFoundException(`Location ${dto.locationId} not found.`);

      const batch = await this.resolveBatch(manager, dto);

      const bucket = await this.stock.lockOrCreateBucket(
        manager,
        { itemId: item.id, locationId: location.id, batchId: batch.id },
        true,
      );

      const updated = await this.stock.applyMovement(manager, {
        inventoryId: bucket.id,
        type: InventoryTxnType.RECEIPT,
        physicalDelta: dto.quantity,
        refType: 'RECEIPT',
        note: dto.note ?? null,
        // Turns an accidentally repeated submission into a clean 409 instead
        // of silently doubling the stock on hand.
        idempotencyKey: dto.reference ? `RECEIPT:${dto.reference}` : undefined,
        userId,
      });

      return {
        inventoryId: updated.id,
        sku: item.sku,
        locationCode: location.code,
        batchCode: batch.code,
        physicalQty: updated.physicalQty,
        reservedQty: updated.reservedQty,
        availableQty: updated.availableQty,
      };
    });
  }

  /** Manual correction: stock count, damage write-off, data fix. */
  async adjust(dto: StockAdjustmentDto, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const bucket = await this.stock.lockBucketById(manager, dto.inventoryId);

      // Pre-check under the lock so the caller gets a helpful message rather
      // than a bare constraint violation. The CHECK constraint still guards
      // the write itself.
      if (dto.delta < 0) {
        const availableToRemove = bucket.physicalQty - bucket.reservedQty;
        if (Math.abs(dto.delta) > availableToRemove) {
          throw new BadRequestException(
            `Cannot remove ${Math.abs(dto.delta)} units: only ${availableToRemove} are unreserved ` +
              `(${bucket.physicalQty} physical, ${bucket.reservedQty} reserved). Release reservations first.`,
          );
        }
      }

      const updated = await this.stock.applyMovement(manager, {
        inventoryId: bucket.id,
        type: InventoryTxnType.ADJUSTMENT,
        physicalDelta: dto.delta,
        refType: 'ADJUSTMENT',
        note: dto.reason,
        userId,
      });

      return {
        inventoryId: updated.id,
        physicalQty: updated.physicalQty,
        reservedQty: updated.reservedQty,
        availableQty: updated.availableQty,
      };
    });
  }

  /**
   * Proves the ledger and the balances agree.
   *
   * Three independent invariants:
   *
   *   a) physical_qty === SUM(physical_delta) from the ledger
   *   b) reserved_qty === SUM(reserved_delta) from the ledger
   *   c) SUM(ACTIVE customer reservations) === the ledger's net reserved
   *      movement tagged CUSTOMER_ORDER
   *
   * (c) is scoped to customer orders on purpose. Reserved stock has two
   * sources - customer reservations, which get a row in `reservations`, and
   * work orders holding their material, which do not. Comparing the whole of
   * reserved_qty against the reservations table would wrongly flag every
   * work order that is in progress.
   *
   * A non-empty `discrepancies` array means a code path mutated inventory
   * without going through StockService - which should be impossible, and is
   * exactly the sort of regression this endpoint exists to catch.
   */
  async reconcile() {
    const discrepancies = await this.dataSource.query(`
      WITH ledger AS (
        SELECT "inventory_id",
               COALESCE(SUM("physical_delta"), 0)::int AS physical_from_ledger,
               COALESCE(SUM("reserved_delta"), 0)::int AS reserved_from_ledger,
               COALESCE(SUM("reserved_delta") FILTER (WHERE "ref_type" = 'CUSTOMER_ORDER'), 0)::int
                 AS customer_reserved_from_ledger
          FROM "inventory_transactions"
         GROUP BY "inventory_id"
      ),
      holds AS (
        SELECT "inventory_id",
               COALESCE(SUM("quantity"), 0)::int AS reserved_from_reservations
          FROM "reservations"
         WHERE "status" = 'ACTIVE'
         GROUP BY "inventory_id"
      )
      SELECT inv."id" AS "inventoryId",
             it."sku",
             loc."code" AS "locationCode",
             inv."physical_qty" AS "physicalQty",
             COALESCE(l.physical_from_ledger, 0) AS "physicalFromLedger",
             inv."reserved_qty" AS "reservedQty",
             COALESCE(l.reserved_from_ledger, 0) AS "reservedFromLedger",
             COALESCE(h.reserved_from_reservations, 0) AS "customerReservationsHeld",
             COALESCE(l.customer_reserved_from_ledger, 0) AS "customerReservedFromLedger"
        FROM "inventory" inv
        JOIN "items" it ON it."id" = inv."item_id"
        JOIN "locations" loc ON loc."id" = inv."location_id"
        LEFT JOIN ledger l ON l."inventory_id" = inv."id"
        LEFT JOIN holds  h ON h."inventory_id" = inv."id"
       WHERE inv."physical_qty" <> COALESCE(l.physical_from_ledger, 0)
          OR inv."reserved_qty" <> COALESCE(l.reserved_from_ledger, 0)
          OR COALESCE(h.reserved_from_reservations, 0)
             <> COALESCE(l.customer_reserved_from_ledger, 0)
    `);

    const [{ count }] = await this.dataSource.query(`SELECT COUNT(*)::int AS count FROM "inventory"`);

    return {
      bucketsChecked: count,
      balanced: discrepancies.length === 0,
      discrepancies,
    };
  }

  /** Finds an existing batch, or creates one from a code. */
  private async resolveBatch(manager: any, dto: StockReceiptDto): Promise<Batch> {
    if (dto.batchId) {
      const batch = await manager.findOne(Batch, { where: { id: dto.batchId } });
      if (!batch) throw new NotFoundException(`Batch ${dto.batchId} not found.`);
      if (batch.itemId !== dto.itemId) {
        throw new BadRequestException('That batch belongs to a different item.');
      }
      return batch;
    }

    const existing = await manager.findOne(Batch, {
      where: { itemId: dto.itemId, code: dto.batchCode },
    });
    if (existing) return existing;

    return manager.save(
      manager.create(Batch, {
        itemId: dto.itemId,
        code: dto.batchCode,
        expiryDate: dto.expiryDate ?? null,
      }),
    );
  }
}
