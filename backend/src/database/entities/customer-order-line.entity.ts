import {
  Check,
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { CustomerOrder } from './customer-order.entity';
import { Item } from './item.entity';
import { Location } from './location.entity';

@Entity('customer_order_lines')
@Index(['orderId'])
@Check('CHK_order_line_qty_positive', '"quantity" > 0')
@Check('CHK_order_line_reserved_range', '"reserved_qty" >= 0 AND "reserved_qty" <= "quantity"')
export class CustomerOrderLine {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'order_id', type: 'uuid' })
  orderId: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @ApiProperty({ format: 'uuid', description: 'Location the customer is served from' })
  @Column({ name: 'location_id', type: 'uuid' })
  locationId: string;

  @ApiProperty({ example: 40 })
  @Column({ type: 'integer' })
  quantity: number;

  /** How much of `quantity` is currently held by ACTIVE reservations. */
  @ApiProperty({ example: 40 })
  @Column({ name: 'reserved_qty', type: 'integer', default: 0 })
  reservedQty: number;

  @ManyToOne(() => CustomerOrder, (order) => order.lines, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'order_id' })
  order: CustomerOrder;

  @ManyToOne(() => Item, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'item_id' })
  item: Item;

  @ManyToOne(() => Location, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'location_id' })
  location: Location;

  @OneToMany('Reservation', 'orderLine')
  reservations: any[];
}
