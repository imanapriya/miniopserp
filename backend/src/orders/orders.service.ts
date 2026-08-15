import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import {
  CustomerOrder,
  CustomerOrderLine,
  Item,
  Location,
  Reservation,
} from '../database/entities';
import { InventoryTxnType, OrderStatus, ReservationStatus } from '../common/enums';
import { StockService } from '../inventory/stock.service';
import { nextDocumentNumber } from '../common/utils/document-number';
import { paginated } from '../common/dto/pagination.dto';
import { CreateOrderDto, OrderQueryDto } from './dto/order.dto';

/**
 * Customer orders and the stock reservations behind them.
 *
 * ---------------------------------------------------------------------------
 * THE RACE THIS IS BUILT TO SURVIVE
 * ---------------------------------------------------------------------------
 * 50 units on hand. Two Sales users each reserve 40, at the same instant.
 *
 *   Without locking      With `reserve()` below
 *   ---------------      ----------------------
 *   A reads 50           A locks the row, reads 50, writes reserved=40, commits
 *   B reads 50           B BLOCKS on the lock until A commits
 *   A writes 40          B then reads reserved=40, available=10
 *   B writes 40          B needs 40, finds 10, rolls back with 409
 *   => 80 units sold     => exactly one order succeeds
 *
 * The lock is taken by `StockService.lockBucketById` (`SELECT ... FOR UPDATE`)
 * and the whole allocation runs in one transaction, so a partially-filled
 * order can never be committed. The CHECK constraint
 * `reserved_qty <= physical_qty` sits underneath as a final backstop.
 */
@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(CustomerOrder) private readonly orders: Repository<CustomerOrder>,
    private readonly stock: StockService,
  ) {}

  async create(dto: CreateOrderDto, userId: string) {
    const orderId = await this.dataSource.transaction(async (manager) => {
      // Validate every referenced master record before writing anything.
      for (const line of dto.lines) {
        const [item, location] = await Promise.all([
          manager.findOne(Item, { where: { id: line.itemId } }),
          manager.findOne(Location, { where: { id: line.locationId } }),
        ]);
        if (!item) throw new NotFoundException(`Item ${line.itemId} not found.`);
        if (!location) throw new NotFoundException(`Location ${line.locationId} not found.`);
      }

      const order = await manager.save(
        manager.create(CustomerOrder, {
          code: await nextDocumentNumber(manager, 'customerOrder'),
          customerName: dto.customerName,
          status: OrderStatus.DRAFT,
          createdById: userId,
        }),
      );

      for (const line of dto.lines) {
        await manager.save(
          manager.create(CustomerOrderLine, {
            orderId: order.id,
            itemId: line.itemId,
            locationId: line.locationId,
            quantity: line.quantity,
            reservedQty: 0,
          }),
        );
      }

      // Reserving inside the SAME transaction means the order is never left
      // half-created: if stock runs out, the order itself is rolled back too.
      if (dto.reserveImmediately) {
        await this.reserveWithin(manager, order.id, userId);
      }

      return order.id;
    });

    return this.detail(orderId);
  }

  /** Reserve every unreserved unit on the order. All lines or none. */
  async reserve(orderId: string, userId: string) {
    await this.dataSource.transaction(async (manager) => {
      await this.reserveWithin(manager, orderId, userId);
    });
    return this.detail(orderId);
  }

  private async reserveWithin(manager: EntityManager, orderId: string, userId: string) {
    // Lock the order so two clicks on "Reserve" cannot both allocate stock.
    const order = await manager.findOne(CustomerOrder, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`);

    if (order.status === OrderStatus.CANCELLED) {
      throw new ConflictException(`Order ${order.code} is cancelled and cannot reserve stock.`);
    }
    if (order.status === OrderStatus.FULFILLED) {
      throw new ConflictException(`Order ${order.code} has already been fulfilled.`);
    }

    const lines = await manager.find(CustomerOrderLine, {
      where: { orderId },
      order: { id: 'ASC' },
    });
    if (!lines.length) throw new BadRequestException(`Order ${order.code} has no lines.`);

    const outstanding = lines.filter((l) => l.reservedQty < l.quantity);
    if (!outstanding.length) {
      throw new ConflictException(`Order ${order.code} is already fully reserved.`);
    }

    for (const line of outstanding) {
      await this.reserveLine(manager, order, line, userId);
    }

    order.status = OrderStatus.RESERVED;
    await manager.save(CustomerOrder, order);
  }

  /**
   * Allocates one line FEFO across the batches held at its location.
   *
   * Buckets are always visited in the same deterministic order (earliest
   * expiry, then batch code, then id), so two concurrent allocations queue
   * behind one another instead of deadlocking on each other's locks.
   */
  private async reserveLine(
    manager: EntityManager,
    order: CustomerOrder,
    line: CustomerOrderLine,
    userId: string,
  ) {
    const needed = line.quantity - line.reservedQty;
    const candidates = await this.stock.findAvailableBuckets(manager, line.itemId, line.locationId);

    let remaining = needed;

    for (const candidate of candidates) {
      if (remaining <= 0) break;

      // The list above was read WITHOUT a lock, so those numbers may already
      // be stale. Re-read this bucket under a write lock and trust that.
      const bucket = await this.stock.lockBucketById(manager, candidate.id);
      const available = bucket.physicalQty - bucket.reservedQty;
      if (available <= 0) continue;

      const take = Math.min(remaining, available);

      // The reservation row is created first so its id can key the ledger
      // movement. That keeps the RESERVE / RELEASE / CONSUME keys for one hold
      // symmetrical and guaranteed unique without any running-total arithmetic.
      const reservation = await manager.save(
        manager.create(Reservation, {
          orderLineId: line.id,
          inventoryId: bucket.id,
          quantity: take,
          status: ReservationStatus.ACTIVE,
        }),
      );

      await this.stock.applyMovement(manager, {
        inventoryId: bucket.id,
        type: InventoryTxnType.RESERVE,
        reservedDelta: take,
        refType: 'CUSTOMER_ORDER',
        refId: order.id,
        note: `Reserved for ${order.code}`,
        idempotencyKey: `RESERVATION:${reservation.id}:RESERVE`,
        userId,
      });

      remaining -= take;
    }

    if (remaining > 0) {
      const short = needed - remaining;
      // Throwing rolls back the ENTIRE transaction, including any buckets
      // already reserved for earlier lines. Partial fulfilment is never
      // silently committed.
      throw new ConflictException(
        `Cannot reserve ${needed} units for order ${order.code}: only ${short} available at this ` +
          `location. Short by ${remaining}. Nothing has been reserved.`,
      );
    }

    line.reservedQty += needed;
    await manager.save(CustomerOrderLine, line);
  }

  /**
   * Cancels the order and hands every reserved unit back to available stock.
   *
   * Physical stock is untouched - the goods never left; they were only spoken
   * for. Only `reserved_qty` comes down, which raises `available_qty` again.
   */
  async cancel(orderId: string, userId: string) {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(CustomerOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${orderId} not found.`);

      if (order.status === OrderStatus.CANCELLED) {
        throw new ConflictException(`Order ${order.code} is already cancelled.`);
      }
      if (order.status === OrderStatus.FULFILLED) {
        throw new ConflictException(
          `Order ${order.code} has been fulfilled and shipped; it cannot be cancelled.`,
        );
      }

      await this.releaseActiveReservations(manager, order, userId, ReservationStatus.RELEASED);

      order.status = OrderStatus.CANCELLED;
      await manager.save(CustomerOrder, order);
    });

    return this.detail(orderId);
  }

  /**
   * Ships the order: reserved stock physically leaves.
   *
   * Both quantities drop together, so `available_qty` is unchanged by this
   * step - the units were already spoken for and were never available.
   */
  async fulfil(orderId: string, userId: string) {
    await this.dataSource.transaction(async (manager) => {
      const order = await manager.findOne(CustomerOrder, {
        where: { id: orderId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!order) throw new NotFoundException(`Order ${orderId} not found.`);

      if (order.status !== OrderStatus.RESERVED) {
        throw new ConflictException(
          `Only a RESERVED order can be fulfilled. Order ${order.code} is ${order.status}.`,
        );
      }

      await this.releaseActiveReservations(manager, order, userId, ReservationStatus.CONSUMED);

      order.status = OrderStatus.FULFILLED;
      await manager.save(CustomerOrder, order);
    });

    return this.detail(orderId);
  }

  /**
   * Shared tail of cancel and fulfil.
   *
   * RELEASED: reserved -qty, physical untouched  (stock becomes available again)
   * CONSUMED: reserved -qty AND physical -qty    (stock leaves the building)
   */
  private async releaseActiveReservations(
    manager: EntityManager,
    order: CustomerOrder,
    userId: string,
    outcome: ReservationStatus.RELEASED | ReservationStatus.CONSUMED,
  ) {
    const reservations: Reservation[] = await manager
      .createQueryBuilder(Reservation, 'r')
      .innerJoin(CustomerOrderLine, 'line', 'line.id = r.order_line_id')
      .where('line.order_id = :orderId', { orderId: order.id })
      .andWhere('r.status = :status', { status: ReservationStatus.ACTIVE })
      // Deterministic order keeps lock acquisition consistent across requests.
      .orderBy('r.inventory_id', 'ASC')
      .getMany();

    for (const reservation of reservations) {
      await this.stock.lockBucketById(manager, reservation.inventoryId);

      const consuming = outcome === ReservationStatus.CONSUMED;
      await this.stock.applyMovement(manager, {
        inventoryId: reservation.inventoryId,
        type: consuming ? InventoryTxnType.CONSUME : InventoryTxnType.RELEASE,
        physicalDelta: consuming ? -reservation.quantity : 0,
        reservedDelta: -reservation.quantity,
        refType: 'CUSTOMER_ORDER',
        refId: order.id,
        note: consuming ? `Shipped on ${order.code}` : `Released from cancelled ${order.code}`,
        idempotencyKey: `RESERVATION:${reservation.id}:${outcome}`,
        userId,
      });

      reservation.status = outcome;
      reservation.releasedAt = new Date();
      await manager.save(Reservation, reservation);
    }

    // Lines no longer hold anything.
    await manager
      .createQueryBuilder()
      .update(CustomerOrderLine)
      .set({ reservedQty: 0 })
      .where('order_id = :orderId', { orderId: order.id })
      .execute();
  }

  async list(query: OrderQueryDto) {
    const qb = this.orders
      .createQueryBuilder('o')
      .innerJoinAndSelect('o.createdBy', 'creator')
      .leftJoinAndSelect('o.lines', 'line')
      .leftJoinAndSelect('line.item', 'item')
      .leftJoinAndSelect('line.location', 'location');

    if (query.status) qb.andWhere('o.status = :status', { status: query.status });
    if (query.customerName) {
      qb.andWhere('o.customer_name ILIKE :name', { name: `%${query.customerName}%` });
    }

    const [rows, total] = await qb
      .orderBy('o.created_at', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    return paginated(rows.map((o) => this.shape(o)), total, query);
  }

  async detail(id: string) {
    const order = await this.orders.findOne({
      where: { id },
      relations: {
        createdBy: true,
        lines: { item: true, location: true, reservations: true },
      },
    });
    if (!order) throw new NotFoundException(`Order ${id} not found.`);
    return this.shape(order, true);
  }

  private shape(order: CustomerOrder, includeReservations = false) {
    const lines = (order.lines ?? []).map((line: any) => ({
      id: line.id,
      itemId: line.itemId,
      sku: line.item?.sku ?? null,
      itemName: line.item?.name ?? null,
      locationId: line.locationId,
      locationCode: line.location?.code ?? null,
      quantity: line.quantity,
      reservedQty: line.reservedQty,
      shortageQty: Math.max(0, line.quantity - line.reservedQty),
      ...(includeReservations
        ? {
            reservations: (line.reservations ?? [])
              .filter((r: any) => r.status === ReservationStatus.ACTIVE)
              .map((r: any) => ({ id: r.id, inventoryId: r.inventoryId, quantity: r.quantity })),
          }
        : {}),
    }));

    return {
      id: order.id,
      code: order.code,
      customerName: order.customerName,
      status: order.status,
      createdByName: order.createdBy?.name ?? null,
      createdAt: order.createdAt,
      totalQty: lines.reduce((sum, l) => sum + l.quantity, 0),
      totalReservedQty: lines.reduce((sum, l) => sum + l.reservedQty, 0),
      lines,
    };
  }
}
