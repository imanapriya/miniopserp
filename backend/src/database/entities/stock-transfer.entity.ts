import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { TransferStatus } from '../../common/enums';
import { Location } from './location.entity';
import { Item } from './item.entity';
import { Batch } from './batch.entity';
import { User } from './user.entity';
import { WorkOrder } from './work-order.entity';

/**
 * Moves stock between locations in two committed steps, so that goods in
 * transit belong to neither end:
 *
 *   REQUESTED  -> nothing has moved. Source stock is still fully available.
 *   DISPATCHED -> source physicalQty is reduced. Destination is UNCHANGED.
 *                 The quantity is now "in transit" and deliberately invisible
 *                 to availability at both locations - you cannot sell it and
 *                 you cannot dispatch it again.
 *   RECEIVED   -> destination physicalQty increases.
 *
 * Receiving twice is blocked three ways, any one of which is sufficient:
 *   - the row is locked FOR UPDATE and its status re-read inside the txn,
 *   - the status machine rejects RECEIVED -> RECEIVED,
 *   - the ledger's unique idempotency key `TRANSFER:<id>:RECEIVE:<seq>` collides.
 */
@Entity('stock_transfers')
@Index(['status'])
@Index(['sourceLocationId'])
@Index(['destinationLocationId'])
@Check('CHK_transfer_qty_positive', '"quantity" > 0')
@Check('CHK_transfer_received_qty_range', '"received_qty" >= 0 AND "received_qty" <= "quantity"')
// A transfer to the same place is a no-op that would corrupt the ledger.
@Check('CHK_transfer_distinct_locations', '"source_location_id" <> "destination_location_id"')
export class StockTransfer {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'TR-000001' })
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'source_location_id', type: 'uuid' })
  sourceLocationId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'destination_location_id', type: 'uuid' })
  destinationLocationId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @ApiProperty({ example: 20 })
  @Column({ type: 'integer' })
  quantity: number;

  /**
   * Supports partial receipt: a dispatch of 20 may arrive as 12 then 8.
   * The transfer only reaches RECEIVED when receivedQty === quantity.
   */
  @ApiProperty({ example: 0, description: 'Cumulative quantity received so far' })
  @Column({ name: 'received_qty', type: 'integer', default: 0 })
  receivedQty: number;

  @ApiProperty({ enum: TransferStatus })
  @Column({
    type: 'enum',
    enum: TransferStatus,
    enumName: 'transfer_status',
    default: TransferStatus.REQUESTED,
  })
  status: TransferStatus;

  @ApiProperty({ required: false, nullable: true, format: 'uuid', description: 'Work order this transfer covers the shortage for' })
  @Column({ name: 'work_order_id', type: 'uuid', nullable: true })
  workOrderId: string | null;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ApiProperty({ required: false, nullable: true })
  @Column({ name: 'dispatched_at', type: 'timestamptz', nullable: true })
  dispatchedAt: Date | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ name: 'received_at', type: 'timestamptz', nullable: true })
  receivedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Location, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'source_location_id' })
  sourceLocation: Location;

  @ManyToOne(() => Location, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'destination_location_id' })
  destinationLocation: Location;

  @ManyToOne(() => Item, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'item_id' })
  item: Item;

  @ManyToOne(() => Batch, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @ManyToOne(() => WorkOrder, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'work_order_id' })
  workOrder: WorkOrder | null;
}
