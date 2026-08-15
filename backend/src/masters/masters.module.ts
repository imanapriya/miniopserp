import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Batch, Category, Item, Location, User } from '../database/entities';
import { MastersService } from './masters.service';
import { MastersController } from './masters.controller';

@Module({
  imports: [TypeOrmModule.forFeature([Location, Category, Item, Batch, User])],
  controllers: [MastersController],
  providers: [MastersService],
  exports: [MastersService],
})
export class MastersModule {}
