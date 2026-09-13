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
# worker: crawler + health scheduler (proceso separado, WORK-01)
RUN npx tsc -p tsconfig.worker.json

# Migración: mismo contexto, imagen con herramientas de schema (DEP-02/DB-01)
FROM node:22-alpine AS migrator
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/src ./src
COPY --from=builder /app/drizzle.config.ts ./
# drizzle.config.ts lee DATABASE_URL del entorno (sin URLs hardcodeadas)
ENTRYPOINT ["npx", "drizzle-kit", "push", "--force"]


# Worker: mismo build del crawler con sus node_modules de runtime. El standalone
# de Next NO incluye las dependencias externas del worker (pg/drizzle/cheerio/
# fetch-socks) — el worker necesita imagen propia para ejecutarse.
FROM node:22-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=builder /app/.worker-build ./.worker-build
CMD ["node", ".worker-build/worker/crawler.js"]

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
RUN addgroup -S faro && adduser -S faro -G faro
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# worker compilado (node_modules del standalone cubre pg/drizzle/fetch-socks/
# undici/cheerio, trazados por las rutas API; las vars vienen por entorno)
COPY --from=builder /app/.worker-build ./.worker-build
USER faro
EXPOSE 3000
ENV PORT=3000
# Variables esperadas en runtime:
#   DATABASE_URL      postgres://user:pass@db:5432/app_db
#   CRAWL_MODE        live           (tor real) | sim (red simulada)
#   TOR_SOCKS_PROXY   socks5h://tor:9050
#   TOR_SEED_URLS     lista de semillas .onion separadas por comas (opcional)
#   ADMIN_TOKEN        token para /api/admin/run (recomendado en producción)
#   ADMIN_INITIAL_EMAIL / ADMIN_INITIAL_PASSWORD  (obligatorios en producción
#                      para el primer arranque; luego la auth vive en la DB)
#   WORKER_INTERVAL_SECONDS  ciclo del worker (sin ella = one-shot)
CMD ["node", "server.js"]
