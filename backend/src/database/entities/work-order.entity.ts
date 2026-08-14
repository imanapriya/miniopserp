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
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { WorkOrderStatus } from '../../common/enums';
import { Location } from './location.entity';
import { Item } from './item.entity';
import { User } from './user.entity';

/**
 * A job at a location that consumes material.
 *
 * Lifecycle and its inventory effect:
 *   ASSIGNED     - nothing reserved yet; shortage is reported on read
 *   IN_PROGRESS  - required material is RESERVED at the work order's location
 *   COMPLETED    - reserved material is CONSUMED (physical and reserved both drop)
 */
@Entity('work_orders')
@Index(['status'])
@Index(['locationId', 'itemId'])
@Check('CHK_work_order_qty_positive', '"required_qty" > 0')
export class WorkOrder {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'WO-000001', description: 'Human-readable work order number' })
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @ApiProperty({ example: 50 })
  @Column({ name: 'required_qty', type: 'integer' })
  requiredQty: number;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'assigned_to_id', type: 'uuid' })
  assignedToId: string;

  @ApiProperty({ enum: WorkOrderStatus })
  @Column({
    type: 'enum',
    enum: WorkOrderStatus,
    enumName: 'work_order_status',
    default: WorkOrderStatus.ASSIGNED,
  })
  status: WorkOrderStatus;

  @ApiProperty({ required: false, nullable: true })
  @Column({ type: 'varchar', length: 500, nullable: true })
  notes: string | null;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @ApiProperty({ required: false, nullable: true })
  @Column({ name: 'started_at', type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @ApiProperty({ required: false, nullable: true })
  @Column({ name: 'completed_at', type: 'timestamptz', nullable: true })
  completedAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => Location, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'location_id' })
  location: Location;

  @ManyToOne(() => Item, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'item_id' })
  item: Item;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'assigned_to_id' })
  assignedTo: User;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @OneToMany('StockTransfer', 'workOrder')
  transfers: any[];
}
