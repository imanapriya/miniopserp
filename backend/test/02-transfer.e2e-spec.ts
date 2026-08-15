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
 * MANDATORY TESTS 2, 3 and 4.
 *
 *   2 - Cannot transfer more than available inventory.
 *   3 - Destination stock increases only after transfer receipt.
 *   4 - The same transfer cannot be received twice.
 */
describe('Tests 2-4 - internal stock transfer', () => {
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

  const createTransfer = (quantity: number) =>
    h
      .http()
      .post('/api/transfers')
      .set(auth(f.users.ops.token))
      .send({
        sourceLocationId: f.locations.A,
        destinationLocationId: f.locations.B,
        itemId: f.item,
        batchId: f.batch,
        quantity,
      });

  // -------------------------------------------------------------- Test 2 ---
  describe('Test 2 - cannot transfer more than available inventory', () => {
    it('rejects a transfer larger than the stock at the source', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 30 });

      const res = await createTransfer(50);

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/only 30 are available/i);

      const source = await readBucket(h, f, f.locations.A);
      expect(source.physicalQty).toBe(30);
    });

    it('rejects a transfer of stock that is already reserved for a customer', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      // Reserve 45 of the 50, leaving only 5 genuinely available.
      const order = await h
        .http()
        .post('/api/orders')
        .set(auth(f.users.sales.token))
        .send({
          customerName: 'Acme',
          lines: [{ itemId: f.item, locationId: f.locations.A, quantity: 45 }],
          reserveImmediately: true,
        });
      expect(order.status).toBe(201);

      // Physical stock is 50, so a naive check would allow this. It must not:
      // reserved units are promised to a customer and cannot be shipped away.
      const res = await createTransfer(20);
      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/only 5 are available/i);
    });

    it('refuses to dispatch when stock disappeared between request and dispatch', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      // Transfer is raised while 50 are free - this is allowed.
      const transfer = await createTransfer(40);
      expect(transfer.status).toBe(201);

      // ...then a customer order takes most of the stock before dispatch.
      await h
        .http()
        .post('/api/orders')
        .set(auth(f.users.sales.token))
        .send({
          customerName: 'Acme',
          lines: [{ itemId: f.item, locationId: f.locations.A, quantity: 45 }],
          reserveImmediately: true,
        })
        .expect(201);

      // Dispatch re-checks under a row lock and is the authoritative gate.
      const res = await h
        .http()
        .post(`/api/transfers/${transfer.body.id}/dispatch`)
        .set(auth(f.users.ops.token));

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/only 5 are available/i);
    });

    it('rejects a transfer where source and destination are the same location', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      const res = await h
        .http()
        .post('/api/transfers')
        .set(auth(f.users.ops.token))
        .send({
          sourceLocationId: f.locations.A,
          destinationLocationId: f.locations.A,
          itemId: f.item,
          batchId: f.batch,
          quantity: 10,
        });

      expect(res.status).toBe(400);
    });
  });

  // -------------------------------------------------------------- Test 3 ---
  describe('Test 3 - destination stock increases only after receipt', () => {
    it('moves stock out on dispatch and in only on receipt', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      const transfer = await createTransfer(20);
      expect(transfer.status).toBe(201);
      expect(transfer.body.status).toBe('REQUESTED');
      const id = transfer.body.id;

      // --- while REQUESTED: nothing has moved anywhere -------------------
      expect((await readBucket(h, f, f.locations.A)).physicalQty).toBe(50);
      expect(await readBucket(h, f, f.locations.B)).toBeNull();

      // --- after DISPATCH: source down, destination still untouched ------
      const dispatched = await h
        .http()
        .post(`/api/transfers/${id}/dispatch`)
        .set(auth(f.users.ops.token));
      expect(dispatched.status).toBe(200);
      expect(dispatched.body.status).toBe('DISPATCHED');

      expect((await readBucket(h, f, f.locations.A)).physicalQty).toBe(30);
      // THE assertion for this test: the goods are in transit and must not
      // exist at the destination yet.
      expect(await readBucket(h, f, f.locations.B)).toBeNull();
      expect(dispatched.body.inTransitQty).toBe(20);

      // --- after RECEIPT: destination credited ---------------------------
      const received = await h
        .http()
        .post(`/api/transfers/${id}/receive`)
        .set(auth(f.users.ops.token))
        .send({});
      expect(received.status).toBe(200);
      expect(received.body.status).toBe('RECEIVED');

      expect((await readBucket(h, f, f.locations.A)).physicalQty).toBe(30);
      expect((await readBucket(h, f, f.locations.B)).physicalQty).toBe(20);

      // Nothing was created or destroyed along the way.
      const total =
        (await readBucket(h, f, f.locations.A)).physicalQty +
        (await readBucket(h, f, f.locations.B)).physicalQty;
      expect(total).toBe(50);
    });

    it('cannot receive a transfer that was never dispatched', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });
      const transfer = await createTransfer(20);

      const res = await h
        .http()
        .post(`/api/transfers/${transfer.body.id}/receive`)
        .set(auth(f.users.ops.token))
        .send({});

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/not been dispatched/i);
      expect(await readBucket(h, f, f.locations.B)).toBeNull();
    });
  });

  // -------------------------------------------------------------- Test 4 ---
  describe('Test 4 - the same transfer cannot be received twice', () => {
    it('rejects a second receipt and leaves destination stock unchanged', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      const transfer = await createTransfer(20);
      const id = transfer.body.id;
      await h.http().post(`/api/transfers/${id}/dispatch`).set(auth(f.users.ops.token)).expect(200);

      const first = await h
        .http()
        .post(`/api/transfers/${id}/receive`)
        .set(auth(f.users.ops.token))
        .send({});
      expect(first.status).toBe(200);
      expect((await readBucket(h, f, f.locations.B)).physicalQty).toBe(20);

      const second = await h
        .http()
        .post(`/api/transfers/${id}/receive`)
        .set(auth(f.users.ops.token))
        .send({});
      expect(second.status).toBe(409);
      expect(second.body.message).toMatch(/already been fully received/i);

      // 20, not 40.
      expect((await readBucket(h, f, f.locations.B)).physicalQty).toBe(20);
    });

    it('survives two simultaneous receipts of the same transfer', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      const transfer = await createTransfer(20);
      const id = transfer.body.id;
      await h.http().post(`/api/transfers/${id}/dispatch`).set(auth(f.users.ops.token)).expect(200);

      // The double-click case: both requests are in flight together.
      const [a, b] = await Promise.all([
        h.http().post(`/api/transfers/${id}/receive`).set(auth(f.users.ops.token)).send({}),
        h.http().post(`/api/transfers/${id}/receive`).set(auth(f.users.ops.token)).send({}),
      ]);

      expect([a.status, b.status].sort()).toEqual([200, 409]);
      expect((await readBucket(h, f, f.locations.B)).physicalQty).toBe(20);
    });

    it('cannot dispatch the same transfer twice', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      const transfer = await createTransfer(20);
      const id = transfer.body.id;

      await h.http().post(`/api/transfers/${id}/dispatch`).set(auth(f.users.ops.token)).expect(200);
      const second = await h
        .http()
        .post(`/api/transfers/${id}/dispatch`)
        .set(auth(f.users.ops.token));

      expect(second.status).toBe(409);
      expect((await readBucket(h, f, f.locations.A)).physicalQty).toBe(30);
    });

    it('supports partial receipt without allowing more than was dispatched', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      const transfer = await createTransfer(20);
      const id = transfer.body.id;
      await h.http().post(`/api/transfers/${id}/dispatch`).set(auth(f.users.ops.token)).expect(200);

      const partial = await h
        .http()
        .post(`/api/transfers/${id}/receive`)
        .set(auth(f.users.ops.token))
        .send({ quantity: 12 });
      expect(partial.status).toBe(200);
      expect(partial.body.status).toBe('DISPATCHED');
      expect(partial.body.receivedQty).toBe(12);
      expect((await readBucket(h, f, f.locations.B)).physicalQty).toBe(12);

      // Only 8 are still outstanding.
      const tooMany = await h
        .http()
        .post(`/api/transfers/${id}/receive`)
        .set(auth(f.users.ops.token))
        .send({ quantity: 20 });
      expect(tooMany.status).toBe(409);

      const rest = await h
        .http()
        .post(`/api/transfers/${id}/receive`)
        .set(auth(f.users.ops.token))
        .send({ quantity: 8 });
      expect(rest.status).toBe(200);
      expect(rest.body.status).toBe('RECEIVED');
      expect((await readBucket(h, f, f.locations.B)).physicalQty).toBe(20);
    });
  });
});
