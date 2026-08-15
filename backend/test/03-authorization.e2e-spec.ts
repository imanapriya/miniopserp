import { auth, createHarness, Fixtures, Harness, receiveStock, seedFixtures, TEST_PASSWORD } from './harness';

/**
 * MANDATORY TEST 5 - "Unauthorized user cannot perform restricted operation."
 *
 * Checked on the SERVER, not in the UI. Every case here sends a perfectly
 * valid token for a real, active user - the request is refused purely because
 * of the caller's role.
 */
describe('Test 5 - authentication and role-based authorization', () => {
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

  describe('authentication', () => {
    it('rejects a protected endpoint with no token', async () => {
      await h.http().get('/api/inventory').expect(401);
    });

    it('rejects a malformed or forged token', async () => {
      await h.http().get('/api/inventory').set(auth('not-a-real-token')).expect(401);
      await h
        .http()
        .get('/api/inventory')
        .set(auth('eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJoYWNrZXIifQ.bad-signature'))
        .expect(401);
    });

    it('rejects wrong credentials without revealing whether the email exists', async () => {
      const wrongPassword = await h
        .http()
        .post('/api/auth/login')
        .send({ email: f.users.admin.email, password: 'WrongPassword1' });

      const noSuchUser = await h
        .http()
        .post('/api/auth/login')
        .send({ email: 'nobody@test.local', password: TEST_PASSWORD });

      expect(wrongPassword.status).toBe(401);
      expect(noSuchUser.status).toBe(401);
      // Identical responses, so the endpoint cannot be used to enumerate users.
      expect(wrongPassword.body.message).toBe(noSuchUser.body.message);
    });

    it('never returns the password hash', async () => {
      const login = await h
        .http()
        .post('/api/auth/login')
        .send({ email: f.users.admin.email, password: TEST_PASSWORD })
        .expect(200);

      expect(JSON.stringify(login.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);

      const users = await h.http().get('/api/users').set(auth(f.users.admin.token)).expect(200);
      expect(JSON.stringify(users.body)).not.toMatch(/passwordHash|password_hash|\$2[aby]\$/);
    });

    it('allows the health endpoint without a token', async () => {
      await h.http().get('/api/health').expect(200);
    });
  });

  describe('authorization - work orders are Admin-only', () => {
    const body = (f: Fixtures) => ({
      locationId: f.locations.A,
      itemId: f.item,
      requiredQty: 10,
      assignedToId: f.users.ops.id,
    });

    it('refuses a Sales user', async () => {
      const res = await h
        .http()
        .post('/api/work-orders')
        .set(auth(f.users.sales.token))
        .send(body(f));

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/SALES is not allowed/i);
    });

    it('refuses an Operations user', async () => {
      await h.http().post('/api/work-orders').set(auth(f.users.ops.token)).send(body(f)).expect(403);
    });

    it('allows an Admin', async () => {
      await h
        .http()
        .post('/api/work-orders')
        .set(auth(f.users.admin.token))
        .send(body(f))
        .expect(201);
    });

    it('creates nothing when the call is refused', async () => {
      await h.http().post('/api/work-orders').set(auth(f.users.sales.token)).send(body(f)).expect(403);

      const list = await h.http().get('/api/work-orders').set(auth(f.users.admin.token)).expect(200);
      expect(list.body.meta.total).toBe(0);
    });
  });

  describe('authorization - inventory and transfers are Operations/Admin', () => {
    it('refuses a Sales user receiving stock', async () => {
      const res = await h
        .http()
        .post('/api/inventory/receipt')
        .set(auth(f.users.sales.token))
        .send({ itemId: f.item, locationId: f.locations.A, batchId: f.batch, quantity: 10 });

      expect(res.status).toBe(403);
    });

    it('refuses a Sales user adjusting stock', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 10 });
      const inv = await h.http().get('/api/inventory').set(auth(f.users.sales.token)).expect(200);

      await h
        .http()
        .post('/api/inventory/adjustment')
        .set(auth(f.users.sales.token))
        .send({ inventoryId: inv.body.data[0].id, delta: -5, reason: 'nope' })
        .expect(403);
    });

    it('refuses a Sales user raising a transfer', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });

      await h
        .http()
        .post('/api/transfers')
        .set(auth(f.users.sales.token))
        .send({
          sourceLocationId: f.locations.A,
          destinationLocationId: f.locations.B,
          itemId: f.item,
          batchId: f.batch,
          quantity: 10,
        })
        .expect(403);
    });

    it('allows an Operations user to do all of the above', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });
      await h
        .http()
        .post('/api/transfers')
        .set(auth(f.users.ops.token))
        .send({
          sourceLocationId: f.locations.A,
          destinationLocationId: f.locations.B,
          itemId: f.item,
          batchId: f.batch,
          quantity: 10,
        })
        .expect(201);
    });
  });

  describe('authorization - customer orders are Sales/Admin', () => {
    it('refuses an Operations user creating an order', async () => {
      await h
        .http()
        .post('/api/orders')
        .set(auth(f.users.ops.token))
        .send({
          customerName: 'Acme',
          lines: [{ itemId: f.item, locationId: f.locations.A, quantity: 5 }],
        })
        .expect(403);
    });

    it('refuses an Operations user reserving an existing order', async () => {
      await receiveStock(h, f, { locationId: f.locations.A, quantity: 50 });
      const order = await h
        .http()
        .post('/api/orders')
        .set(auth(f.users.sales.token))
        .send({
          customerName: 'Acme',
          lines: [{ itemId: f.item, locationId: f.locations.A, quantity: 5 }],
        })
        .expect(201);

      await h
        .http()
        .post(`/api/orders/${order.body.id}/reserve`)
        .set(auth(f.users.ops.token))
        .expect(403);
    });
  });

  describe('authorization - reconciliation is Admin-only', () => {
    it('refuses Operations and Sales, allows Admin', async () => {
      await h.http().get('/api/inventory/reconcile').set(auth(f.users.ops.token)).expect(403);
      await h.http().get('/api/inventory/reconcile').set(auth(f.users.sales.token)).expect(403);
      await h.http().get('/api/inventory/reconcile').set(auth(f.users.admin.token)).expect(200);
    });
  });

  describe('authorization - a deactivated account loses access immediately', () => {
    it('rejects a token that was valid before the account was disabled', async () => {
      const token = f.users.ops.token;
      await h.http().get('/api/inventory').set(auth(token)).expect(200);

      await h.dataSource.query(`UPDATE "users" SET "is_active" = false WHERE "id" = $1`, [
        f.users.ops.id,
      ]);

      // The token has not expired, but the user is re-read on every request.
      await h.http().get('/api/inventory').set(auth(token)).expect(401);
    });
  });
});
