# Handling the Live Verification Changes

The brief warns that shortlisted candidates receive one small unannounced change. This
file records where each of the four named examples would land, as evidence that the
architecture was chosen with them in mind rather than reverse-engineered afterwards.

The common thread: **all four are localised**, because every stock movement already funnels
through one method — `StockService.applyMovement` — and every invariant is already declared
in one place.

---

## Change 1 — Add DAMAGED QUANTITY; damaged stock automatically reduces available

**Scope: one migration, one entity, one enum value, one service method.**

1. Migration — add the column and fold it into the generated column:

```sql
ALTER TABLE "inventory" ADD COLUMN "damaged_qty" integer NOT NULL DEFAULT 0;
ALTER TABLE "inventory" ADD CONSTRAINT "CHK_inventory_damaged_non_negative"
  CHECK ("damaged_qty" >= 0);

-- available is a generated column, so redefine it
ALTER TABLE "inventory" DROP COLUMN "available_qty";
ALTER TABLE "inventory" ADD COLUMN "available_qty" integer
  GENERATED ALWAYS AS ("physical_qty" - "reserved_qty" - "damaged_qty") STORED;

-- the invariant has to grow too, or damaged stock could be sold
ALTER TABLE "inventory" DROP CONSTRAINT "CHK_inventory_reserved_lte_physical";
ALTER TABLE "inventory" ADD CONSTRAINT "CHK_inventory_reserved_lte_sound"
  CHECK ("reserved_qty" + "damaged_qty" <= "physical_qty");
```

2. `inventory.entity.ts` — add `damagedQty`, update the `asExpression` for `availableQty`.
3. `enums.ts` — add `DAMAGE` to `InventoryTxnType`, plus a `damagedDelta` column on the
   ledger so the reconciliation stays complete.
4. `StockService.applyMovement` — accept `damagedDelta` and include it in the `UPDATE`.
5. New endpoint `POST /inventory/damage` calling `applyMovement` with
   `{ type: DAMAGE, damagedDelta: +q }`.

**Nothing in reservation, transfer or work order code changes.** They all read
`availableQty`, which the database now computes differently. That is the payoff of not
computing availability in application code.

---

## Change 2 — Allow a transfer to be partially received

**Already implemented.** `stock_transfers.received_qty` tracks the running total and
`POST /transfers/:id/receive` accepts an optional `quantity`:

```json
{ "quantity": 12 }
```

The transfer stays `DISPATCHED` until `received_qty === quantity`, then flips to
`RECEIVED`. Over-receipt is blocked by both the service check and
`CHECK (received_qty >= 0 AND received_qty <= quantity)`.

Each partial receipt gets its own ledger key — `TRANSFER:<id>:RECEIVE:<runningTotal>` — so
distinct receipts are allowed while a *repeat* of the same one still collides on the unique
index. Covered by the test *"supports partial receipt without allowing more than was
dispatched"*.

A likely follow-up — recording a shortfall when the remainder never arrives — would be one
more endpoint writing an `ADJUSTMENT` for the difference and closing the transfer.

---

## Change 3 — Cancel an order and correctly release its reserved inventory

**Already implemented**, at `POST /orders/:id/cancel` →
`OrdersService.releaseActiveReservations`.

The subtlety worth stating out loud: cancelling must **not** touch `physical_qty`. The
goods never left the warehouse; they were only spoken for. So the release writes
`reservedDelta: -q, physicalDelta: 0`, which raises `available_qty` back without inventing
stock. Fulfilment is the other case — there both quantities drop together, which leaves
availability unchanged because those units were already unavailable.

Each reservation's release is keyed `RESERVATION:<id>:RELEASED`, so a double cancel cannot
release the same hold twice. Covered by the test *"releases reserved stock back to
available when an order is cancelled"*, and by the reconciliation assertion afterwards.

---

## Change 4 — Restrict users to only their assigned location

**Scope: one guard-like helper, applied at the service boundary.**

The hook already exists: `users.location_id` is populated and travels on the JWT payload as
part of `AuthUser`.

1. Add a small helper in `common/`:

```ts
export function assertSameLocation(user: AuthUser, locationId: string) {
  if (user.role === Role.ADMIN) return;              // Admin is global
  if (user.locationId !== locationId) {
    throw new ForbiddenException(
      `You may only operate on your assigned location (${user.locationCode}).`,
    );
  }
}
```

2. Call it where a location is named:
   - `InventoryService.receive` / `adjust` — against the bucket's `locationId`
   - `WorkOrdersService.updateStatus` — against the work order's `locationId`
   - `TransfersService.dispatch` — against `sourceLocationId`
   - `TransfersService.receive` — against `destinationLocationId`
   - `OrdersService.reserveLine` — against the line's `locationId`

3. Scope the list endpoints so users see their own location by default: add
   `.andWhere('location_id = :loc')` when the caller is not an Admin.

Doing it at the service boundary rather than in a route guard is deliberate — the relevant
location is usually a property of the record being acted on, which the guard cannot see
without loading it anyway.

---

## Other changes the shape of the code anticipates

| Change | Where it lands |
| --- | --- |
| A new field on any entity | Entity + migration; DTOs are explicit, so nothing leaks by accident |
| A new stock movement type | One enum value + one `applyMovement` call — the ledger and reconciliation pick it up free |
| Reserve across multiple locations | `reserveLine` already loops over buckets; widen the query to drop the location filter |
| Minimum stock levels / reorder alerts | New column on `inventory` + a filter on the existing list query |
| Serial numbers instead of batches | `batches` becomes `serials` with `quantity = 1`; the allocation loop is unchanged |
| Audit "who changed what" | Already there — every movement records `created_by_id` |
| Soft-delete master data | `is_active` already exists on locations, items and users |

---

## If asked to debug a transaction issue

The places to look, in order:

1. **`GET /api/inventory/reconcile`** — is the ledger still consistent with the balances?
   A discrepancy points at a write that bypassed `StockService`.
2. **`GET /api/inventory/:id/transactions`** — the movement history for the affected bucket
   shows exactly what happened, in order, and who did it.
3. **`StockService.lockBucketById`** — is the row actually locked before the availability
   check? A read outside the lock is the classic source of a race.
4. **The transaction boundary** — is the whole operation inside one
   `dataSource.transaction(...)`? A check in one transaction and a write in another is not
   atomic no matter how the locking looks.
5. **`pg_locks` / `pg_stat_activity`** — for a suspected deadlock, confirm lock ordering.
   All multi-bucket operations here acquire locks in the same deterministic FEFO order for
   exactly this reason.
