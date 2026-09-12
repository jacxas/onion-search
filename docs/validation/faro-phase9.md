# FARO — Validación FASE 9 (pre-corte)

Rama: `faro/build` · Commit: `d794db1` · Tag: `FARO-PHASE9-GREEN`

## Gates

| Gate | Resultado | Evidencia |
|---|---|---|
| Typecheck (`tsc --noEmit`) | ✅ | 0 errores |
| Lint (`eslint .`) | ✅ | 0 problemas |
| Build (`next build`) | ✅ | 4.0s, 13 rutas |
| Migración PostgreSQL (drizzle push) | ✅ | 10 tablas creadas |
| Seed → cola | ✅ | 6 seeds encoladas, re-crawl reset OK |
| Crawl E2E (SimTransport) | ✅ | 45/49 ok, ~1.6s, cola: 45 done + 2 failed + FIFO |
| Persistencia | ✅ | 36 sites / 45 pages en PostgreSQL |
| FTS | ✅ | `search?q=market` → hits con score; ranking×uptime |
| Health sweep | ✅ | 36/36, EWMA, uptime_ratio, timeout adaptativo |
| Dedupe / mirrors | ✅ | grupo espejo real (hub0+espejo); sin singletons |
| Login E2E | ✅ | 303→`/ops`, cookie `HttpOnly; SameSite=lax`, sesión en DB |
| Session DB | ✅ | tabla sessions, expiración 7d |
| scrypt | ✅ | hash/verify + rechazo de hashes malformados |
| Rate limit | ✅ | 6 intentos/10min → bloqueo; login OK limpia |
| CSRF | ✅ | Origin maligno → 403; mismo origen → 200 |
| Admin authorization | ✅ | sin auth 401; token malo 401; token OK 200; sesión OK 200 |
| Páginas protegidas | ✅ | `/ops` sin sesión → 307 `/login`; con sesión 200 |
| API pública | ✅ | search, sites, health, stats, crawl, report |
| Worker separado | ✅ | `tsconfig.worker.json` → `.worker-build/` |
| **TorTransport live** | 🟡 | **BLOCKED BY ENVIRONMENT** — sandbox solo TLS 443 |
| TorTransport estructural | ✅ | 10/10 (mock SOCKS5h) |

## TorTransport — detalle

**TOR E2E BLOCKED BY ENVIRONMENT**: el sandbox de validación solo permite salida
TLS 443; las autoridades de directorio y relays de Tor usan puertos mixtos, por lo
que el bootstrap nunca completó (0% en intento controlado de 75s). No es un fallo
de implementación.

Validación estructural con mock SOCKS5h (`tests/tor-transport.structural.mjs`, 10/10):
handshake SOCKS5 + HTTP 200 · DNS remoto (`socks5h`): hostname `.onion` viaja al
proxy como ATYP=domain (cero fuga local) · puerto destino · timeout con AbortSignal
(1502ms/1500ms) · error SOCKS propagado · retry+backoff (2×10s+4s) · truncado
maxBytes 512KB exacto · integración crawler (healthSweep vía transporte mock).

## Bugs reales encontrados y corregidos durante la validación

1. `sql.param` para `unnest[]` (Drizzle expandía arrays → arrays anidados en PostgreSQL)
2. Casts explícitos en `CASE` (error 42P18: tipo indecidible) para transporte null
3. Seeds bloqueadas como done: reset de estado para re-crawl
4. Mirror grouping antes de completar el grafo → espejo del hub0 tras armarlo
5. Grupos espejo singleton → `mirror_group NULL` cuando no hay gemelo
6. Worker pasaba transporte erróneo al health sweep
7. Arrays PostgreSQL/Drizzle en `inArray` con `sql.param`

La validación live de Tor queda como **deployment gate** (`CRAWL_MODE=live`).
