# ── Stage 1: build ────────────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# VITE_API_BASE_URL must be set at build time (Vite bakes it in).
# Pass it via --build-arg when building this image:
#   docker build --build-arg VITE_API_BASE_URL=https://api.example.com/api .
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}

RUN npm run build

# ── Stage 2: serve ─────────────────────────────────────────────────────────────
FROM nginx:1.27-alpine AS production

# Remove the default nginx config
RUN rm /etc/nginx/conf.d/default.conf

# Copy our SPA-aware nginx config
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copy the compiled React app
COPY --from=builder /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:80/ || exit 1

CMD ["nginx", "-g", "daemon off;"]
