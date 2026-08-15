import {
  auth,
  createHarness,
  Fixtures,
  Harness,
  readBucket,
  receiveStock,
  seedFixtures,
} from './harness';

/**
 * The remaining business rules from the brief that the five mandatory tests do
 * not cover directly: shortage calculation, negative-stock prevention, invalid
 * quantities, duplicate transactions, status machines and ledger integrity.
 */
describe('Business rules and data integrity', () => {
  let h: Harness;
  let f: Fixtures;

  beforeAll(async () => {
    h = await createHarness();
  });

  afterAll(async () => {
    await h.close();
  });

  beforeEach(async () => {
    f = await seedFixtures(h);
  });

  const createWorkOrder = (requiredQty: number) =>
    h
      .http()
      .post('/api/work-orders')
      .set(auth(f.users.admin.token))
      .send({
        locationId: f.locations.A,
        itemId: f.item,
        requiredQty,
        assignedToId: f.users.ops.id,
      });

  describe('work order shortage is calculated automatically', () => {
    it('reports the shortage and where it could be covered from', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 30 });
      await receiveStock(h, f, { locationId: f.locations.B, quantity: 80 });

      const res = await createWorkOrder(50);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        requiredQty: 50,
        availableQty: 30,
        shortageQty: 20,
        materialStatus: 'SHORTAGE',
        canStart: false,
      });
      expect(res.body.suggestedSources).toEqual([
        expect.objectContaining({ locationCode: 'WH-B', availableQty: 80 }),
      ]);
    });

    it('reports no shortage when there is enough', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 80 });

      const res = await createWorkOrder(50);
      expect(res.body).toMatchObject({
        shortageQty: 0,
        materialStatus: 'SUFFICIENT',
        canStart: true,
      });
      expect(res.body.suggestedSources).toEqual([]);
    });

    it('recalculates the shortage as stock arrives - it is never stored', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 30 });
      const wo = await createWorkOrder(50);
      expect(wo.body.shortageQty).toBe(20);

      await receiveStock(h, f, { locationId: f.locations.A, quantity: 20, batchId: f.batch2 });

      const after = await h
        .http()
        .get(`/api/work-orders/${wo.body.id}`)
        .set(auth(f.users.admin.token))
        .expect(200);
      expect(after.body.shortageQty).toBe(0);
      expect(after.body.availableQty).toBe(50);
    });
  });

  describe('work order lifecycle moves inventory', () => {
    it('reserves on start and consumes on completion', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 80 });
      const wo = await createWorkOrder(50);
      const id = wo.body.id;

      await h
        .http()
        .patch(`/api/work-orders/${id}/status`)
        .set(auth(f.users.ops.token))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);

      // Held, not yet consumed: physical unchanged, available down.
      expect(await readBucket(h, f, f.locations.A)).toMatchObject({
        physicalQty: 80,
        reservedQty: 50,
        availableQty: 30,
      });

      await h
        .http()
        .patch(`/api/work-orders/${id}/status`)
        .set(auth(f.users.ops.token))
        .send({ status: 'COMPLETED' })
        .expect(200);

      // Consumed: physical and reserved both drop.
      expect(await readBucket(h, f, f.locations.A)).toMatchObject({
        physicalQty: 30,
        reservedQty: 0,
        availableQty: 30,
      });
    });

    it('refuses to start a work order that is short of material', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 30 });
      const wo = await createWorkOrder(50);

      const res = await h
        .http()
        .patch(`/api/work-orders/${wo.body.id}/status`)
        .set(auth(f.users.ops.token))
        .send({ status: 'IN_PROGRESS' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Shortage is 20/i);
      expect((await readBucket(h, f, f.locations.A)).reservedQty).toBe(0);
    });

    it('rejects an illegal status jump', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 80 });
      const wo = await createWorkOrder(50);

      const res = await h
        .http()
        .patch(`/api/work-orders/${wo.body.id}/status`)
        .set(auth(f.users.ops.token))
        .send({ status: 'COMPLETED' });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/Cannot move work order/i);
    });
  });

  describe('the system prevents invalid inventory data', () => {
    it('rejects a zero or negative quantity', async () => {
      for (const quantity of [0, -5]) {
        const res = await h
          .http()
          .post('/api/inventory/receipt')
          .set(auth(f.users.ops.token))
          .send({ itemId: f.item, locationId: f.locations.A, batchId: f.batch, quantity });
        expect(res.status).toBe(400);
      }
    });

    it('rejects a fractional quantity', async () => {
      const res = await h
        .http()
        .post('/api/inventory/receipt')
        .set(auth(f.users.ops.token))
        .send({ itemId: f.item, locationId: f.locations.A, batchId: f.batch, quantity: 2.5 });

      expect(res.status).toBe(400);
      expect(JSON.stringify(res.body.message)).toMatch(/whole number/i);
    });

    it('rejects unknown fields instead of silently ignoring them', async () => {
      const res = await h
        .http()
        .post('/api/inventory/receipt')
        .set(auth(f.users.ops.token))
        .send({
          itemId: f.item,
          locationId: f.locations.A,
          batchId: f.batch,
          quantity: 10,
          physicalQty: 99999, // an attempt to set the balance directly
        });

      expect(res.status).toBe(400);
    });

    it('never allows physical stock to go negative', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 10 });
      const inv = await h.http().get('/api/inventory').set(auth(f.users.ops.token)).expect(200);

      const res = await h
        .http()
        .post('/api/inventory/adjustment')
        .set(auth(f.users.ops.token))
        .send({ inventoryId: inv.body.data[0].id, delta: -25, reason: 'write-off' });

      expect(res.status).toBe(400);
      expect((await readBucket(h, f, f.locations.A)).physicalQty).toBe(10);
    });

    it('will not write off stock that is reserved for a customer', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 20 });
      await h
        .http()
        .post('/api/orders')
        .set(auth(f.users.sales.token))
        .send({
          customerName: 'Acme',
          lines: [{ itemId: f.item, locationId: f.locations.A, quantity: 18 }],
          reserveImmediately: true,
        })
        .expect(201);

      const inv = await h.http().get('/api/inventory').set(auth(f.users.ops.token)).expect(200);
      const res = await h
        .http()
        .post('/api/inventory/adjustment')
        .set(auth(f.users.ops.token))
        .send({ inventoryId: inv.body.data[0].id, delta: -5, reason: 'damage' });

      expect(res.status).toBe(400);
      expect(res.body.message).toMatch(/only 2 are unreserved/i);
    });

    it('the database itself refuses an over-reserved row', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 10 });

      // Bypasses the service layer entirely - straight SQL, as a careless
      // maintenance script might do. The CHECK constraint must still hold.
      await expect(
        h.dataSource.query(
          `UPDATE "inventory" SET "reserved_qty" = 999 WHERE "item_id" = $1 AND "location_id" = $2`,
          [f.item, f.locations.A],
        ),
      ).rejects.toThrow(/CHK_inventory_reserved_lte_physical|violates check constraint/i);
    });
  });

  describe('duplicate inventory transactions are impossible', () => {
    it('rejects a repeated receipt that carries the same reference', async () => {
      const body = {
        itemId: f.item,
        locationId: f.locations.A,
        batchId: f.batch,
        quantity: 25,
        reference: 'GRN-4471',
      };

      await h.http().post('/api/inventory/receipt').set(auth(f.users.ops.token)).send(body).expect(201);

      const duplicate = await h
        .http()
        .post('/api/inventory/receipt')
        .set(auth(f.users.ops.token))
        .send(body);

      expect(duplicate.status).toBe(409);
      expect(duplicate.body.message).toMatch(/already been applied/i);

      // 25, not 50.
      expect((await readBucket(h, f, f.locations.A)).physicalQty).toBe(25);
    });
  });

  describe('available quantity is computed by the database', () => {
    it('always equals physical minus reserved', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 60 });
      await h
        .http()
        .post('/api/orders')
        .set(auth(f.users.sales.token))
        .send({
          customerName: 'Acme',
          lines: [{ itemId: f.item, locationId: f.locations.A, quantity: 25 }],
          reserveImmediately: true,
        })
        .expect(201);

      const bucket = await readBucket(h, f, f.locations.A);
      expect(bucket.availableQty).toBe(bucket.physicalQty - bucket.reservedQty);
      expect(bucket).toMatchObject({ physicalQty: 60, reservedQty: 25, availableQty: 35 });
    });
  });

  describe('the ledger reconciles after a full operational day', () => {
    it('stays balanced across receipts, transfers, work orders and orders', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 30 });
      await receiveStock(h, f, { locationId: f.locations.B, quantity: 80 });

      // Work order short by 20 at A.
      const wo = await createWorkOrder(50);

      // Cover it with a transfer from B.
      const transfer = await h
        .http()
        .post('/api/transfers')
        .set(auth(f.users.ops.token))
        .send({
          sourceLocationId: f.locations.B,
          destinationLocationId: f.locations.A,
          itemId: f.item,
          batchId: f.batch,
          quantity: 20,
          workOrderId: wo.body.id,
        })
        .expect(201);

      await h
        .http()
        .post(`/api/transfers/${transfer.body.id}/dispatch`)
        .set(auth(f.users.ops.token))
        .expect(200);
      await h
        .http()
        .post(`/api/transfers/${transfer.body.id}/receive`)
        .set(auth(f.users.ops.token))
        .send({})
        .expect(200);

      // Run the work order through to completion.
      await h
        .http()
        .patch(`/api/work-orders/${wo.body.id}/status`)
        .set(auth(f.users.ops.token))
        .send({ status: 'IN_PROGRESS' })
        .expect(200);
      await h
        .http()
        .patch(`/api/work-orders/${wo.body.id}/status`)
        .set(auth(f.users.ops.token))
        .send({ status: 'COMPLETED' })
        .expect(200);

      // Sell some of what is left at B, then ship it.
      const order = await h
        .http()
        .post('/api/orders')
        .set(auth(f.users.sales.token))
        .send({
          customerName: 'Acme',
          lines: [{ itemId: f.item, locationId: f.locations.B, quantity: 40 }],
          reserveImmediately: true,
        })
        .expect(201);
      await h
        .http()
        .post(`/api/orders/${order.body.id}/fulfil`)
        .set(auth(f.users.sales.token))
        .expect(200);

      const reconcile = await h
        .http()
        .get('/api/inventory/reconcile')
        .set(auth(f.users.admin.token))
        .expect(200);

      expect(reconcile.body.balanced).toBe(true);
      expect(reconcile.body.discrepancies).toEqual([]);

      // Arithmetic check on the whole day:
      //   A: 30 in, 20 transferred in, 50 consumed by the work order  -> 0
      //   B: 80 in, 20 transferred out, 40 shipped                    -> 20
      expect((await readBucket(h, f, f.locations.A)).physicalQty).toBe(0);
      expect((await readBucket(h, f, f.locations.B)).physicalQty).toBe(20);
    });
  });
});
