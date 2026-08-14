import {
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
import { OrderStatus } from '../../common/enums';
import { User } from './user.entity';
import { CustomerOrderLine } from './customer-order-line.entity';

@Entity('customer_orders')
@Index(['status'])
export class CustomerOrder {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'SO-000001' })
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @ApiProperty({ example: 'Acme Industries' })
  @Column({ name: 'customer_name', type: 'varchar', length: 160 })
  customerName: string;

  @ApiProperty({ enum: OrderStatus })
  @Column({
    type: 'enum',
    enum: OrderStatus,
    enumName: 'order_status',
    default: OrderStatus.DRAFT,
  })
  status: OrderStatus;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'created_by_id', type: 'uuid' })
  createdById: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => User, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'created_by_id' })
  createdBy: User;

  @OneToMany(() => CustomerOrderLine, (line) => line.order, { cascade: ['insert'] })
  lines: CustomerOrderLine[];
}
