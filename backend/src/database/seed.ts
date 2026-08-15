import 'reflect-metadata';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as bcrypt from 'bcryptjs';
import { DataSource, EntityManager } from 'typeorm';
import { buildDataSourceOptions } from './data-source';
import {
  Batch,
  Category,
  Inventory,
  InventoryTransaction,
  Item,
  Location,
  User,
} from './entities';
import { InventoryTxnType, Role } from '../common/enums';

dotenv.config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

/**
 * Seeds demo data that walks straight into the required flow:
 *
 *   Steel Rod 12mm - 30 units at WH-A, 80 at WH-B
 *   A work order at WH-A needing 50 is therefore SHORT BY 20,
 *   which is exactly the case an internal transfer from WH-B solves.
 *
 * Note that stock is seeded THROUGH the ledger, not straight into balances,
 * so `GET /api/inventory/reconcile` returns balanced=true on a fresh database.
 */

const PASSWORD = process.env.SEED_PASSWORD ?? 'Password@123';

async function seedStock(
  manager: EntityManager,
  params: { item: Item; location: Location; batch: Batch; quantity: number; userId: string },
) {
  const bucket = await manager.save(
    manager.create(Inventory, {
      itemId: params.item.id,
      locationId: params.location.id,
      batchId: params.batch.id,
      physicalQty: 0,
      reservedQty: 0,
    }),
  );

  await manager.query(
    `UPDATE "inventory" SET "physical_qty" = $1 WHERE "id" = $2`,
    [params.quantity, bucket.id],
  );

  // The matching ledger row keeps the audit trail complete from day one.
  await manager.save(
    manager.create(InventoryTransaction, {
      inventoryId: bucket.id,
      type: InventoryTxnType.RECEIPT,
      physicalDelta: params.quantity,
      reservedDelta: 0,
      refType: 'SEED',
      note: 'Opening balance',
      idempotencyKey: `SEED:${params.location.code}:${params.item.sku}:${params.batch.code}`,
      createdById: params.userId,
    }),
  );
}

async function run() {
  const dataSource = new DataSource(buildDataSourceOptions());
  await dataSource.initialize();

  try {
    await dataSource.transaction(async (manager) => {
      const existing = await manager.count(User);
      if (existing > 0) {
        console.log('⏭  Database already seeded - nothing to do.');
        console.log('   Run `npm run db:reset` if you want a clean slate.');
        return;
      }

      console.log('→ Seeding locations, categories, items and batches...');

      const [whA, whB, whC] = await manager.save(Location, [
        manager.create(Location, { code: 'WH-A', name: 'Warehouse A - Hyderabad' }),
        manager.create(Location, { code: 'WH-B', name: 'Warehouse B - Chennai' }),
        manager.create(Location, { code: 'WH-C', name: 'Warehouse C - Pune' }),
      ]);

      const [raw, pack] = await manager.save(Category, [
        manager.create(Category, { code: 'RAW', name: 'Raw Material' }),
        manager.create(Category, { code: 'PACK', name: 'Packaging' }),
      ]);

      const [rod, bearing, box] = await manager.save(Item, [
        manager.create(Item, { sku: 'STL-ROD-12', name: 'Steel Rod 12mm', uom: 'EA', categoryId: raw.id }),
        manager.create(Item, { sku: 'BRG-6203', name: 'Ball Bearing 6203', uom: 'EA', categoryId: raw.id }),
        manager.create(Item, { sku: 'BOX-STD-01', name: 'Standard Carton Box', uom: 'EA', categoryId: pack.id }),
      ]);

      const [rodB1, rodB2, brgB1, boxB1] = await manager.save(Batch, [
        manager.create(Batch, { itemId: rod.id, code: 'B-2026-01', expiryDate: '2028-01-31' }),
        manager.create(Batch, { itemId: rod.id, code: 'B-2026-02', expiryDate: '2028-06-30' }),
        manager.create(Batch, { itemId: bearing.id, code: 'B-2026-01', expiryDate: null }),
        manager.create(Batch, { itemId: box.id, code: 'B-2026-01', expiryDate: null }),
      ]);

      console.log('→ Seeding users...');

      const passwordHash = await bcrypt.hash(PASSWORD, Number(process.env.BCRYPT_ROUNDS ?? 10));

      const [admin, ops] = await manager.save(User, [
        manager.create(User, {
          email: 'admin@ops-erp.local',
          name: 'Asha Admin',
          passwordHash,
          role: Role.ADMIN,
          locationId: whA.id,
        }),
        manager.create(User, {
          email: 'ops@ops-erp.local',
          name: 'Omar Operations',
          passwordHash,
          role: Role.OPERATIONS,
          locationId: whA.id,
        }),
        manager.create(User, {
          email: 'sales@ops-erp.local',
          name: 'Sana Sales',
          passwordHash,
          role: Role.SALES,
          locationId: whB.id,
        }),
        manager.create(User, {
          email: 'ops2@ops-erp.local',
          name: 'Bilal Operations',
          passwordHash,
          role: Role.OPERATIONS,
          locationId: whB.id,
        }),
      ]);

      console.log('→ Seeding opening stock...');

      // Deliberately short at WH-A so the work order demo has a shortage.
      await seedStock(manager, { item: rod, location: whA, batch: rodB1, quantity: 30, userId: admin.id });
      await seedStock(manager, { item: rod, location: whB, batch: rodB1, quantity: 50, userId: admin.id });
      await seedStock(manager, { item: rod, location: whB, batch: rodB2, quantity: 30, userId: admin.id });
      await seedStock(manager, { item: bearing, location: whA, batch: brgB1, quantity: 120, userId: admin.id });
      await seedStock(manager, { item: bearing, location: whB, batch: brgB1, quantity: 45, userId: ops.id });
      await seedStock(manager, { item: box, location: whC, batch: boxB1, quantity: 500, userId: ops.id });
    });

    console.log('');
    console.log('✅ Seed complete.');
    console.log('');
    console.log('   Login with password:', PASSWORD);
    console.log('   ┌───────────────────────┬────────────┬──────────────────────────────────┐');
    console.log('   │ admin@ops-erp.local   │ ADMIN      │ create work orders, reconcile    │');
    console.log('   │ ops@ops-erp.local     │ OPERATIONS │ inventory receipts, transfers    │');
    console.log('   │ sales@ops-erp.local   │ SALES      │ customer orders, reservations    │');
    console.log('   └───────────────────────┴────────────┴──────────────────────────────────┘');
    console.log('');
    console.log('   Demo path: Steel Rod 12mm has 30 at WH-A and 80 at WH-B.');
    console.log('   Create a work order at WH-A for 50 -> it reports a shortage of 20 ->');
    console.log('   transfer 20 from WH-B -> dispatch -> receive -> the shortage clears.');
    console.log('');
  } finally {
    await dataSource.destroy();
  }
}

run().catch((error) => {
  console.error('❌ Seed failed:', error);
  process.exit(1);
});
