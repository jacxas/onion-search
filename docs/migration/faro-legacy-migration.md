# Migración Legacy → FARO (Python → TypeScript)

Rama: `faro/build` · Tag de seguridad: `FARO-PHASE9-GREEN` · Estado: **GREEN**

## Contexto

El repositorio original contenía un stack Python (FastAPI + SQLAlchemy + Meilisearch
+ crawler/health checker en Python) y un `frontend/` cuyos archivos `.ts` eran
placeholders de 2 líneas ("se subirá en el próximo commit") — código nunca subido.
La arquitectura FARO lo reemplaza: Next.js (app principal) + PostgreSQL como
fuente de verdad + FTS nativo + worker de crawler separado + SimTransport
determinista para desarrollo y TorTransport (SOCKS5h) para producción.

## Matriz de migración

| Legacy | Líneas | Funcionalidad | Equivalente FARO | Prueba de equivalencia | Estado | Eliminar |
|---|---|---|---|---|---|---|
| `crawler/spider.py` | 324 | OnionSpider: crawl BFS, cola, dedupe | `src/crawler/{queue,fetch,pipeline,dedupe}.ts` | E2E: 45/49 ok, cola 47, espejos agrupados | MIGRADO | SÍ |
| `crawler/tor_session.py` | 69 | Sesión Tor SOCKS | `src/lib/tor/transport.ts` | `tests/tor-transport.structural.mjs` 10/10 (live bloqueado por entorno) | MIGRADO | SÍ |
| `health_checker/checker.py` | 215 | Checks periódicos, uptime, avg response | `src/crawler/health.ts` | Sweep 36/36, EWMA, timeout adaptativo, historial | MIGRADO | SÍ |
| `db/{models,database}.py` | 134 | SQLAlchemy, modelo OnionSite | `src/db/{schema,index}.ts` (drizzle/PostgreSQL) | 10 tablas, migración push, CRUD E2E | MIGRADO | SÍ |
| `indexer/meili_client.py` | 93 | Indexado Meilisearch | `src/lib/search.ts` (FTS tsvector + ranking×uptime) | Búsquedas E2E con relevancia | MIGRADO* | SÍ |
| `backend/main.py` + `templates/*.html` | 399+1141 | FastAPI + admin Jinja | `src/app/` (API + `/ops` + `/login` + `/sitio/[domain]`) | 8/8 seguridad, login 303→/ops | MIGRADO | SÍ |
| `backend/auth/*` + `models/admin_user.py` | 231 | Hash/verify, sesiones, rutas admin | `src/lib/auth.ts` (scrypt, sesiones DB, CSRF, rate-limit) | scrypt, rate-limit, CSRF, autorización OK | MIGRADO** | SÍ |
| `frontend/**` | ~30 reales | Nada (placeholders 2 líneas + configs scaffold) | estructura reflejada en `src/` | typecheck/lint/build sin tocarlos | OBSOLETO | SÍ |
| `requirements.txt` | 15 | Deps Python legacy | — | sin consumidores | OBSOLETO | SÍ |
| `docker/Dockerfile` | ~30 | Imagen Python+Tor legacy | `Dockerfile` raíz (Node+FARO) | compose usa `build: .` raíz | OBSOLETO | SÍ |

\* Cambio de stack aprobado por el dueño: Meilisearch → FTS PostgreSQL (fuente de verdad única).
\** Cambio de diseño: JWT → sesiones server-side + CSRF.

## Funcionalidades DEFERRED / NOT MIGRATED BY DESIGN

Las siguientes funcionalidades del legacy **no se migraron por decisión explícita**,
no por omisión. Si se requieren en el futuro deben implementarse sobre FARO:

1. **TOTP / 2FA** (`backend/auth/security.py`: `generate_totp_secret`, `verify_totp`,
   `create_temp_session_token`) — **DEFERRED**. FARO auth = scrypt + sesiones +
   CSRF + rate-limit; sin segundo factor.
2. **Emails de usuario** (`backend/email/templates.py`: `password_reset_email`,
   `welcome_email`, `totp_setup_email`) — **NOT MIGRATED BY DESIGN**. FARO no envía
   emails de usuario; solo alertas de salud (`src/lib/mail.ts`).

## Archivos legacy conservados (no eliminados)

- `seed_list.txt`, `blocklist.txt` — datos de seeds/blocklist reutilizables para
  el modo live (sin consumidor runtime actual).
- `README.md` — documentación histórica (pendiente de actualización).
- `config/torrc`, `torrc.example` — configuración Tor para el deployment gate live.
- Zips históricos y todo el historial Git (el corte es reversible vía
  `git checkout FARO-PHASE9-GREEN`).

## Deuda técnica registrada (fuera de alcance de este corte)

- Hardening de producción: SSRF, límites de respuesta, contenido no confiable,
  exposición del proxy Tor, secretos, cookies HTTPS (Secure flag), etc.
- Validación live de Tor (deployment gate): `CRAWL_MODE=live` + torrc real.
- Política de re-crawl profundo solo vía seeds.
- README desactualizado respecto de la arquitectura FARO.
