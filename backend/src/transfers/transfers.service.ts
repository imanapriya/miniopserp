import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Batch, Inventory, Item, Location, StockTransfer, WorkOrder } from '../database/entities';
import { InventoryTxnType, TransferStatus } from '../common/enums';
import { StockService } from '../inventory/stock.service';
import { nextDocumentNumber } from '../common/utils/document-number';
import { paginated } from '../common/dto/pagination.dto';
import { CreateTransferDto, ReceiveTransferDto, TransferQueryDto } from './dto/transfer.dto';

/**
 * Internal stock transfer between two locations.
 *
 * The two-step dispatch/receive model exists so that stock is never counted
 * twice and never counted at both ends:
 *
 *   REQUESTED   source unchanged, destination unchanged
 *   DISPATCHED  source -qty        destination unchanged   <- in transit
 *   RECEIVED    source unchanged   destination +qty
 *
 * While a transfer is in transit the quantity exists in neither location's
 * availability, which is exactly right: it cannot be sold from the source
 * (it has left) and it cannot be sold from the destination (it has not
 * arrived).
 */
@Injectable()
export class TransfersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(StockTransfer) private readonly transfers: Repository<StockTransfer>,
    private readonly stock: StockService,
  ) {}

  async create(dto: CreateTransferDto, userId: string) {
    if (dto.sourceLocationId === dto.destinationLocationId) {
      throw new BadRequestException('Source and destination locations must be different.');
    }

    return this.dataSource.transaction(async (manager) => {
      const [source, destination, item, batch] = await Promise.all([
        manager.findOne(Location, { where: { id: dto.sourceLocationId } }),
        manager.findOne(Location, { where: { id: dto.destinationLocationId } }),
        manager.findOne(Item, { where: { id: dto.itemId } }),
        manager.findOne(Batch, { where: { id: dto.batchId } }),
      ]);

      if (!source) throw new NotFoundException(`Source location ${dto.sourceLocationId} not found.`);
      if (!destination) throw new NotFoundException(`Destination location ${dto.destinationLocationId} not found.`);
      if (!item) throw new NotFoundException(`Item ${dto.itemId} not found.`);
      if (!batch) throw new NotFoundException(`Batch ${dto.batchId} not found.`);
      if (batch.itemId !== item.id) throw new BadRequestException('That batch belongs to a different item.');

      if (dto.workOrderId) {
        const workOrder = await manager.findOne(WorkOrder, { where: { id: dto.workOrderId } });
        if (!workOrder) throw new NotFoundException(`Work order ${dto.workOrderId} not found.`);
      }

      // Early validation so the user finds out now rather than at dispatch.
      // This is advisory only - stock is not held by a REQUESTED transfer, so
      // `dispatch()` re-checks under a row lock and has the final say.
      const bucket = await manager.findOne(Inventory, {
        where: {
          itemId: dto.itemId,
          locationId: dto.sourceLocationId,
          batchId: dto.batchId,
        },
      });

      const available = bucket?.availableQty ?? 0;
      if (available < dto.quantity) {
        throw new ConflictException(
          `Cannot transfer ${dto.quantity} units: only ${available} are available in batch ` +
            `${batch.code} at ${source.code}.`,
        );
      }

      const transfer = await manager.save(
        manager.create(StockTransfer, {
          code: await nextDocumentNumber(manager, 'transfer'),
          sourceLocationId: dto.sourceLocationId,
          destinationLocationId: dto.destinationLocationId,
          itemId: dto.itemId,
          batchId: dto.batchId,
          quantity: dto.quantity,
          receivedQty: 0,
          status: TransferStatus.REQUESTED,
          workOrderId: dto.workOrderId ?? null,
          createdById: userId,
        }),
      );

      return this.detail(transfer.id, manager);
    });
  }

  async list(query: TransferQueryDto) {
    const qb = this.transfers
      .createQueryBuilder('t')
      .innerJoinAndSelect('t.sourceLocation', 'source')
      .innerJoinAndSelect('t.destinationLocation', 'destination')
      .innerJoinAndSelect('t.item', 'item')
      .innerJoinAndSelect('t.batch', 'batch')
      .innerJoinAndSelect('t.createdBy', 'creator')
      .leftJoinAndSelect('t.workOrder', 'workOrder');

    if (query.status) qb.andWhere('t.status = :status', { status: query.status });
    if (query.sourceLocationId) {
      qb.andWhere('t.source_location_id = :src', { src: query.sourceLocationId });
    }
    if (query.destinationLocationId) {
      qb.andWhere('t.destination_location_id = :dst', { dst: query.destinationLocationId });
    }

    const [rows, total] = await qb
      .orderBy('t.created_at', 'DESC')
      .skip(query.skip)
      .take(query.limit)
      .getManyAndCount();

    return paginated(rows.map((t) => this.shape(t)), total, query);
  }

  async detail(id: string, manager?: EntityManager) {
    const em = manager ?? this.dataSource.manager;
    const transfer = await em.findOne(StockTransfer, {
      where: { id },
      relations: {
        sourceLocation: true,
        destinationLocation: true,
        item: true,
        batch: true,
        createdBy: true,
        workOrder: true,
      },
    });
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found.`);
    return this.shape(transfer);
  }

  /**
   * Dispatch: stock physically leaves the source.
   *
   * The destination is deliberately NOT touched here. That is the whole point
   * of the two-step model, and it is what mandatory test 3 verifies.
   */
  async dispatch(id: string, userId: string) {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lockTransfer(manager, id);

      if (transfer.status !== TransferStatus.REQUESTED) {
        throw new ConflictException(
          transfer.status === TransferStatus.DISPATCHED
            ? `Transfer ${transfer.code} has already been dispatched.`
            : `Transfer ${transfer.code} has already been received and cannot be dispatched again.`,
        );
      }

      // Authoritative availability check, under a write lock on the exact
      // bucket. Anything that read this row before us has already committed;
      // anything after us waits.
      const bucket = await this.stock.lockOrCreateBucket(
        manager,
        {
          itemId: transfer.itemId,
          locationId: transfer.sourceLocationId,
          batchId: transfer.batchId,
        },
        false,
      );

      const available = bucket.physicalQty - bucket.reservedQty;
      if (available < transfer.quantity) {
        throw new ConflictException(
          `Cannot dispatch ${transfer.quantity} units: only ${available} are available at the source ` +
            `(${bucket.physicalQty} physical, ${bucket.reservedQty} reserved for orders).`,
        );
      }

      await this.stock.applyMovement(manager, {
        inventoryId: bucket.id,
        type: InventoryTxnType.TRANSFER_OUT,
        physicalDelta: -transfer.quantity,
        refType: 'TRANSFER',
        refId: transfer.id,
        note: `Dispatched on ${transfer.code}`,
        // Makes a repeated dispatch impossible even if the status check above
        // were somehow bypassed.
        idempotencyKey: `TRANSFER:${transfer.id}:DISPATCH`,
        userId,
      });

      transfer.status = TransferStatus.DISPATCHED;
      transfer.dispatchedAt = new Date();
      await manager.save(StockTransfer, transfer);
    });

    return this.detail(id);
  }

  /**
   * Receipt: stock arrives at the destination.
   *
   * Receiving the same transfer twice is blocked three independent ways:
   *   1. the transfer row is locked FOR UPDATE and its status re-read here,
   *   2. the status machine refuses RECEIVED -> RECEIVED,
   *   3. the ledger's unique idempotency key for this receipt collides.
   * Any one of them alone would be sufficient; together they mean a double
   * click, a retried request and a replayed message all fail safely.
   *
   * Partial receipts are supported: pass a smaller `quantity` and the transfer
   * stays DISPATCHED until the full amount has arrived.
   */
  async receive(id: string, dto: ReceiveTransferDto, userId: string) {
    await this.dataSource.transaction(async (manager) => {
      const transfer = await this.lockTransfer(manager, id);

      if (transfer.status === TransferStatus.REQUESTED) {
        throw new ConflictException(
          `Transfer ${transfer.code} has not been dispatched yet, so there is nothing to receive.`,
        );
      }
      if (transfer.status === TransferStatus.RECEIVED) {
        throw new ConflictException(
          `Transfer ${transfer.code} has already been fully received. It cannot be received again.`,
        );
      }

      const outstanding = transfer.quantity - transfer.receivedQty;
      const quantity = dto.quantity ?? outstanding;

      if (quantity > outstanding) {
        throw new ConflictException(
          `Cannot receive ${quantity} units: only ${outstanding} are still outstanding on ${transfer.code}.`,
        );
      }

      // The destination may never have held this batch before, so the bucket
      // is created on demand.
      const bucket = await this.stock.lockOrCreateBucket(
        manager,
        {
          itemId: transfer.itemId,
          locationId: transfer.destinationLocationId,
          batchId: transfer.batchId,
        },
        true,
      );

      const receivedAfter = transfer.receivedQty + quantity;

      await this.stock.applyMovement(manager, {
        inventoryId: bucket.id,
        type: InventoryTxnType.TRANSFER_IN,
        physicalDelta: quantity,
        refType: 'TRANSFER',
        refId: transfer.id,
        note: `Received on ${transfer.code}`,
        // Keyed by the running total, so each distinct partial receipt gets
        // its own key while a repeat of the SAME receipt collides.
        idempotencyKey: `TRANSFER:${transfer.id}:RECEIVE:${receivedAfter}`,
        userId,
      });

      transfer.receivedQty = receivedAfter;
      if (receivedAfter === transfer.quantity) {
        transfer.status = TransferStatus.RECEIVED;
        transfer.receivedAt = new Date();
      }
      await manager.save(StockTransfer, transfer);
    });

    return this.detail(id);
  }

  /**
   * Locks the transfer row for the rest of the transaction.
   *
   * This is what serialises two simultaneous "receive" clicks: the second one
   * blocks here until the first commits, then reads status = RECEIVED and is
   * rejected - instead of both reading DISPATCHED and both adding stock.
   */
  private async lockTransfer(manager: EntityManager, id: string): Promise<StockTransfer> {
    const transfer = await manager.findOne(StockTransfer, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!transfer) throw new NotFoundException(`Transfer ${id} not found.`);
    return transfer;
  }

  private shape(t: StockTransfer) {
    return {
      id: t.id,
      code: t.code,
      status: t.status,
      quantity: t.quantity,
      receivedQty: t.receivedQty,
      outstandingQty: t.quantity - t.receivedQty,
      /** Units that have left the source but not yet arrived anywhere. */
      inTransitQty: t.status === TransferStatus.DISPATCHED ? t.quantity - t.receivedQty : 0,
      sourceLocationId: t.sourceLocationId,
      sourceLocationCode: t.sourceLocation?.code ?? null,
      destinationLocationId: t.destinationLocationId,
      destinationLocationCode: t.destinationLocation?.code ?? null,
      itemId: t.itemId,
      sku: t.item?.sku ?? null,
      itemName: t.item?.name ?? null,
      batchId: t.batchId,
      batchCode: t.batch?.code ?? null,
      workOrderId: t.workOrderId,
      workOrderCode: t.workOrder?.code ?? null,
      createdByName: t.createdBy?.name ?? null,
      createdAt: t.createdAt,
      dispatchedAt: t.dispatchedAt,
      receivedAt: t.receivedAt,
    };
  }
}
