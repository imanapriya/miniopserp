#!/usr/bin/env bash
# Manual end-to-end walkthrough of the required flow. Not the test suite -
# this is the "does it actually work over HTTP" sanity check.
set -uo pipefail
API=http://localhost:3000/api
j() { python3 -c "import sys,json;d=json.load(sys.stdin);print(eval('d'+sys.argv[1]))" "$1"; }

login() { curl -s -X POST $API/auth/login -H 'Content-Type: application/json' \
  -d "{\"email\":\"$1\",\"password\":\"Password@123\"}" | j "['accessToken']"; }

ADMIN=$(login admin@ops-erp.local)
OPS=$(login ops@ops-erp.local)
SALES=$(login sales@ops-erp.local)
echo "✓ logged in as all three roles"

AUTH_A=(-H "Authorization: Bearer $ADMIN")
AUTH_O=(-H "Authorization: Bearer $OPS")
AUTH_S=(-H "Authorization: Bearer $SALES")
JSON=(-H 'Content-Type: application/json')

LOCS=$(curl -s "${AUTH_A[@]}" $API/locations)
WHA=$(echo "$LOCS" | j "[0]['id']"); WHB=$(echo "$LOCS" | j "[1]['id']")
ITEMS=$(curl -s "${AUTH_A[@]}" $API/items)
ROD=$(echo "$ITEMS" | python3 -c "import sys,json;print([i['id'] for i in json.load(sys.stdin) if i['sku']=='STL-ROD-12'][0])")
OPSUSER=$(curl -s "${AUTH_A[@]}" $API/users | python3 -c "import sys,json;print([u['id'] for u in json.load(sys.stdin) if u['email']=='ops@ops-erp.local'][0])")
BATCH=$(curl -s "${AUTH_A[@]}" "$API/batches?itemId=$ROD" | j "[0]['id']")

echo ""
echo "--- 1. Work order at WH-A for 50 (only 30 on hand) ---"
WO=$(curl -s -X POST $API/work-orders "${AUTH_A[@]}" "${JSON[@]}" \
  -d "{\"locationId\":\"$WHA\",\"itemId\":\"$ROD\",\"requiredQty\":50,\"assignedToId\":\"$OPSUSER\"}")
echo "$WO" | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"  {d['code']}: required={d['requiredQty']} available={d['availableQty']} shortage={d['shortageQty']} status={d['materialStatus']}\");print('  suggested source:', d['suggestedSources'])"
WOID=$(echo "$WO" | j "['id']")

echo ""
echo "--- 2. Sales user tries to create a work order (must be 403) ---"
curl -s -o /dev/null -w "  HTTP %{http_code}\n" -X POST $API/work-orders "${AUTH_S[@]}" "${JSON[@]}" \
  -d "{\"locationId\":\"$WHA\",\"itemId\":\"$ROD\",\"requiredQty\":5,\"assignedToId\":\"$OPSUSER\"}"

echo ""
echo "--- 3. Transfer 20 from WH-B to WH-A ---"
TR=$(curl -s -X POST $API/transfers "${AUTH_O[@]}" "${JSON[@]}" \
  -d "{\"sourceLocationId\":\"$WHB\",\"destinationLocationId\":\"$WHA\",\"itemId\":\"$ROD\",\"batchId\":\"$BATCH\",\"quantity\":20,\"workOrderId\":\"$WOID\"}")
TRID=$(echo "$TR" | j "['id']")
echo "  created $(echo "$TR" | j "['code']") status=$(echo "$TR" | j "['status']")"

stock() { curl -s "${AUTH_A[@]}" "$API/inventory?itemId=$ROD&locationId=$1" \
  | python3 -c "import sys,json;d=json.load(sys.stdin)['data'];print('    '+', '.join(f\"{r['batchCode']}: phys={r['physicalQty']} avail={r['availableQty']}\" for r in d) or '    (none)')"; }

echo "  WH-A before dispatch:"; stock "$WHA"
curl -s -o /dev/null -X POST $API/transfers/$TRID/dispatch "${AUTH_O[@]}"
echo "  after DISPATCH — source reduced, destination must be UNCHANGED:"
echo "  WH-B:"; stock "$WHB"; echo "  WH-A:"; stock "$WHA"

curl -s -o /dev/null -X POST $API/transfers/$TRID/receive "${AUTH_O[@]}" "${JSON[@]}" -d '{}'
echo "  after RECEIVE — destination increased:"
echo "  WH-A:"; stock "$WHA"

echo ""
echo "--- 4. Receive the same transfer a second time (must be 409) ---"
curl -s -X POST $API/transfers/$TRID/receive "${AUTH_O[@]}" "${JSON[@]}" -d '{}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"  HTTP {d['statusCode']} — {d['message']}\")"

echo ""
echo "--- 5. Work order shortage should now be cleared, then start + complete ---"
curl -s "${AUTH_A[@]}" $API/work-orders/$WOID | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"  available={d['availableQty']} shortage={d['shortageQty']} canStart={d['canStart']}\")"
curl -s -X PATCH $API/work-orders/$WOID/status "${AUTH_O[@]}" "${JSON[@]}" -d '{"status":"IN_PROGRESS"}' \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"  -> {d['status']}\")"
echo "  WH-A after reserving material:"; stock "$WHA"

echo ""
echo "--- 6. CONCURRENCY: two orders each reserving 40 of the 60 left at WH-B ---"
mk() { curl -s -X POST $API/orders "${AUTH_S[@]}" "${JSON[@]}" \
  -d "{\"customerName\":\"$1\",\"lines\":[{\"itemId\":\"$ROD\",\"locationId\":\"$WHB\",\"quantity\":40}]}" | j "['id']"; }
O1=$(mk "Acme"); O2=$(mk "Globex")
echo "  firing both reservations in parallel..."
curl -s -o /tmp/r1.json -w "  order 1 -> HTTP %{http_code}\n" -X POST $API/orders/$O1/reserve "${AUTH_S[@]}" &
curl -s -o /tmp/r2.json -w "  order 2 -> HTTP %{http_code}\n" -X POST $API/orders/$O2/reserve "${AUTH_S[@]}" &
wait
for f in /tmp/r1.json /tmp/r2.json; do
  python3 -c "
import json;d=json.load(open('$f'))
print('   ', d.get('code', 'REJECTED'), '->', d.get('status') or d.get('message'))"
done
echo "  WH-B final:"; stock "$WHB"

echo ""
echo "--- 7. Ledger reconciliation ---"
curl -s "${AUTH_A[@]}" $API/inventory/reconcile \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print(f\"  buckets={d['bucketsChecked']} balanced={d['balanced']} discrepancies={len(d['discrepancies'])}\")"
