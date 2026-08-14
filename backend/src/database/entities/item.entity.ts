import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Category } from './category.entity';

@Entity('items')
@Index(['categoryId'])
export class Item {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'STL-ROD-12' })
  @Column({ type: 'varchar', length: 64, unique: true })
  sku: string;

  @ApiProperty({ example: 'Steel Rod 12mm' })
  @Column({ type: 'varchar', length: 160 })
  name: string;

  @ApiProperty({ example: 'EA', description: 'Unit of measure' })
  @Column({ type: 'varchar', length: 16, default: 'EA' })
  uom: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ name: 'category_id', type: 'uuid' })
  categoryId: string;

  @ApiProperty({ default: true })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @ManyToOne(() => Category, { onDelete: 'RESTRICT', nullable: false })
  @JoinColumn({ name: 'category_id' })
  category: Category;

  @OneToMany('Batch', 'item')
  batches: any[];

  @OneToMany('Inventory', 'item')
  inventory: any[];
}
