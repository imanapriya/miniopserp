import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { EntityManager, QueryFailedError } from 'typeorm';
import { Inventory, InventoryTransaction } from '../database/entities';
import { InventoryTxnType } from '../common/enums';

export interface BucketKey {
  itemId: string;
  locationId: string;
  batchId: string;
}

export interface MovementInput {
  /** The bucket to change. MUST already be locked by `lockBucket`. */
  inventoryId: string;
  type: InventoryTxnType;
  /** Signed change to physical stock. */
  physicalDelta?: number;
  /** Signed change to reserved stock. */
  reservedDelta?: number;
  refType?: string;
  refId?: string;
  note?: string;
  /**
   * Business key of the movement. When supplied it is written to a UNIQUE
   * column, so replaying the same movement fails instead of double-applying.
   */
  idempotencyKey?: string;
  userId?: string;
}

const PG_UNIQUE_VIOLATION = '23505';
const PG_CHECK_VIOLATION = '23514';

/**
 * The single place where inventory quantities are allowed to change.
 *
 * Every module (receipts, transfers, work orders, customer orders) goes
 * through `applyMovement`. Concentrating writes here means the ledger can
 * never be bypassed and the concurrency strategy is implemented exactly once.
 *
 * ---------------------------------------------------------------------------
 * HOW OVERSELLING IS PREVENTED  (the crux of this assignment)
 * ---------------------------------------------------------------------------
 * Two Sales users both try to reserve 40 units when only 50 exist. Naive code
 * reads 50, both decide "50 >= 40, fine", and both write - selling 80 units
 * that do not exist. Read-then-write without a lock is the bug.
 *
 * The fix has three layers:
 *
 *   1. `lockBucket()` issues `SELECT ... FOR UPDATE` on the exact inventory
 *      row. PostgreSQL grants that row lock to one transaction at a time, so
 *      request B physically blocks at that statement until request A commits
 *      or rolls back. B therefore reads A's *result* (10 left), not the stale
 *      50, and correctly rejects.
 *
 *   2. The check itself happens after the lock is held, inside the same
 *      transaction as the write - so read and write cannot be interleaved.
 *
 *   3. The CHECK constraint `reserved_qty <= physical_qty` is the backstop.
 *      If somebody later adds a code path that forgets the lock, PostgreSQL
 *      still refuses to store an oversold row.
 *
 * Deadlock note: when several buckets must be locked (a multi-batch
 * allocation), they are always locked in the same deterministic order - FEFO,
 * then id. Two concurrent allocations therefore queue behind each other
 * rather than each holding what the other wants.
 */
@Injectable()
export class StockService {
  /**
   * Loads a bucket and holds a write lock on it for the rest of the
   * transaction. Every quantity change must be preceded by this call.
   */
  async lockBucketById(manager: EntityManager, inventoryId: string): Promise<Inventory> {
    const bucket = await manager.findOne(Inventory, {
      where: { id: inventoryId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!bucket) throw new NotFoundException(`Inventory record ${inventoryId} not found.`);
    return bucket;
  }

  /**
   * Locks the (item, location, batch) bucket, optionally creating it first.
   *
   * `createIfMissing` is needed when stock arrives somewhere it has never been
   * held before - a first receipt, or a transfer into a new location. Two
   * concurrent callers can both find nothing and both try to insert; the
   * unique constraint lets exactly one win and the loser simply re-reads the
   * row the winner created.
   */
  async lockOrCreateBucket(
    manager: EntityManager,
    key: BucketKey,
    createIfMissing = false,
  ): Promise<Inventory> {
    const existing = await manager.findOne(Inventory, {
      where: { itemId: key.itemId, locationId: key.locationId, batchId: key.batchId },
      lock: { mode: 'pessimistic_write' },
    });
    if (existing) return existing;

    if (!createIfMissing) {
      throw new NotFoundException(
        'No inventory record exists for this item, location and batch combination.',
      );
    }

    try {
      const created = manager.create(Inventory, { ...key, physicalQty: 0, reservedQty: 0 });
      const saved = await manager.save(Inventory, created);
      return await this.lockBucketById(manager, saved.id);
    } catch (error) {
      if (error instanceof QueryFailedError && (error as any).code === PG_UNIQUE_VIOLATION) {
        // A concurrent transaction created it first. Re-read under the lock.
        const raced = await manager.findOne(Inventory, {
          where: { itemId: key.itemId, locationId: key.locationId, batchId: key.batchId },
          lock: { mode: 'pessimistic_write' },
        });
        if (raced) return raced;
      }
      throw error;
    }
  }

  /**
   * Applies a signed change to a locked bucket and records it in the ledger.
   *
   * Order matters: the ledger row is written FIRST so that a duplicate
   * `idempotencyKey` aborts the transaction before any quantity moves.
   */
  async applyMovement(manager: EntityManager, input: MovementInput): Promise<Inventory> {
    const physicalDelta = input.physicalDelta ?? 0;
    const reservedDelta = input.reservedDelta ?? 0;

    if (physicalDelta === 0 && reservedDelta === 0) {
      throw new BadRequestException('A stock movement must change at least one quantity.');
    }
    if (!Number.isInteger(physicalDelta) || !Number.isInteger(reservedDelta)) {
      throw new BadRequestException('Stock movements must be whole units.');
    }

    // 1. Claim the movement. A duplicate business key collides on the unique
    //    index here, which is what makes "receive the same transfer twice"
    //    and "submit the same receipt twice" impossible rather than unlikely.
    try {
      await manager.insert(InventoryTransaction, {
        inventoryId: input.inventoryId,
        type: input.type,
        physicalDelta,
        reservedDelta,
        refType: input.refType ?? null,
        refId: input.refId ?? null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey ?? null,
        createdById: input.userId ?? null,
      });
    } catch (error) {
      if (
        error instanceof QueryFailedError &&
        (error as any).code === PG_UNIQUE_VIOLATION &&
        input.idempotencyKey
      ) {
        throw new ConflictException(
          `This operation has already been applied (movement "${input.idempotencyKey}"). It cannot be repeated.`,
        );
      }
      throw error;
    }

    // 2. Apply the deltas. Done as an atomic SQL expression rather than
    //    read-modify-write, so the arithmetic happens in the database on the
    //    row we already hold the lock for.
    let updated: Inventory[];
    try {
      updated = await manager.query(
        `UPDATE "inventory"
            SET "physical_qty" = "physical_qty" + $1,
                "reserved_qty" = "reserved_qty" + $2,
                "updated_at"   = now()
          WHERE "id" = $3
      RETURNING "id", "item_id"      AS "itemId",
                "location_id"        AS "locationId",
                "batch_id"           AS "batchId",
                "physical_qty"       AS "physicalQty",
                "reserved_qty"       AS "reservedQty",
                "available_qty"      AS "availableQty"`,
        [physicalDelta, reservedDelta, input.inventoryId],
      );
    } catch (error) {
      if (error instanceof QueryFailedError && (error as any).code === PG_CHECK_VIOLATION) {
        // Reaching here means an application-level guard was missed. The
        // database caught it; surface it as a clean 409 rather than a 500.
        throw new ConflictException(
          'The requested quantity is not available. The database rejected the movement because it would leave stock negative or over-reserved.',
        );
      }
      throw error;
    }

    if (!updated?.length) {
      throw new NotFoundException(`Inventory record ${input.inventoryId} not found.`);
    }
    return updated[0] as unknown as Inventory;
  }

  /**
   * Buckets holding available stock for an item at a location, ordered FEFO -
   * earliest expiry first, then oldest batch. Locked in that same order by
   * callers, which keeps the lock ordering deterministic across transactions.
   */
  async findAvailableBuckets(
    manager: EntityManager,
    itemId: string,
    locationId: string,
  ): Promise<Array<{ id: string; availableQty: number; batchCode: string }>> {
    return manager.query(
      `SELECT inv."id",
              inv."available_qty" AS "availableQty",
              b."code"            AS "batchCode"
         FROM "inventory" inv
         JOIN "batches" b ON b."id" = inv."batch_id"
        WHERE inv."item_id" = $1
          AND inv."location_id" = $2
          AND inv."available_qty" > 0
        ORDER BY b."expiry_date" ASC NULLS LAST, b."code" ASC, inv."id" ASC`,
      [itemId, locationId],
    );
  }

  /** Total available units of an item at one location, across all batches. */
  async availableAtLocation(
    manager: EntityManager,
    itemId: string,
    locationId: string,
  ): Promise<number> {
    const rows = await manager.query(
      `SELECT COALESCE(SUM("available_qty"), 0)::int AS total
         FROM "inventory"
        WHERE "item_id" = $1 AND "location_id" = $2`,
      [itemId, locationId],
    );
    return rows[0]?.total ?? 0;
  }

  /**
   * Available units of an item at every OTHER location, so the UI can suggest
   * where to raise an internal transfer from when a work order is short.
   */
  async availabilityElsewhere(
    manager: EntityManager,
    itemId: string,
    excludeLocationId: string,
  ): Promise<Array<{ locationId: string; locationCode: string; locationName: string; availableQty: number }>> {
    return manager.query(
      `SELECT loc."id"   AS "locationId",
              loc."code" AS "locationCode",
              loc."name" AS "locationName",
              SUM(inv."available_qty")::int AS "availableQty"
         FROM "inventory" inv
         JOIN "locations" loc ON loc."id" = inv."location_id"
        WHERE inv."item_id" = $1
          AND inv."location_id" <> $2
        GROUP BY loc."id", loc."code", loc."name"
       HAVING SUM(inv."available_qty") > 0
        ORDER BY SUM(inv."available_qty") DESC`,
      [itemId, excludeLocationId],
    );
  }
}
