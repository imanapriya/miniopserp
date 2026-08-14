import { Location } from './location.entity';
import { Category } from './category.entity';
import { Item } from './item.entity';
import { Batch } from './batch.entity';
import { User } from './user.entity';
import { Inventory } from './inventory.entity';
import { InventoryTransaction } from './inventory-transaction.entity';
import { WorkOrder } from './work-order.entity';
import { StockTransfer } from './stock-transfer.entity';
import { CustomerOrder } from './customer-order.entity';
import { CustomerOrderLine } from './customer-order-line.entity';
import { Reservation } from './reservation.entity';

export {
  Location,
  Category,
  Item,
  Batch,
  User,
  Inventory,
  InventoryTransaction,
  WorkOrder,
  StockTransfer,
  CustomerOrder,
  CustomerOrderLine,
  Reservation,
};

/** Single source of truth for the DataSource, the Nest module and the tests. */
export const ALL_ENTITIES = [
  Location,
  Category,
  Item,
  Batch,
  User,
  Inventory,
  InventoryTransaction,
  WorkOrder,
  StockTransfer,
  CustomerOrder,
  CustomerOrderLine,
  Reservation,
];
