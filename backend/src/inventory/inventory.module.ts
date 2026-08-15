import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Batch, Inventory, InventoryTransaction, Item, Location } from '../database/entities';
import { InventoryService } from './inventory.service';
import { InventoryController } from './inventory.controller';
import { StockService } from './stock.service';

@Module({
  imports: [TypeOrmModule.forFeature([Inventory, InventoryTransaction, Item, Location, Batch])],
  controllers: [InventoryController],
  providers: [InventoryService, StockService],
  // StockService is the only sanctioned way to move stock, so every other
  // module imports it from here rather than writing its own SQL.
  exports: [StockService, InventoryService],
})
export class InventoryModule {}
