import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Item } from './item.entity';
import { Location } from './location.entity';
import { Batch } from './batch.entity';

/**
 * One stock bucket = one (item, location, batch) combination.
 *
 * Correctness strategy - three independent layers, strongest last:
 *
 *   1. Service layer validates the request (positive integers, item exists...).
 *   2. Every mutation takes a `SELECT ... FOR UPDATE` row lock, so two
 *      concurrent requests are serialised against this exact row.
 *   3. The DATABASE enforces the invariants below. Even if layers 1 and 2 had
 *      a bug, or somebody ran an UPDATE by hand in psql, the constraints make
 *      negative stock and over-reservation physically impossible to store.
 */
@Entity('inventory')
@Unique('UQ_inventory_item_location_batch', ['itemId', 'locationId', 'batchId'])
@Index(['locationId', 'itemId'])
// Stock on hand can never go below zero.
@Check('CHK_inventory_physical_non_negative', '"physical_qty" >= 0')
// A negative hold is meaningless.
@Check('CHK_inventory_reserved_non_negative', '"reserved_qty" >= 0')
// THE key invariant: you cannot promise more than you physically hold.
// This single line is what makes overselling impossible under concurrency.
@Check('CHK_inventory_reserved_lte_physical', '"reserved_qty" <= "physical_qty"')
export class Inventory {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'batch_id', type: 'uuid' })
  batchId: string;

  @ApiProperty({ example: 100, description: 'Units physically present at this location' })
  @Column({ name: 'physical_qty', type: 'integer', default: 0 })
  physicalQty: number;

  @ApiProperty({ example: 30, description: 'Units promised to customer orders but not yet shipped' })
  @Column({ name: 'reserved_qty', type: 'integer', default: 0 })
  reservedQty: number;

  /**
   * Available = physical - reserved.
   *
   * This is a PostgreSQL STORED GENERATED column, not an application-computed
   * field. The database recalculates it on every write, so it can never drift
   * out of sync with its inputs, and it can be filtered and indexed in SQL
   * (e.g. "find every location where available >= 40").
   */
  @ApiProperty({ example: 70, readOnly: true, description: 'physicalQty - reservedQty, computed by the database' })
  @Column({
    name: 'available_qty',
    type: 'integer',
    generatedType: 'STORED',
    asExpression: '"physical_qty" - "reserved_qty"',
    insert: false,
    update: false,
  })
  availableQty: number;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Item, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'item_id' })
  item: Item;

  @ManyToOne(() => Location, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'location_id' })
  location: Location;

  @ManyToOne(() => Batch, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'batch_id' })
  batch: Batch;

  @OneToMany('InventoryTransaction', 'inventory')
  transactions: any[];
}
