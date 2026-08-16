# Demo Video Script — 6 minutes

Target: 5–7 minutes, covering
`Login → Inventory → Work Order → Transfer → Order Reservation`.

## Before you hit record

```bash
docker compose up -d          # or make sure your Postgres is running
cd backend  && npm run db:reset && npm run start:dev
cd frontend && npm run dev
```

Have open: browser at `http://localhost:5173`, a terminal in `backend/`, and a second
browser tab on `http://localhost:3000/api/docs`. Zoom the browser to ~110% so the numbers
are readable on a compressed video. Close unrelated tabs.

The seed is built for this demo: **Steel Rod 12mm has 30 units at WH-A and 80 at WH-B**, so
a work order for 50 at WH-A is short by exactly 20.

---

## 0:00 – 0:30 · What this is

> "This is a Mini Operations ERP — React and TypeScript on the front, NestJS and PostgreSQL
> behind it. It covers inventory, work orders, internal transfers and customer
> reservations. The part I want to focus on is inventory correctness: making it impossible
> to oversell stock or double-receive a transfer, and enforcing that in the database rather
> than just in application code."

Screen: the login page.

---

## 0:30 – 1:15 · Login and roles

- Click the **Admin** demo chip, sign in.
- Point at the top-right role chip: `ADMIN · WH-A`.

> "Three roles — Admin, Operations, Sales. Every endpoint is guarded on the server; what
> the UI hides is only a convenience."

- Sign out, sign in as **Sales**, go to **Work Orders**.
- Point at the notice where the create form was.

> "A Sales user doesn't get the create form. But that's cosmetic — here's the real check."

**Terminal:**

```bash
curl -s -o /dev/null -w '%{http_code}\n' -X POST http://localhost:3000/api/work-orders \
  -H "Authorization: Bearer $SALES_TOKEN" -H 'Content-Type: application/json' \
  -d '{"locationId":"…","itemId":"…","requiredQty":5,"assignedToId":"…"}'
# 403
```

> "A perfectly valid token, bypassing the UI entirely — still 403. That's mandatory test 5."

---

## 1:15 – 2:00 · Inventory

Sign back in as **Admin** (or Operations). Go to **Inventory**.

- Point at the columns: Physical, Reserved, **Available**.

> "Stock is tracked per item, location and batch. Available is physical minus reserved —
> and it's a generated column in PostgreSQL, so the database recalculates it on every write.
> It can't drift out of sync."

- Note **Steel Rod 12mm: 30 at WH-A, 80 at WH-B** — the setup for what follows.
- Click **History** on any row.

> "Every change writes an immutable ledger row. This is the audit trail, and it's also how
> duplicate operations get blocked — I'll show that in a minute."

---

## 2:00 – 3:00 · Work order and automatic shortage

As **Admin**, go to **Work Orders**. Create:

- Location **WH-A**, Item **STL-ROD-12**, Quantity **50**, assign to **Omar Operations**.

> "Fifty units needed at WH-A, but WH-A only has thirty."

Point at the confirmation and the row:

> "The system worked out the shortage — twenty — on its own. It isn't stored anywhere; it's
> recalculated on every read, so it can never be stale."

Click **Where from?**:

> "And it tells me WH-B has eighty and can cover it. Notice Start is disabled while it's
> short."

---

## 3:00 – 4:15 · Internal transfer — the in-transit rule

Sign in as **Operations**. Go to **Internal Transfers**. Create:

- From **WH-B** → to **WH-A**, **STL-ROD-12**, batch **B-2026-01**, quantity **20**.

> "Raised as REQUESTED. Nothing has moved yet."

Click **Dispatch**, then switch to **Inventory**. ← *the important beat*

> "This is the bit worth watching. WH-B has gone down by twenty. WH-A has **not** gone up.
> The stock is in transit — it belongs to neither location, so nobody can sell it from
> either end. That's mandatory test 3."

Back to **Transfers**, click **Receive**, then **Inventory** again:

> "Now WH-A has fifty. Nothing was created or destroyed — the total is still the same."

Click **Receive** on the same transfer once more:

> "And receiving it a second time is refused. Three separate mechanisms stop it: the row is
> locked and its status re-read inside the transaction, the state machine rejects the
> transition, and the ledger has a unique key on the movement. Mandatory test 4."

Back to **Work Orders**:

> "The shortage has cleared and Start is enabled."

Click **Start**, then **Inventory**:

> "Starting reserved the material — physical is still fifty, but available is now zero.
> It's spoken for."

---

## 4:15 – 5:30 · Reservation and the concurrency case

Sign in as **Sales**. Go to **Customer Orders**. Create an order for **STL-ROD-12 at WH-B,
quantity 25**, reserve immediately.

> "Reserved. Those units are now unavailable to anyone else."

Now the headline. **Terminal:**

```bash
# Two orders, each for 40 units, when only 55 remain.
# Fired at the same instant.
curl -s -o /dev/null -w 'order 1 -> %{http_code}\n' -X POST $API/orders/$O1/reserve -H "Authorization: Bearer $SALES" &
curl -s -o /dev/null -w 'order 2 -> %{http_code}\n' -X POST $API/orders/$O2/reserve -H "Authorization: Bearer $SALES" &
wait
# order 1 -> 200
# order 2 -> 409
```

> "Two users, simultaneously, both asking for forty when only fifty-five exist. One
> succeeds, one gets a 409. Not both.
>
> The reason is a `SELECT FOR UPDATE` row lock on the exact inventory row. The second
> request blocks until the first commits, so it reads the *updated* number — not the stale
> one it would have read a millisecond earlier. And underneath that, there's a CHECK
> constraint, `reserved_qty <= physical_qty`, so even a code path that forgot to lock
> couldn't store an oversold row. That's mandatory test 1."

Show the UI rejecting an over-reservation too, so the error surfaces to the user.

Then **Cancel** the order:

> "Cancelling releases the hold. Physical stock never changed — the goods never left — so
> available goes straight back up."

---

## 5:30 – 6:15 · Tests and integrity

**Terminal:**

```bash
cd backend && npm test
```

> "Forty-eight end-to-end tests against a real PostgreSQL — no mocks, because the rules
> being tested live in the database. All five mandatory tests are in here, plus the truly
> concurrent cases: five reservations fired at once, two simultaneous receipts of the same
> transfer."

Let the green summary land on screen.

Then, as Admin, hit reconcile:

```bash
curl -s $API/inventory/reconcile -H "Authorization: Bearer $ADMIN" | jq
# { "bucketsChecked": 6, "balanced": true, "discrepancies": [] }
```

> "And this re-derives every balance from the ledger and checks it against what's stored.
> After everything we just did, it still balances."

---

## 6:15 – 6:40 · Close

Show Swagger at `/api/docs` briefly.

> "API docs are generated from the controllers so they can't drift. The schema is in
> checked-in migrations — no auto-sync — so the constraints are identical everywhere. And
> nothing is hard-coded to a host or provider; it's all environment configuration.
>
> Thanks for watching."

---

## Recording notes

- **Do not skip the in-transit beat at 3:30** and the parallel curl at 4:45 — those two
  moments are the whole assignment.
- Run `npm run db:reset` before recording so the numbers match this script.
- Pre-export `$API`, `$ADMIN`, `$SALES`, `$O1`, `$O2` in the terminal so no time is lost
  copying UUIDs on camera.
- Terminal font ≥ 16pt.
- If a take goes wrong, `npm run db:reset` restores the exact starting state.
