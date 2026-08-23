# Deploying Mini Operations ERP

This guide covers deploying the full stack (PostgreSQL + NestJS API + React frontend) as Docker containers on any Linux server.

---

## Prerequisites

- A Linux server (Ubuntu 22.04 / Debian 12 recommended) with **Docker** and **Docker Compose** installed.
- A domain name pointed at the server (optional but recommended).
- Port **80** (and **443** if you add TLS) open in your firewall.

---

## Step 1 — Clone the repository

```bash
git clone <your-repo-url> mini-ops-erp
cd mini-ops-erp
```

---

## Step 2 — Generate a JWT secret

```bash
node scripts/generate-secret.js
```

Copy the output — you'll need it in the next step.

---

## Step 3 — Create your production environment file

```bash
cp .env.production.example .env.production
nano .env.production   # or your editor of choice
```

Fill in **every value**:

| Variable | What to set |
|----------|-------------|
| `POSTGRES_USER` | Any username, e.g. `ops_erp_user` |
| `POSTGRES_PASSWORD` | A strong password (no `@` or special chars that break URLs) |
| `POSTGRES_DB` | e.g. `ops_erp` |
| `JWT_SECRET` | The 128-char hex string from Step 2 |
| `JWT_EXPIRES_IN` | `8h` is fine |
| `CORS_ORIGINS` | `http://your-server-ip` or `https://erp.your-company.com` |
| `BCRYPT_ROUNDS` | `12` |

> **Never commit `.env.production` to git.** It is already in `.gitignore`.

---

## Step 4 — Start the stack

```bash
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

This will:
1. Start PostgreSQL and wait until it is healthy.
2. Run the **migrate** container (runs all DB migrations once, then exits).
3. Start the **backend** NestJS API.
4. Build and start the **frontend** nginx container (React app + `/api` proxy).

---

## Step 5 — Verify everything is running

```bash
# All four services should show as running (migrate will show Exited 0)
docker compose -f docker-compose.prod.yml ps

# Health check the API
curl http://your-server-ip/api/health

# Check logs if anything looks wrong
docker compose -f docker-compose.prod.yml logs backend
docker compose -f docker-compose.prod.yml logs migrate
```

---

## Step 6 — Seed demo data (first deploy only)

```bash
docker compose -f docker-compose.prod.yml exec backend \
  node -e "require('./dist/database/seed').seed().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1); })"
```

This creates the three demo users and sample inventory data. **Do not run this again** — it will duplicate master data.

> Demo credentials: `admin@ops-erp.local` / `ops@ops-erp.local` / `sales@ops-erp.local` with password `Password@123`. **Change or delete these users after your first login.**

---

## Step 7 — (Recommended) Add HTTPS with Certbot

```bash
# Install certbot on the host
sudo apt install certbot

# Stop the frontend so port 80 is free
docker compose -f docker-compose.prod.yml stop frontend

# Get a certificate
sudo certbot certonly --standalone -d erp.your-company.com

# Start again
docker compose -f docker-compose.prod.yml start frontend
```

For a production-grade TLS setup, replace the `frontend` service's nginx with a full reverse-proxy container (Caddy or Traefik) that handles TLS termination automatically. This is beyond the scope of this guide but well-documented for both tools.

---

## Updating the application

```bash
git pull
docker compose -f docker-compose.prod.yml --env-file .env.production up -d --build
```

Docker Compose will rebuild only the containers whose source has changed. Migrations run automatically via the `migrate` service on every deploy.

---

## Useful commands

```bash
# View live logs
docker compose -f docker-compose.prod.yml logs -f backend

# Open a psql shell
docker compose -f docker-compose.prod.yml exec postgres psql -U $POSTGRES_USER -d $POSTGRES_DB

# Stop everything
docker compose -f docker-compose.prod.yml down

# Stop everything AND delete the database volume (destructive!)
docker compose -f docker-compose.prod.yml down -v
```

---

## Environment variable reference

### Production env file (`.env.production`)

| Variable | Required | Purpose |
|----------|----------|---------|
| `POSTGRES_USER` | ✅ | DB username for the postgres service |
| `POSTGRES_PASSWORD` | ✅ | DB password |
| `POSTGRES_DB` | ✅ | Database name |
| `JWT_SECRET` | ✅ | Token signing key — must be random and secret |
| `JWT_EXPIRES_IN` | | Token lifetime (default `8h`) |
| `CORS_ORIGINS` | ✅ | Comma-separated allowed browser origins |
| `BCRYPT_ROUNDS` | | Hashing cost (default `12`) |

### Backend-only variables (set directly in `docker-compose.prod.yml`)

| Variable | Value | Notes |
|----------|-------|-------|
| `DATABASE_URL` | Constructed from POSTGRES_* vars | Points to the `postgres` service |
| `DATABASE_SSL` | `false` | SSL not needed inside Docker network |
| `NODE_ENV` | `production` | Enables JWT_SECRET validation guard |
