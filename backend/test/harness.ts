import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { DataSource } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { Role } from '../src/common/enums';
import { Batch, Category, Item, Location, User } from '../src/database/entities';

export const TEST_PASSWORD = 'Password@123';

export interface Harness {
  app: INestApplication;
  dataSource: DataSource;
  http: () => ReturnType<typeof request>;
  close: () => Promise<void>;
  truncate: () => Promise<void>;
}

/**
 * Boots the real application - the same modules, the same global guards, the
 * same validation pipe and exception filter that `main.ts` wires up.
 *
 * These are end-to-end tests on purpose. The rules under test (locking,
 * transactions, CHECK constraints) live in the interaction between the service
 * layer and PostgreSQL, so mocking the database would test nothing that
 * matters.
 */
export async function createHarness(): Promise<Harness> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  await app.init();

  const dataSource = app.get(DataSource);

  const truncate = async () => {
    await dataSource.query(`
      TRUNCATE TABLE
        "inventory_transactions", "reservations", "customer_order_lines",
        "customer_orders", "stock_transfers", "work_orders", "inventory",
        "batches", "items", "categories", "users", "locations"
      RESTART IDENTITY CASCADE
    `);
  };

  return {
    app,
    dataSource,
    http: () => request(app.getHttpServer()),
    close: async () => {
      await app.close();
    },
    truncate,
  };
}

export interface Fixtures {
  locations: { A: string; B: string };
  category: string;
  item: string;
  batch: string;
  batch2: string;
  users: Record<'admin' | 'ops' | 'sales', { id: string; email: string; token: string }>;
}

/**
 * Builds a clean world for one test: two locations, one item with two batches,
 * and one user per role, each already logged in.
 */
export async function seedFixtures(h: Harness): Promise<Fixtures> {
  await h.truncate();

  const manager = h.dataSource.manager;

  const [locA, locB] = await manager.save(Location, [
    manager.create(Location, { code: 'WH-A', name: 'Warehouse A' }),
    manager.create(Location, { code: 'WH-B', name: 'Warehouse B' }),
  ]);

  const category = await manager.save(
    manager.create(Category, { code: 'RAW', name: 'Raw Material' }),
  );

  const item = await manager.save(
    manager.create(Item, { sku: 'STL-ROD-12', name: 'Steel Rod 12mm', categoryId: category.id }),
  );

  const [batch, batch2] = await manager.save(Batch, [
    manager.create(Batch, { itemId: item.id, code: 'B-001', expiryDate: '2028-01-31' }),
    manager.create(Batch, { itemId: item.id, code: 'B-002', expiryDate: '2028-12-31' }),
  ]);

  const passwordHash = await bcrypt.hash(TEST_PASSWORD, 4);
  const created = await manager.save(User, [
    manager.create(User, {
      email: 'admin@test.local', name: 'Admin', passwordHash, role: Role.ADMIN, locationId: locA.id,
    }),
    manager.create(User, {
      email: 'ops@test.local', name: 'Ops', passwordHash, role: Role.OPERATIONS, locationId: locA.id,
    }),
    manager.create(User, {
      email: 'sales@test.local', name: 'Sales', passwordHash, role: Role.SALES, locationId: locB.id,
    }),
  ]);

  const login = async (email: string) => {
    const res = await h.http().post('/api/auth/login').send({ email, password: TEST_PASSWORD });
    if (res.status !== 200) {
      throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    }
    return res.body.accessToken as string;
  };

  const [admin, ops, sales] = created;

  return {
    locations: { A: locA.id, B: locB.id },
    category: category.id,
    item: item.id,
    batch: batch.id,
    batch2: batch2.id,
    users: {
      admin: { id: admin.id, email: admin.email, token: await login(admin.email) },
      ops: { id: ops.id, email: ops.email, token: await login(ops.email) },
      sales: { id: sales.id, email: sales.email, token: await login(sales.email) },
    },
  };
}

/** Receives stock through the real API so the ledger stays consistent. */
export async function receiveStock(
  h: Harness,
  f: Fixtures,
  params: { locationId: string; quantity: number; batchId?: string },
) {
  const res = await h
    .http()
    .post('/api/inventory/receipt')
    .set('Authorization', `Bearer ${f.users.ops.token}`)
    .send({
      itemId: f.item,
      locationId: params.locationId,
      batchId: params.batchId ?? f.batch,
      quantity: params.quantity,
    });

  if (res.status !== 201 && res.status !== 200) {
    throw new Error(`Stock receipt failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body;
}

/** Current physical/reserved/available for one (item, location, batch). */
export async function readBucket(
  h: Harness,
  f: Fixtures,
  locationId: string,
  batchId?: string,
): Promise<{ physicalQty: number; reservedQty: number; availableQty: number } | null> {
  const rows = await h.dataSource.query(
    `SELECT "physical_qty"::int  AS "physicalQty",
            "reserved_qty"::int  AS "reservedQty",
            "available_qty"::int AS "availableQty"
       FROM "inventory"
      WHERE "item_id" = $1 AND "location_id" = $2 AND "batch_id" = $3`,
    [f.item, locationId, batchId ?? f.batch],
  );
  return rows[0] ?? null;
}

export const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
