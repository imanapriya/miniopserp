import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { InventoryTxnType } from '../../common/enums';
import { Inventory } from './inventory.entity';
import { User } from './user.entity';

/**
 * Append-only stock ledger. Rows are never updated and never deleted.
 *
 * Two jobs:
 *
 *   1. AUDIT - every change to physicalQty / reservedQty writes exactly one row
 *      carrying the deltas, so the current balance is always reproducible:
 *          SUM(physical_delta) per bucket === inventory.physical_qty
 *          SUM(reserved_delta) per bucket === inventory.reserved_qty
 *      `GET /inventory/reconcile` asserts that at runtime.
 *
 *   2. DUPLICATE PROTECTION - see `idempotencyKey`.
 */
@Entity('inventory_transactions')
@Index(['inventoryId', 'createdAt'])
@Index(['refType', 'refId'])
export class InventoryTransaction {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'inventory_id', type: 'uuid' })
  inventoryId: string;

  @ApiProperty({ enum: InventoryTxnType })
  @Column({ type: 'enum', enum: InventoryTxnType, enumName: 'inventory_txn_type' })
  type: InventoryTxnType;

  @ApiProperty({ example: -25, description: 'Signed change applied to physicalQty' })
  @Column({ name: 'physical_delta', type: 'integer', default: 0 })
  physicalDelta: number;

  @ApiProperty({ example: 25, description: 'Signed change applied to reservedQty' })
  @Column({ name: 'reserved_delta', type: 'integer', default: 0 })
  reservedDelta: number;

  @ApiProperty({ required: false, nullable: true, example: 'TRANSFER' })
  @Column({ name: 'ref_type', type: 'varchar', length: 32, nullable: true })
  refType: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @Column({ name: 'ref_id', type: 'uuid', nullable: true })
  refId: string | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  note: string | null;

  /**
   * Business key of this movement, e.g. `TRANSFER:<id>:RECEIVE`.
   *
   * UNIQUE, so the same logical movement can physically never be applied twice
   * - a double-clicked button, a retried HTTP call, a replayed queue message
   * all collide on this index and the second one is rejected by PostgreSQL.
   *
   * This is the database-level answer to two requirements at once:
   *   - "the system must prevent duplicate inventory transactions"
   *   - "the same transfer cannot be received twice"
   *
   * Nullable, because ad-hoc movements (a manual stock adjustment) have no
   * natural business key; PostgreSQL allows many NULLs in a unique index.
   */
  @ApiProperty({ required: false, nullable: true, example: 'TRANSFER:9f3b...:RECEIVE' })
  @Column({ name: 'idempotency_key', type: 'varchar', length: 160, nullable: true, unique: true })
  idempotencyKey: string | null;

  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @Column({ name: 'created_by_id', type: 'uuid', nullable: true })
  createdById: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Inventory, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'inventory_id' })
  inventory: Inventory;

  @ManyToOne(() => User, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User | null;
}
