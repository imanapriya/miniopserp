import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiHideProperty, ApiProperty } from '@nestjs/swagger';
import { Role } from '../../common/enums';
import { Location } from './location.entity';

@Entity('users')
@Index(['role'])
export class User {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'admin@ops-erp.local' })
  @Column({ type: 'varchar', length: 160, unique: true })
  email: string;

  @ApiProperty({ example: 'Asha Admin' })
  @Column({ type: 'varchar', length: 120 })
  name: string;

  /** bcrypt hash. Never selected by default, never serialised. */
  @ApiHideProperty()
  @Column({ name: 'password_hash', type: 'varchar', length: 120, select: false })
  passwordHash: string;

  @ApiProperty({ enum: Role })
  @Column({ type: 'enum', enum: Role, enumName: 'user_role' })
  role: Role;

  @ApiProperty({ default: true })
  @Column({ name: 'is_active', type: 'boolean', default: true })
  isActive: boolean;

  /**
   * Home location.
   *
   * Currently informational. It is the hook for a "users may only act on their
   * own location" rule - see docs/live-changes.md, change 4.
   */
  @ApiProperty({ required: false, nullable: true, format: 'uuid' })
  @Column({ name: 'location_id', type: 'uuid', nullable: true })
  locationId: string | null;

  @ManyToOne(() => Location, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'location_id' })
  location: Location | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;
}
