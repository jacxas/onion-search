# ── FARO · motor de búsqueda .onion ──────────────────────────────────────
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm ci

FROM node:22-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
# DATABASE_URL solo se necesita en runtime, no en build
RUN npm run build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S faro && adduser -S faro -G faro
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
USER faro
EXPOSE 3000
ENV PORT=3000
# Variables esperadas en runtime:
#   DATABASE_URL      postgres://user:pass@db:5432/app_db
#   CRAWL_MODE        live           (tor real) | sim (red simulada)
#   TOR_SOCKS_PROXY   socks5h://tor:9050
#   TOR_SEED_URLS     lista de semillas .onion separadas por comas (opcional)
#   ADMIN_TOKEN       token para /api/admin/run (recomendado en producción)
CMD ["node", "server.js"]
