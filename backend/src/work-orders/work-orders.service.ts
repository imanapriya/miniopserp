import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Item, Location, User, WorkOrder } from '../database/entities';
import {
  InventoryTxnType,
  Role,
  WorkOrderStatus,
  WORK_ORDER_TRANSITIONS,
} from '../common/enums';
import { StockService } from '../inventory/stock.service';
import { nextDocumentNumber } from '../common/utils/document-number';
import { paginated } from '../common/dto/pagination.dto';
import {
  CreateWorkOrderDto,
  UpdateWorkOrderStatusDto,
  WorkOrderQueryDto,
} from './dto/work-order.dto';

@Injectable()
export class WorkOrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(WorkOrder) private readonly workOrders: Repository<WorkOrder>,
    private readonly stock: StockService,
  ) {}

  async create(dto: CreateWorkOrderDto, userId: string) {
    return this.dataSource.transaction(async (manager) => {
      const [location, item, assignee] = await Promise.all([
        manager.findOne(Location, { where: { id: dto.locationId } }),
        manager.findOne(Item, { where: { id: dto.itemId } }),
        manager.findOne(User, { where: { id: dto.assignedToId } }),
      ]);

      if (!location) throw new NotFoundException(`Location ${dto.locationId} not found.`);
      if (!item) throw new NotFoundException(`Item ${dto.itemId} not found.`);
      if (!assignee) throw new NotFoundException(`User ${dto.assignedToId} not found.`);
      if (!assignee.isActive) throw new BadRequestException('Cannot assign work to a deactivated user.');
      if (assignee.role === Role.SALES) {
        throw new BadRequestException('Work orders must be assigned to an Admin or Operations user.');
      }

      const workOrder = await manager.save(
        manager.create(WorkOrder, {
          code: await nextDocumentNumber(manager, 'workOrder'),
          locationId: dto.locationId,
          itemId: dto.itemId,
          requiredQty: dto.requiredQty,
          assignedToId: dto.assignedToId,
          notes: dto.notes ?? null,
          status: WorkOrderStatus.ASSIGNED,
          createdById: userId,
        }),
      );

      return this.detail(workOrder.id, manager);
    });
  }

  async list(query: WorkOrderQueryDto) {
    const qb = this.workOrders
      .createQueryBuilder('wo')
      .innerJoinAndSelect('wo.location', 'location')
      .innerJoinAndSelect('wo.item', 'item')
      .innerJoinAndSelect('wo.assignedTo', 'assignee')
      .innerJoinAndSelect('wo.createdBy', 'creator');

    if (query.status) qb.andWhere('wo.status = :status', { status: query.status });
    if (query.locationId) qb.andWhere('wo.location_id = :locationId', { locationId: query.locationId });
    if (query.assignedToId) {
      qb.andWhere('wo.assigned_to_id = :assignedToId', { assignedToId: query.assignedToId });
    }

    const [rows, total] = await qb
      .orderBy('wo.created_at', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    // Availability for the whole page in one query rather than N+1.
    const availability = await this.availabilityFor(rows);

    const data = rows.map((wo) => {
      const available = availability.get(`${wo.itemId}:${wo.locationId}`) ?? 0;
      return { ...this.shape(wo), ...this.materialStatus(wo, available) };
    });

    return paginated(data, total, query);
  }

  async detail(id: string, manager?: EntityManager) {
    const em = manager ?? this.dataSource.manager;

    const workOrder = await em.findOne(WorkOrder, {
      where: { id },
      relations: { location: true, item: true, assignedTo: true, createdBy: true, transfers: true },
    });
    if (!workOrder) throw new NotFoundException(`Work order ${id} not found.`);

    const available = await this.stock.availableAtLocation(em, workOrder.itemId, workOrder.locationId);
    const material = this.materialStatus(workOrder, available);

    // Only bother looking for donor locations when there is a shortage to cover.
    const sources = material.shortageQty > 0
      ? await this.stock.availabilityElsewhere(em, workOrder.itemId, workOrder.locationId)
      : [];

    return {
      ...this.shape(workOrder),
      ...material,
      /** Where the shortage could be transferred in from, best-stocked first. */
      suggestedSources: sources,
      transfers: (workOrder.transfers ?? []).map((t: any) => ({
        id: t.id,
        code: t.code,
        quantity: t.quantity,
        receivedQty: t.receivedQty,
        status: t.status,
      })),
    };
  }

  /**
   * Moves a work order along its lifecycle, applying the inventory effect that
   * goes with each transition. All of it inside one database transaction, so a
   * failure to reserve leaves the status untouched.
   *
   *   ASSIGNED    -> IN_PROGRESS : reserve the material (fails if short)
   *   IN_PROGRESS -> COMPLETED   : consume what was reserved
   */
  async updateStatus(id: string, dto: UpdateWorkOrderStatusDto, userId: string) {
    await this.dataSource.transaction(async (manager) => {
      // Lock the work order itself so two clicks cannot both start the job and
      // reserve the material twice.
      const workOrder = await manager.findOne(WorkOrder, {
        where: { id },
        lock: { mode: 'pessimistic_write' },
      });
      if (!workOrder) throw new NotFoundException(`Work order ${id} not found.`);

      if (workOrder.status === dto.status) {
        throw new ConflictException(`Work order ${workOrder.code} is already ${dto.status}.`);
      }
      const allowed = WORK_ORDER_TRANSITIONS[workOrder.status];
      if (!allowed.includes(dto.status)) {
        throw new ConflictException(
          `Cannot move work order ${workOrder.code} from ${workOrder.status} to ${dto.status}. ` +
            (allowed.length ? `Allowed next: ${allowed.join(', ')}.` : 'It is already complete.'),
        );
      }

      if (dto.status === WorkOrderStatus.IN_PROGRESS) {
        await this.reserveMaterial(manager, workOrder, userId);
        workOrder.startedAt = new Date();
      }

      if (dto.status === WorkOrderStatus.COMPLETED) {
        await this.consumeMaterial(manager, workOrder, userId);
        workOrder.completedAt = new Date();
      }

      workOrder.status = dto.status;
      await manager.save(WorkOrder, workOrder);
    });

    return this.detail(id);
  }

  /**
   * Holds the required material at the work order's location.
   *
   * Allocates FEFO across batches. Each bucket is locked before it is read, so
   * a customer order reserving the same stock concurrently is serialised
   * behind us and one of the two is correctly refused.
   */
  private async reserveMaterial(manager: EntityManager, workOrder: WorkOrder, userId: string) {
    const buckets = await this.stock.findAvailableBuckets(
      manager,
      workOrder.itemId,
      workOrder.locationId,
    );

    const totalAvailable = buckets.reduce((sum, b) => sum + Number(b.availableQty), 0);
    if (totalAvailable < workOrder.requiredQty) {
      throw new ConflictException(
        `Cannot start ${workOrder.code}: it needs ${workOrder.requiredQty} units but only ` +
          `${totalAvailable} are available at this location. Shortage is ` +
          `${workOrder.requiredQty - totalAvailable}. Raise an internal transfer first.`,
      );
    }

    let remaining = workOrder.requiredQty;
    for (const candidate of buckets) {
      if (remaining <= 0) break;

      // Re-read under a write lock: `findAvailableBuckets` was an unlocked
      // read, so the figure may already be stale by the time we get here.
      const bucket = await this.stock.lockBucketById(manager, candidate.id);
      const take = Math.min(remaining, bucket.physicalQty - bucket.reservedQty);
      if (take <= 0) continue;

      await this.stock.applyMovement(manager, {
        inventoryId: bucket.id,
        type: InventoryTxnType.RESERVE,
        reservedDelta: take,
        refType: 'WORK_ORDER',
        refId: workOrder.id,
        note: `Material held for ${workOrder.code}`,
        idempotencyKey: `WORK_ORDER:${workOrder.id}:RESERVE:${bucket.id}`,
        userId,
      });
      remaining -= take;
    }

    if (remaining > 0) {
      // Another transaction took the stock between the unlocked read and the
      // locked one. Throwing rolls the whole thing back - no partial hold.
      throw new ConflictException(
        `Could not reserve the full quantity for ${workOrder.code}; ${remaining} units were taken ` +
          `by another operation while this request was running. Please retry.`,
      );
    }
  }

  /**
   * Consumes what the work order is holding: physical and reserved both drop.
   *
   * The quantities come from the ledger rather than from a separate table -
   * the RESERVE rows tagged with this work order ARE the record of what it
   * holds, so the two can never disagree.
   */
  private async consumeMaterial(manager: EntityManager, workOrder: WorkOrder, userId: string) {
    const holds: Array<{ inventoryId: string; qty: string }> = await manager.query(
      `SELECT "inventory_id" AS "inventoryId",
              SUM("reserved_delta")::int AS "qty"
         FROM "inventory_transactions"
        WHERE "ref_type" = 'WORK_ORDER'
          AND "ref_id" = $1
        GROUP BY "inventory_id"
       HAVING SUM("reserved_delta") > 0
        ORDER BY "inventory_id" ASC`,
      [workOrder.id],
    );

    if (!holds.length) {
      throw new ConflictException(
        `Work order ${workOrder.code} has no material held against it, so it cannot be completed.`,
      );
    }

    for (const hold of holds) {
      const quantity = Number(hold.qty);
      await this.stock.lockBucketById(manager, hold.inventoryId);
      await this.stock.applyMovement(manager, {
        inventoryId: hold.inventoryId,
        type: InventoryTxnType.CONSUME,
        physicalDelta: -quantity,
        reservedDelta: -quantity,
        refType: 'WORK_ORDER',
        refId: workOrder.id,
        note: `Material consumed by ${workOrder.code}`,
        idempotencyKey: `WORK_ORDER:${workOrder.id}:CONSUME:${hold.inventoryId}`,
        userId,
      });
    }
  }

  /**
   * Shortage is always derived, never stored, so it cannot go stale.
   *
   * Only an ASSIGNED work order can be short. Once it is IN_PROGRESS its
   * material is already reserved against it - which drives `availableQty` down
   * to zero - so measuring a shortage then would report the work order as
   * short of the very stock it is itself holding.
   */
  private materialStatus(workOrder: WorkOrder, availableQty: number) {
    if (workOrder.status === WorkOrderStatus.COMPLETED) {
      return {
        availableQty,
        shortageQty: 0,
        materialStatus: 'CONSUMED' as const,
        canStart: false,
      };
    }

    if (workOrder.status === WorkOrderStatus.IN_PROGRESS) {
      return {
        availableQty,
        shortageQty: 0,
        materialStatus: 'HELD' as const,
        canStart: false,
      };
    }

    const shortageQty = Math.max(0, workOrder.requiredQty - availableQty);
    return {
      availableQty,
      shortageQty,
      materialStatus: shortageQty === 0 ? ('SUFFICIENT' as const) : ('SHORTAGE' as const),
      canStart: shortageQty === 0,
    };
  }

  private async availabilityFor(rows: WorkOrder[]): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (!rows.length) return map;

    const pairs = rows.map((r) => ({ itemId: r.itemId, locationId: r.locationId }));
    const result = await this.dataSource.query(
      `SELECT "item_id" AS "itemId",
              "location_id" AS "locationId",
              COALESCE(SUM("available_qty"), 0)::int AS "availableQty"
         FROM "inventory"
        WHERE ("item_id", "location_id") IN (
              SELECT (value->>'itemId')::uuid, (value->>'locationId')::uuid
                FROM jsonb_array_elements($1::jsonb)
        )
        GROUP BY "item_id", "location_id"`,
      [JSON.stringify(pairs)],
    );

    for (const row of result) map.set(`${row.itemId}:${row.locationId}`, Number(row.availableQty));
    return map;
  }

  private shape(wo: WorkOrder) {
    return {
      id: wo.id,
      code: wo.code,
      status: wo.status,
      requiredQty: wo.requiredQty,
      notes: wo.notes,
      locationId: wo.locationId,
      locationCode: wo.location?.code ?? null,
      locationName: wo.location?.name ?? null,
      itemId: wo.itemId,
      sku: wo.item?.sku ?? null,
      itemName: wo.item?.name ?? null,
      assignedToId: wo.assignedToId,
      assignedToName: wo.assignedTo?.name ?? null,
      createdByName: wo.createdBy?.name ?? null,
      createdAt: wo.createdAt,
      startedAt: wo.startedAt,
      completedAt: wo.completedAt,
    };
  }
}
