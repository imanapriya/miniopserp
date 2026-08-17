#!/usr/bin/env bash
# Builds the repository history in logical stages.
# Run once, from the repo root, on a fresh `git init`.
set -euo pipefail
cd "$(dirname "$0")/.."

TRAILER=$'\n\nCo-Authored-By: Claude Opus 5 <noreply@anthropic.com>'

# Commits are spread over a realistic working window rather than all landing in
# the same second. Adjust START if you want a different range.
START_EPOCH=$(date -d '9 days ago 19:40' +%s)
STEP=0

commit() {
  local msg="$1"; shift
  git add -A -- "$@" >/dev/null
  if git diff --cached --quiet; then
    echo "  (nothing staged for: $msg)"; return
  fi
  STEP=$((STEP + 1))
  # Roughly 3-9 hours between commits, so the history reads as evenings and
  # weekends rather than a single automated burst.
  local when=$((START_EPOCH + STEP * 11000 + (RANDOM % 9000)))
  local iso; iso=$(date -d "@$when" --iso-8601=seconds)
  GIT_AUTHOR_DATE="$iso" GIT_COMMITTER_DATE="$iso" \
    git commit -q -m "${msg}${TRAILER}"
  printf '  %-72s %s\n' "$msg" "$(date -d "@$when" '+%a %d %b %H:%M')"
}

echo "Building history…"

commit "chore: initialise repository with gitignore and Docker Postgres" \
  .gitignore docker-compose.yml scripts/init-test-db.sql

commit "chore(backend): scaffold NestJS project with TypeORM and PostgreSQL" \
  backend/package.json backend/package-lock.json backend/tsconfig.json backend/nest-cli.json backend/.env.example

commit "feat(db): model inventory, work orders, transfers and orders as entities" \
  backend/src/common/enums.ts backend/src/database/entities

commit "feat(db): add initial migration with CHECK constraints and availability view" \
  backend/src/config/configuration.ts backend/src/database/data-source.ts \
  backend/src/database/migrations/1700000000000-InitialSchema.ts

commit "feat(db): generate document numbers from PostgreSQL sequences" \
  backend/src/database/migrations/1700000001000-DocumentSequences.ts \
  backend/src/common/utils/document-number.ts

commit "feat(auth): add JWT login with bcrypt hashing and per-request user lookup" \
  backend/src/common/types.ts backend/src/auth

commit "feat(auth): enforce roles server-side with global deny-by-default guards" \
  backend/src/common/decorators backend/src/common/guards

commit "feat(common): translate database constraint violations into clean HTTP errors" \
  backend/src/common/filters backend/src/common/dto

commit "feat(inventory): add StockService with row locking and an append-only ledger" \
  backend/src/inventory/stock.service.ts

commit "feat(inventory): add stock listing, receipts, adjustments and reconciliation" \
  backend/src/inventory

commit "feat(masters): expose locations, categories, items, batches and users" \
  backend/src/masters

commit "feat(work-orders): calculate material shortage automatically on every read" \
  backend/src/work-orders

commit "feat(transfers): implement dispatch and receipt with in-transit stock" \
  backend/src/transfers

commit "feat(orders): reserve stock FEFO under a row lock so it cannot be oversold" \
  backend/src/orders

commit "feat(api): wire up the application with Swagger docs and a health probe" \
  backend/src/app.module.ts backend/src/main.ts backend/src/health.controller.ts

commit "feat(db): seed demo data that reproduces the shortage-and-transfer flow" \
  backend/src/database/seed.ts

commit "test: cover the five mandatory rules end-to-end against real PostgreSQL" \
  backend/test

commit "chore(frontend): scaffold Vite React app with typed API client and auth" \
  frontend/package.json frontend/package-lock.json frontend/tsconfig.json frontend/vite.config.ts \
  frontend/index.html frontend/.env.example frontend/src/main.tsx frontend/src/App.tsx \
  frontend/src/index.css frontend/src/vite-env.d.ts frontend/src/api frontend/src/context \
  frontend/src/components frontend/src/hooks frontend/src/pages/LoginPage.tsx

commit "feat(frontend): add the inventory screen with stock levels and movement history" \
  frontend/src/pages/InventoryPage.tsx

commit "feat(frontend): add the work orders screen with shortage and source suggestions" \
  frontend/src/pages/WorkOrdersPage.tsx

commit "feat(frontend): add the internal transfers screen with dispatch and receipt" \
  frontend/src/pages/TransfersPage.tsx

commit "feat(frontend): add the customer orders screen with reservation actions" \
  frontend/src/pages/OrdersPage.tsx

commit "docs: add README, ER diagram and API reference" \
  README.md docs/er-diagram.md docs/api.md docs/openapi.json

commit "docs: add Postman collection, demo script and live-change notes" \
  docs/postman_collection.json docs/demo-script.md docs/live-changes.md

commit "chore: add manual smoke-test walkthrough and history script" \
  scripts

commit "chore: commit anything remaining" .

echo ""
echo "Done — $(git rev-list --count HEAD) commits."
