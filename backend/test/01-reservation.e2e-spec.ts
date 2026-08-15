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
 * MANDATORY TEST 1 - "Cannot reserve more than available inventory."
 *
 * Covered at three levels of nastiness:
 *   1. the obvious single-request case,
 *   2. the accumulating case (small reservations that add up past the limit),
 *   3. the real one - two users reserving simultaneously.
 */
describe('Test 1 - stock reservation limits', () => {
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

  const createOrder = async (quantity: number, customerName = 'Acme') => {
    const res = await h
      .http()
      .post('/api/orders')
      .set(auth(f.users.sales.token))
      .send({
        customerName,
        lines: [{ itemId: f.item, locationId: f.locations.A, quantity }],
      });
    expect(res.status).toBe(201);
    return res.body.id as string;
  };

  it('rejects a reservation larger than the available quantity', async () => {
    await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

    const orderId = await createOrder(60);
    const res = await h.http().post(`/api/orders/${orderId}/reserve`).set(auth(f.users.sales.token));

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/only 50 available/i);

    // Nothing may be reserved: the whole allocation rolls back together.
    const bucket = await readBucket(h, f, f.locations.A);
    expect(bucket).toMatchObject({ physicalQty: 50, reservedQty: 0, availableQty: 50 });
  });

  it('allows a reservation up to exactly the available quantity', async () => {
    await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

    const orderId = await createOrder(50);
    const res = await h.http().post(`/api/orders/${orderId}/reserve`).set(auth(f.users.sales.token));

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('RESERVED');

    const bucket = await readBucket(h, f, f.locations.A);
    expect(bucket).toMatchObject({ physicalQty: 50, reservedQty: 50, availableQty: 0 });
  });

  it('counts existing reservations, so a second order cannot take the same units', async () => {
    await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

    const first = await createOrder(30, 'Acme');
    await h.http().post(`/api/orders/${first}/reserve`).set(auth(f.users.sales.token)).expect(200);

    // 20 left. Asking for 25 must fail even though physical stock is still 50.
    const second = await createOrder(25, 'Globex');
    const res = await h.http().post(`/api/orders/${second}/reserve`).set(auth(f.users.sales.token));

    expect(res.status).toBe(409);

    const bucket = await readBucket(h, f, f.locations.A);
    expect(bucket).toMatchObject({ physicalQty: 50, reservedQty: 30, availableQty: 20 });
  });

  /**
   * The case the brief calls out explicitly: "Two users must not be able to
   * reserve more stock than actually exists ... Both requests must not
   * succeed. Solve this correctly at backend/database level."
   */
  it('lets only one of two simultaneous reservations succeed', async () => {
    await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

    const [orderA, orderB] = await Promise.all([
      createOrder(40, 'Acme'),
      createOrder(40, 'Globex'),
    ]);

    // Fired together, with no await between them, so both are in flight
    // inside the server at the same time.
    const [resA, resB] = await Promise.all([
      h.http().post(`/api/orders/${orderA}/reserve`).set(auth(f.users.sales.token)),
      h.http().post(`/api/orders/${orderB}/reserve`).set(auth(f.users.sales.token)),
    ]);

    const statuses = [resA.status, resB.status].sort();
    expect(statuses).toEqual([200, 409]);

    // The decisive assertion: total held never exceeds what physically exists.
    const bucket = await readBucket(h, f, f.locations.A);
    expect(bucket.reservedQty).toBe(40);
    expect(bucket.physicalQty).toBe(50);
    expect(bucket.availableQty).toBe(10);
    expect(bucket.reservedQty).toBeLessThanOrEqual(bucket.physicalQty);
  });

  it('holds the line under a burst of five simultaneous reservations', async () => {
    await receiveStock(h, f, { locationId: f.locations.A, quantity: 100 });

    const orderIds = await Promise.all([30, 30, 30, 30, 30].map((q, i) => createOrder(q, `C${i}`)));

    const results = await Promise.all(
      orderIds.map((id) => h.http().post(`/api/orders/${id}/reserve`).set(auth(f.users.sales.token))),
    );

    // 100 units, 30 per order -> at most three can win.
    const succeeded = results.filter((r) => r.status === 200).length;
    expect(succeeded).toBe(3);

    const bucket = await readBucket(h, f, f.locations.A);
    expect(bucket.reservedQty).toBe(90);
    expect(bucket.availableQty).toBe(10);
  });

  it('releases reserved stock back to available when an order is cancelled', async () => {
    await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

    const orderId = await createOrder(40);
    await h.http().post(`/api/orders/${orderId}/reserve`).set(auth(f.users.sales.token)).expect(200);
    expect((await readBucket(h, f, f.locations.A)).availableQty).toBe(10);

    const res = await h.http().post(`/api/orders/${orderId}/cancel`).set(auth(f.users.sales.token));
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('CANCELLED');

    // Physical stock never moved; the hold simply went away.
    const bucket = await readBucket(h, f, f.locations.A);
    expect(bucket).toMatchObject({ physicalQty: 50, reservedQty: 0, availableQty: 50 });
  });
});
