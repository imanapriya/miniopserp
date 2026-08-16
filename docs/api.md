# API Reference

Base URL: `http://localhost:3000/api`
Interactive Swagger UI: <http://localhost:3000/api/docs> (click **Authorize**, paste the
`accessToken` from login)
Machine-readable spec: [`openapi.json`](./openapi.json) · Postman:
[`postman_collection.json`](./postman_collection.json)

All endpoints except `POST /auth/login` and `GET /health` require
`Authorization: Bearer <token>`.

---

## Conventions

**Errors** are uniform:

```json
{
  "statusCode": 409,
  "error": "ConstraintViolation",
  "message": "Cannot reserve 40 units for order SO-000002: only 20 available at this location. Short by 20. Nothing has been reserved.",
  "path": "/api/orders/9f3b.../reserve",
  "timestamp": "2026-08-22T09:14:03.412Z"
}
```

| Status | Meaning here |
| --- | --- |
| `400` | Validation failure — bad quantity, unknown field, malformed UUID |
| `401` | Missing, invalid or expired token, or the account was deactivated |
| `403` | Authenticated, but this role may not perform this operation |
| `404` | Referenced record does not exist |
| `409` | A business rule refused it — insufficient stock, illegal transition, duplicate operation |

**Validation** is strict: unknown properties are rejected rather than ignored, so a
typo'd field fails loudly instead of silently doing nothing.

**Pagination** — list endpoints accept `page` (default 1) and `limit` (default 25, max 200):

```json
{ "data": [...], "meta": { "page": 1, "limit": 25, "total": 61, "totalPages": 3 } }
```

---

## Role matrix

| Operation | ADMIN | OPERATIONS | SALES |
| --- | :---: | :---: | :---: |
| View inventory, work orders, transfers, orders | ✅ | ✅ | ✅ |
| Receive / adjust stock | ✅ | ✅ | ❌ |
| Create master data | ✅ | batches only | ❌ |
| **Create work orders** | ✅ | ❌ | ❌ |
| Advance work order status | ✅ | ✅ | ❌ |
| Raise / dispatch / receive transfers | ✅ | ✅ | ❌ |
| **Create customer orders, reserve, cancel, fulfil** | ✅ | ❌ | ✅ |
| Reconciliation report | ✅ | ❌ | ❌ |

Enforced by `RolesGuard` on the server, independently of what the UI renders.

---

## Auth

### `POST /auth/login`

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"admin@ops-erp.local","password":"Password@123"}'
```

```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expiresIn": "8h",
  "user": { "id": "…", "email": "admin@ops-erp.local", "name": "Asha Admin",
            "role": "ADMIN", "locationId": "…", "locationCode": "WH-A" }
}
```

Wrong password and unknown email return an identical `401`, so the endpoint cannot be used
to enumerate valid accounts.

### `GET /auth/me`

Returns the caller's profile, re-read from the database.

---

## Master data

| Method | Path | Role | Notes |
| --- | --- | --- | --- |
| `GET` | `/locations` | any | Active locations |
| `POST` | `/locations` | ADMIN | `{ code, name }` |
| `GET` | `/categories` | any | |
| `POST` | `/categories` | ADMIN | `{ code, name }` |
| `GET` | `/items` | any | With category name |
| `POST` | `/items` | ADMIN | `{ sku, name, categoryId, uom? }` |
| `GET` | `/batches?itemId=` | any | FEFO-ordered |
| `POST` | `/batches` | ADMIN, OPERATIONS | `{ itemId, code, expiryDate? }` |
| `GET` | `/users` | any | For work order assignment. Never includes password data |

---

## Inventory

### `GET /inventory`

Query: `locationId`, `itemId`, `categoryId`, `q` (SKU/name/batch), `outOfStock=true`,
`page`, `limit`.

```bash
curl "http://localhost:3000/api/inventory?locationId=$WHA" -H "Authorization: Bearer $TOKEN"
```

```json
{
  "data": [{
    "id": "…", "sku": "STL-ROD-12", "itemName": "Steel Rod 12mm",
    "categoryName": "Raw Material", "locationCode": "WH-A",
    "batchCode": "B-2026-01", "expiryDate": "2028-01-31",
    "physicalQty": 50, "reservedQty": 50, "availableQty": 0
  }],
  "meta": { "page": 1, "limit": 25, "total": 1, "totalPages": 1 }
}
```

`availableQty` comes straight from the database's generated column.

### `POST /inventory/receipt` — ADMIN, OPERATIONS

```bash
curl -X POST http://localhost:3000/api/inventory/receipt \
  -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d '{"itemId":"…","locationId":"…","batchCode":"B-2026-05","quantity":100,"reference":"GRN-4471"}'
```

Supply either `batchId` (existing) or `batchCode` (created if new, with optional
`expiryDate`). Supplying `reference` makes the receipt idempotent — sending it twice
returns `409`, so a double-click cannot double the stock.

### `POST /inventory/adjustment` — ADMIN, OPERATIONS

```json
{ "inventoryId": "…", "delta": -5, "reason": "Cycle count correction" }
```

Negative adjustments cannot cut into reserved stock, and never below zero.

### `GET /inventory/:id/transactions`

The append-only movement history for one bucket — type, signed deltas, reference, who and
when.

### `GET /inventory/reconcile` — ADMIN

```json
{ "bucketsChecked": 6, "balanced": true, "discrepancies": [] }
```

Re-derives every balance from the ledger and from active reservations. `balanced: false`
means something wrote to inventory without going through `StockService`.

---

## Work orders

### `POST /work-orders` — **ADMIN only**

```bash
curl -X POST http://localhost:3000/api/work-orders \
  -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' \
  -d '{"locationId":"…","itemId":"…","requiredQty":50,"assignedToId":"…"}'
```

```json
{
  "code": "WO-000001", "status": "ASSIGNED",
  "requiredQty": 50, "availableQty": 30,
  "shortageQty": 20, "materialStatus": "SHORTAGE", "canStart": false,
  "suggestedSources": [
    { "locationCode": "WH-B", "locationName": "Warehouse B - Chennai", "availableQty": 80 }
  ]
}
```

Shortage is calculated automatically on every read, never stored.

### `GET /work-orders` · `GET /work-orders/:id`

Filters: `status`, `locationId`, `assignedToId`. The detail endpoint adds
`suggestedSources` and linked transfers.

`materialStatus` is `SHORTAGE` / `SUFFICIENT` while `ASSIGNED`, `HELD` once
`IN_PROGRESS` (the material is reserved against this work order), and `CONSUMED` when
complete.

### `PATCH /work-orders/:id/status` — ADMIN, OPERATIONS

```json
{ "status": "IN_PROGRESS" }
```

`ASSIGNED → IN_PROGRESS` reserves the required material FEFO and returns `409` if short.
`IN_PROGRESS → COMPLETED` consumes it. Anything else is rejected.

---

## Internal transfers

### `POST /transfers` — ADMIN, OPERATIONS

```json
{ "sourceLocationId": "…", "destinationLocationId": "…",
  "itemId": "…", "batchId": "…", "quantity": 20, "workOrderId": "…" }
```

Created as `REQUESTED`; **no stock moves yet**. Availability is checked here as a courtesy
and again, authoritatively, at dispatch.

### `POST /transfers/:id/dispatch` — ADMIN, OPERATIONS

Source `physical_qty` decreases. **The destination is not touched.** Re-checks availability
under a row lock; `409` if the stock has since been reserved or moved.

### `POST /transfers/:id/receive` — ADMIN, OPERATIONS

```json
{}              // receive everything outstanding
{ "quantity": 12 }   // partial receipt — the transfer stays DISPATCHED
```

Destination `physical_qty` increases. Receiving an already-received transfer returns `409`.
Two simultaneous receipts result in exactly one success.

```
REQUESTED    source ── unchanged ──  destination unchanged
DISPATCHED   source −qty            destination unchanged   ← in transit
RECEIVED     source unchanged       destination +qty
```

---

## Customer orders

### `POST /orders` — SALES, ADMIN

```json
{
  "customerName": "Acme Industries",
  "reserveImmediately": true,
  "lines": [{ "itemId": "…", "locationId": "…", "quantity": 40 }]
}
```

With `reserveImmediately`, the order and its reservations are created in one transaction —
if stock runs out, the order itself rolls back too.

### `POST /orders/:id/reserve` — SALES, ADMIN

Allocates FEFO across batches under a row lock. All lines succeed or none do.

```json
{ "statusCode": 409, "error": "ConflictException",
  "message": "Cannot reserve 40 units for order SO-000002: only 20 available at this location. Short by 20. Nothing has been reserved." }
```

Two users reserving simultaneously: exactly one gets `200`, the other `409`. This is
enforced by `SELECT … FOR UPDATE` plus the `reserved_qty <= physical_qty` CHECK constraint.

### `POST /orders/:id/cancel` — SALES, ADMIN

Releases every active reservation. Physical stock is untouched — the goods never left, they
were only spoken for — so `availableQty` rises back.

### `POST /orders/:id/fulfil` — SALES, ADMIN

Ships the order: physical and reserved both drop. `availableQty` is unchanged, because
those units were already unavailable.

---

## Health

### `GET /health` — public

```json
{ "status": "ok", "database": "up", "uptimeSeconds": 104, "timestamp": "…" }
```

---

## Full flow with curl

```bash
API=http://localhost:3000/api
login() { curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Password@123\"}" | jq -r .accessToken; }

ADMIN=$(login admin@ops-erp.local)
OPS=$(login ops@ops-erp.local)
SALES=$(login sales@ops-erp.local)

# IDs
WHA=$(curl -s $API/locations -H "Authorization: Bearer $ADMIN" | jq -r '.[0].id')
WHB=$(curl -s $API/locations -H "Authorization: Bearer $ADMIN" | jq -r '.[1].id')
ROD=$(curl -s $API/items -H "Authorization: Bearer $ADMIN" | jq -r '.[] | select(.sku=="STL-ROD-12") | .id')
BATCH=$(curl -s "$API/batches?itemId=$ROD" -H "Authorization: Bearer $ADMIN" | jq -r '.[0].id')
USER=$(curl -s $API/users -H "Authorization: Bearer $ADMIN" | jq -r '.[] | select(.role=="OPERATIONS") | .id' | head -1)

# 1. Work order at WH-A for 50 (only 30 there) -> shortage 20
WO=$(curl -s -X POST $API/work-orders -H "Authorization: Bearer $ADMIN" \
  -H 'Content-Type: application/json' \
  -d "{\"locationId\":\"$WHA\",\"itemId\":\"$ROD\",\"requiredQty\":50,\"assignedToId\":\"$USER\"}")
echo "$WO" | jq '{code, requiredQty, availableQty, shortageQty, suggestedSources}'

# 2. Cover it with a transfer from WH-B
TR=$(curl -s -X POST $API/transfers -H "Authorization: Bearer $OPS" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceLocationId\":\"$WHB\",\"destinationLocationId\":\"$WHA\",\"itemId\":\"$ROD\",\"batchId\":\"$BATCH\",\"quantity\":20}")
TRID=$(echo "$TR" | jq -r .id)

curl -s -X POST $API/transfers/$TRID/dispatch -H "Authorization: Bearer $OPS" | jq '{code,status,inTransitQty}'
# destination still unchanged at this point — check /inventory to see it
curl -s -X POST $API/transfers/$TRID/receive  -H "Authorization: Bearer $OPS" \
  -H 'Content-Type: application/json' -d '{}' | jq '{code,status,receivedQty}'

# 3. Receiving twice -> 409
curl -s -X POST $API/transfers/$TRID/receive -H "Authorization: Bearer $OPS" \
  -H 'Content-Type: application/json' -d '{}' | jq '{statusCode,message}'

# 4. Sales user tries to create a work order -> 403
curl -s -o /dev/null -w '%{http_code}\n' -X POST $API/work-orders \
  -H "Authorization: Bearer $SALES" -H 'Content-Type: application/json' \
  -d "{\"locationId\":\"$WHA\",\"itemId\":\"$ROD\",\"requiredQty\":5,\"assignedToId\":\"$USER\"}"

# 5. Two simultaneous reservations -> one 200, one 409
mk() { curl -s -X POST $API/orders -H "Authorization: Bearer $SALES" \
  -H 'Content-Type: application/json' \
  -d "{\"customerName\":\"$1\",\"lines\":[{\"itemId\":\"$ROD\",\"locationId\":\"$WHB\",\"quantity\":40}]}" | jq -r .id; }
O1=$(mk Acme); O2=$(mk Globex)
curl -s -o /dev/null -w 'order 1 -> %{http_code}\n' -X POST $API/orders/$O1/reserve -H "Authorization: Bearer $SALES" &
curl -s -o /dev/null -w 'order 2 -> %{http_code}\n' -X POST $API/orders/$O2/reserve -H "Authorization: Bearer $SALES" &
wait

# 6. Ledger still balances
curl -s $API/inventory/reconcile -H "Authorization: Bearer $ADMIN" | jq
```

`scripts/smoke.sh` runs this whole sequence and prints the results.
