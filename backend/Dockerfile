# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Copy manifests first so layer is cached unless deps change
COPY package.json package-lock.json ./

RUN npm ci

# Copy source and compile
COPY . .
RUN npm run build

# ── Stage 2: production ────────────────────────────────────────────────────────
FROM node:20-alpine AS production

WORKDIR /app

ENV NODE_ENV=production

# Install only production dependencies in the final image
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Copy compiled output from builder
COPY --from=builder /app/dist ./dist

# Migrations and seed live in src/; the CLI needs them at runtime via ts paths.
# We ship the compiled JS in dist/ instead — migration:run works fine against dist.
COPY --from=builder /app/src/database/migrations ./src/database/migrations

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "dist/main.js"]
