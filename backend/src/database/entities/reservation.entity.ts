import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { ReservationStatus } from '../../common/enums';
import { CustomerOrderLine } from './customer-order-line.entity';
import { Inventory } from './inventory.entity';

/**
 * A hold placed on ONE specific inventory bucket for ONE order line.
 *
 * A single order line can produce several reservations when it has to be
 * filled from several batches - allocation is FEFO (earliest expiry first),
 * which is the normal rule for anything perishable or lot-tracked.
 *
 * The sum of ACTIVE reservations against a bucket always equals that bucket's
 * `reserved_qty`; `GET /inventory/reconcile` verifies it.
 */
@Entity('reservations')
@Index(['orderLineId'])
@Index(['inventoryId', 'status'])
@Check('CHK_reservation_qty_positive', '"quantity" > 0')
export class Reservation {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'order_line_id', type: 'uuid' })
  orderLineId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'inventory_id', type: 'uuid' })
  inventoryId: string;

  @ApiProperty({ example: 40 })
  @Column({ type: 'integer' })
  quantity: number;

  @ApiProperty({ enum: ReservationStatus })
  @Column({
    type: 'enum',
    enum: ReservationStatus,
    enumName: 'reservation_status',
    default: ReservationStatus.ACTIVE,
  })
  status: ReservationStatus;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty({ required: false, nullable: true })
  @Column({ name: 'released_at', type: 'timestamptz', nullable: true })
  releasedAt: Date | null;

  @ManyToOne(() => CustomerOrderLine, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'order_line_id' })
  orderLine: CustomerOrderLine;

  @ManyToOne(() => Inventory, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'inventory_id' })
  inventory: Inventory;
}
