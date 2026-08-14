import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Item } from './item.entity';

/**
 * A batch / lot of a specific item.
 *
 * Modelled as its own table rather than a plain string column on `inventory`
 * so that batch attributes (expiry, later: supplier, cost) live in one place,
 * and so reservations can allocate stock FEFO - first expiring, first out.
 */
@Entity('batches')
@Unique('UQ_batch_item_code', ['itemId', 'code'])
@Index(['expiryDate'])
export class Batch {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'B-2026-04' })
  @Column({ type: 'varchar', length: 64 })
  code: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'item_id', type: 'uuid' })
  itemId: string;

  @ApiProperty({ required: false, nullable: true, type: String, format: 'date' })
  @Column({ name: 'expiry_date', type: 'date', nullable: true })
  expiryDate: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Item, { onDelete: 'CASCADE', nullable: false })
  @JoinColumn({ name: 'item_id' })
  item: Item;

  @OneToMany('Inventory', 'batch')
  inventory: any[];
}
