import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('locations')
export class Location {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'WH-A', description: 'Short unique code used in the UI and in transfer references' })
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @ApiProperty({ example: 'Warehouse A - Hyderabad' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @ApiProperty({ default: true })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany('Inventory', 'location')
  inventory: any[];

  @OneToMany('WorkOrder', 'location')
  workOrders: any[];
}
