# Mini Operations ERP

A small but production-shaped Operations ERP covering the full flow:

```
Inventory → Work Order → Stock Check → Internal Transfer / Shortage → Customer Reservation
```

The interesting part of this brief is not CRUD — it is **inventory correctness under
concurrency**. Two users must not be able to reserve the same units, a transfer must not
be receivable twice, and stock must never go negative. Everything below is organised
around making those three things impossible rather than merely unlikely.

---

## Tech stack

| Layer | Choice | Why |
| --- | --- | --- |
| Frontend | React 18 + Vite + TypeScript | Fast, typed, no framework overhead for 5 screens |
| Backend | NestJS 11 (Node 20+, TypeScript) | Modular DI, global guards, decorator-driven validation, Swagger generated from the code |
| Database | PostgreSQL 14+ | Row-level locking (`SELECT … FOR UPDATE`), CHECK constraints, generated columns |
| ORM | TypeORM 1.x | Real migrations, explicit transactions, first-class pessimistic locks |
| Auth | JWT (Passport) + bcrypt | Stateless, role claims verified server-side on every request |
| Tests | Jest + Supertest, against a real PostgreSQL | The rules under test live in the DB; mocking it would test nothing |
| API docs | Swagger / OpenAPI at `/api/docs` | Generated from the controllers, so it cannot drift |

---

## Quick start

**Prerequisites:** Node 20+, PostgreSQL 14+ (or Docker).

```bash
git clone <repository-url>
cd mini-ops-erp
```

### 1. Database

Either use the bundled Docker Postgres:

```bash
docker compose up -d          # postgres on localhost:5432, creates both databases
```

…or point at any PostgreSQL you already have:

```bash
createdb ops_erp
createdb ops_erp_test         # the test suite wipes this one
```

### 2. Backend

```bash
cd backend
cp .env.example .env          # then edit DATABASE_URL / JWT_SECRET if needed
npm install
npm run migration:run         # creates the schema, constraints and views
npm run seed                  # demo locations, items, users and opening stock
npm run start:dev
```

API on <http://localhost:3000/api> · Swagger on <http://localhost:3000/api/docs>

### 3. Frontend

```bash
cd frontend
cp .env.example .env
npm install
npm run dev
```

App on <http://localhost:5173>. The Vite dev server proxies `/api` to the backend, so the
browser stays on one origin and CORS never enters the picture in development.

### 4. Sign in

| Email | Role | Can do |
| --- | --- | --- |
| `admin@ops-erp.local` | ADMIN | Create work orders, everything else, reconciliation report |
| `ops@ops-erp.local` | OPERATIONS | Receive/adjust stock, raise, dispatch and receive transfers |
| `sales@ops-erp.local` | SALES | Raise customer orders, reserve, cancel and fulfil |

Password for all three: `Password@123`

---

## Environment variables

### `backend/.env`

| Variable | Required | Default | Purpose |
| --- | --- | --- | --- |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string |
| `TEST_DATABASE_URL` | for tests | — | Separate DB for the suite. **Wiped on every run** — must differ from `DATABASE_URL` |
| `JWT_SECRET` | ✅ | — | Token signing key. Refuses to boot in production if left at the placeholder |
| `JWT_EXPIRES_IN` | | `8h` | Token lifetime |
| `BCRYPT_ROUNDS` | | `10` | Password hashing cost |
| `PORT` | | `3000` | HTTP port |
| `CORS_ORIGINS` | | `http://localhost:5173` | Comma-separated allowed browser origins |
| `DATABASE_SSL` | | `false` | Set `true` for RDS / Neon / Supabase |
| `DATABASE_LOGGING` | | `false` | Log every SQL statement |
| `SEED_PASSWORD` | | `Password@123` | Password given to the seeded demo users |

### `frontend/.env`

| Variable | Default | Purpose |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `/api` | Where the browser sends API calls. Set to a full URL when the frontend is deployed separately |
| `VITE_API_PROXY_TARGET` | `http://localhost:3000` | Backend the dev proxy forwards to |
| `VITE_PORT` | `5173` | Dev server port |

Nothing in the codebase reads `process.env` outside `src/config/configuration.ts`, and no
host, port or credential is hard-coded anywhere. The same build runs against local
Postgres, Docker, RDS, Neon or Supabase with only environment changes — there is no
dependency on any particular hosting provider.

---

## Running the tests

```bash
cd backend
npm test
```

48 end-to-end tests run against a real PostgreSQL, rebuilt from the checked-in migrations
so the CHECK constraints under test are the ones that actually ship.

```
Test Suites: 4 passed, 4 total
Tests:       48 passed, 48 total
```

### The five mandatory tests

| # | Requirement | Where |
| --- | --- | --- |
| 1 | Cannot reserve more than available inventory | `test/01-reservation.e2e-spec.ts` |
| 2 | Cannot transfer more than available inventory | `test/02-transfer.e2e-spec.ts` |
| 3 | Destination stock increases only after transfer receipt | `test/02-transfer.e2e-spec.ts` |
| 4 | Same transfer cannot be received twice | `test/02-transfer.e2e-spec.ts` |
| 5 | Unauthorized user cannot perform restricted operation | `test/03-authorization.e2e-spec.ts` |

Beyond those, the suite also covers the genuinely concurrent cases — two reservations
fired simultaneously, five fired at once, two simultaneous receipts of the same transfer —
plus shortage calculation, negative-stock prevention, duplicate transactions, status
machines, and a full-day ledger reconciliation.

There is also a manual HTTP walkthrough at `scripts/smoke.sh` (needs the API running).

---

## How inventory correctness is guaranteed

### The problem

50 units on hand. Two Sales users each reserve 40 at the same instant. Naive code reads
50, both decide "50 ≥ 40, fine", and both write — selling 80 units that do not exist.
Read-then-write without a lock is the bug.

### The three layers

**1 · Row-level locks.** Every quantity change starts with `SELECT … FOR UPDATE` on the
exact `inventory` row (`StockService.lockBucketById`). PostgreSQL grants that lock to one
transaction at a time, so the second request *blocks* at that statement until the first
commits — and then reads the updated figure, not the stale one.

```
Without locking              With the lock
---------------              -------------
A reads 50                   A locks, reads 50, writes 40, commits
B reads 50                   B blocks until A commits
A writes 40                  B reads reserved=40, available=10
B writes 40                  B needs 40, finds 10 → 409, rolls back
⇒ 80 units sold              ⇒ exactly one order succeeds
```

**2 · One transaction per business operation.** Reserving an order, dispatching a
transfer, completing a work order — each is a single `dataSource.transaction(...)`.
Partial results are never committed: if line 3 of an order cannot be filled, lines 1 and 2
roll back with it.

**3 · Database constraints as the backstop.** Declared in the migration, so they hold even
against a stray `psql` session or a future code path that forgets the lock:

```sql
CHECK (physical_qty >= 0)
CHECK (reserved_qty >= 0)
CHECK (reserved_qty <= physical_qty)   -- makes overselling unstorable
UNIQUE (item_id, location_id, batch_id)
UNIQUE (idempotency_key)               -- makes double-apply impossible
```

`available_qty` is a **PostgreSQL STORED generated column** (`physical_qty - reserved_qty`),
recalculated by the database on every write, so it cannot drift from its inputs.

### Preventing duplicate operations

Every stock movement writes one immutable `inventory_transactions` row carrying a business
key such as `TRANSFER:<id>:RECEIVE:20`. That column is `UNIQUE`, so a double-clicked
button, a retried HTTP call or a replayed queue message all collide on the index and the
second attempt is rejected by PostgreSQL — not by a race-prone application check.

Receiving a transfer twice is blocked three independent ways: the transfer row is locked
and its status re-read inside the transaction; the status machine refuses
`RECEIVED → RECEIVED`; and the ledger key collides. Any one alone would be sufficient.

### Proving it stays correct

`GET /api/inventory/reconcile` (Admin) re-derives every balance from the ledger and
asserts three invariants:

- `physical_qty` = Σ `physical_delta`
- `reserved_qty` = Σ `reserved_delta`
- Σ active customer reservations = the ledger's net `CUSTOMER_ORDER` reserved movement

A non-empty `discrepancies` array means something mutated inventory without going through
`StockService`. The test suite asserts `balanced: true` after a full simulated day.

---

## Business rules implemented

**Inventory** — stock is held per (item, location, batch). Available = physical − reserved,
computed by the database. Negative stock, invalid quantities, duplicate transactions and
over-reservation are all rejected. Reserved units cannot be written off or transferred
away.

**Work orders** — Admin-only creation. Shortage is derived on every read
(`required − available at that location`), never stored, so it cannot go stale; the API
also returns which other locations could cover it.
`ASSIGNED → IN_PROGRESS` reserves the material and fails if short.
`IN_PROGRESS → COMPLETED` consumes it. Illegal jumps are rejected.

**Internal transfers** — `REQUESTED → DISPATCHED → RECEIVED`. Dispatch reduces the source;
the destination is credited **only** on receipt. In between, the quantity is in transit and
counts toward availability at neither end. Partial receipts are supported; over-receipt,
double-receipt and double-dispatch are all refused.

**Customer orders** — Sales-only. Reservation allocates FEFO (earliest expiry first) across
batches under a row lock, all lines or none. Cancelling releases the hold and physical
stock is untouched; fulfilling drops physical and reserved together.

**Auth** — JWT bearer tokens, bcrypt-hashed passwords never returned by any endpoint.
`JwtAuthGuard` and `RolesGuard` are registered globally, so authentication and
authorisation are **deny-by-default**: a new endpoint is protected the moment it is
written, and only an explicit `@Public()` opens it. The user is re-read from the database
on every request, so deactivating an account takes effect immediately rather than when the
token expires.

---

## Project layout

```
mini-ops-erp/
├── backend/
│   ├── src/
│   │   ├── common/          guards, decorators, exception filter, enums, shared DTOs
│   │   ├── config/          the only place that reads process.env
│   │   ├── database/        entities, migrations, seed, DataSource
│   │   ├── auth/            login, JWT strategy
│   │   ├── masters/         locations, categories, items, batches, users
│   │   ├── inventory/       StockService — the single place stock may change
│   │   ├── work-orders/     shortage calculation, lifecycle
│   │   ├── transfers/       dispatch / receive
│   │   └── orders/          reservation, cancellation, fulfilment
│   └── test/                48 e2e tests against a real PostgreSQL
├── frontend/src/
│   ├── api/                 typed fetch client, 401 handling
│   ├── context/             auth state
│   ├── hooks/               reference data
│   └── pages/               Login, Inventory, Work Orders, Transfers, Orders
├── docs/
│   ├── er-diagram.md        entity relationship diagram + table reference
│   ├── api.md               endpoint reference with curl examples
│   ├── live-changes.md      how each of the four possible live changes would be made
│   ├── demo-script.md       shot list for the walkthrough video
│   ├── openapi.json         generated OpenAPI 3 spec
│   └── postman_collection.json
├── scripts/smoke.sh         manual end-to-end HTTP walkthrough
└── docker-compose.yml
```

---

## API reference

Full interactive docs at <http://localhost:3000/api/docs> once running. See
[`docs/api.md`](docs/api.md) for a written reference with curl examples, and
[`docs/er-diagram.md`](docs/er-diagram.md) for the schema.

| Area | Endpoints |
| --- | --- |
| Auth | `POST /auth/login` · `GET /auth/me` |
| Master data | `GET/POST /locations` `/categories` `/items` `/batches` · `GET /users` |
| Inventory | `GET /inventory` · `POST /inventory/receipt` · `POST /inventory/adjustment` · `GET /inventory/:id/transactions` · `GET /inventory/reconcile` |
| Work orders | `POST /work-orders` · `GET /work-orders` · `GET /work-orders/:id` · `PATCH /work-orders/:id/status` |
| Transfers | `POST /transfers` · `GET /transfers` · `GET /transfers/:id` · `POST /transfers/:id/dispatch` · `POST /transfers/:id/receive` |
| Orders | `POST /orders` · `GET /orders` · `GET /orders/:id` · `POST /orders/:id/reserve` · `POST /orders/:id/cancel` · `POST /orders/:id/fulfil` |
| Health | `GET /health` |

---

## Design decisions worth defending

**Why a ledger instead of just balances?** Balances alone cannot answer "how did we get
here", cannot be audited, and give you nothing to reconcile against. The append-only
`inventory_transactions` table makes every balance reproducible and doubles as the
duplicate-protection mechanism via its unique business key.

**Why pessimistic locks rather than optimistic concurrency?** Under contention — which is
exactly the scenario in the brief — optimistic retries thrash. `SELECT … FOR UPDATE` on a
single narrow row is cheap, and serialises precisely the transactions that conflict while
leaving everything else fully parallel.

**Why batch as its own table?** It keeps batch attributes (expiry, later: supplier, cost) in
one place and makes FEFO allocation a plain `ORDER BY expiry_date`. A string column on
`inventory` would have duplicated expiry across every location holding that batch.

**Why is `available_qty` a generated column?** Storing it as an ordinary column invites
drift the first time some code path updates one input and forgets the other. Computing it
in the application means it cannot be filtered or indexed in SQL. A stored generated column
gives correctness and queryability at once.

**Why deny-by-default guards?** The failure mode of opt-in security is a forgotten
decorator silently exposing an endpoint. With global guards, the same mistake produces a
locked endpoint — which someone notices immediately.

**Why derive shortage instead of storing it?** A stored shortage is wrong the moment any
stock moves. Deriving it costs one indexed aggregate and is always right.
