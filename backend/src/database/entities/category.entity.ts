import {
  Column,
  CreateDateColumn,
  Entity,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

@Entity('categories')
export class Category {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'RAW' })
  @Column({ type: 'varchar', length: 32, unique: true })
  code: string;

  @ApiProperty({ example: 'Raw Material' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @OneToMany('Item', 'category')
  items: any[];
}
