# FARO — notas para agentes

## Qué corre acá

Un único proceso **FastAPI** (`backend/main.py`) que sirve:

- el portal público renderizado con **Jinja2** (`backend/templates/`),
- la **API JSON** (`/api/search`, `/api/stats`, `/api/sites`, `/health`),
- el **centro de mando** en `/admin` (token + cookie).

Base de datos vía SQLAlchemy (`db/`); **SQLite por defecto** (`./faro.db`, sin
`DATABASE_URL`) y **PostgreSQL** en Docker. Meilisearch es opcional: si no
responde, la búsqueda cae a un motor local (ver `backend/search.py`).

El pipeline de rastreo y salud **sí está integrado**: se dispara desde
`/admin/actions`, corre en un hilo (`backend/jobs.py`) y el progreso vive en la
tabla `crawl_runs`. En el preview opera en modo `sim` contra
`crawler/transport.py::SimTransport` (red determinista de 33 nodos, sin Tor).
Con `CRAWL_MODE=live` el mismo pipeline sale por el proxy SOCKS5 de Tor.

## Arranque

```bash
bash scripts/start.sh            # :3000, health en /health
```

`.base44/environment.json` apunta a ese script. `docker compose up -d --build`
levanta app + Postgres + Meili + Tor.

## Pipeline (resumen)

```
backend/jobs.py        enqueue(kind) → hilo + CrawlRun (single-flight)
crawler/pipeline.py    semillas → fetch → parse → dedupe/espejos → DB/Meili
crawler/transport.py   TorTransport | SimTransport (misma interfaz fetch())
health_checker/checker.py  barrido con hilos → uptime + SiteCheck
scripts/worker.py      ciclo programado (salud 30 min / rastreo 3 h)
```

- **Una fila por nodo**: `node_url()` colapsa cualquier ruta en `http://host`.
  Nunca guardes URLs con path en `onion_sites`.
- Las escrituras usan `get_db()` (commit al salir del contexto).
  `with SessionLocal() as db` **no** commitea: no lo uses para escribir.
- Si agregás un tipo de tarea, registralo en `jobs.JOBS` y en la UI de
  `/admin/actions`.
- En live hay preflight de Tor (`_tor_ready`): sin proxy la corrida termina con
  error explicado, no con cientos de timeouts.
- Tests del pipeline: `tests/test_pipeline.py` (transporte sim, dedupe,
  blocklist, historial de salud).

## Credenciales locales (no son secretos)

- Admin: `/admin/login`, token por defecto `admin-secret-token` (`ADMIN_TOKEN`).
- Postgres del compose: `faro:faro@db:5432/faro`.
- Meili del compose: `http://meili:7700`, master key `dev-master-key`.

## Convenciones del código

- Plantillas: `base.html` (shell público) + `admin_base.html` (shell del panel).
- Todo el CSS vive en `backend/static/css/faro.css`. **No** agregar CDNs,
  fuentes externas ni analytics: el portal se sirve por Tor.
- Usar `templates.TemplateResponse(request, "x.html", ctx(request, ...))`
  (firma moderna de Starlette). El `ctx()` agrega demo_mode, nav y versiones.
- Filtros Jinja disponibles: `timeago`.
- Las sesiones de DB usan `expire_on_commit=False`; los objetos se pueden
  renderizar después de cerrar la sesión.
- `db/database.py::_ensure_columns` agrega columnas nuevas a tablas viejas en el
  boot (no hay framework de migraciones): si agregás una columna a un modelo
  existente, registrala ahí también.
- Rutas nuevas del panel: `nav='admin'`, `admin_nav='<sección>'` y
  `pending_reports` para el badge del menú.

## Despliegue

- `fly.toml` (raíz): dos grupos de proceso, `app` y `worker`, misma imagen.
- `deploy/fly/Dockerfile.tor` + `entrypoint-tor.sh` + `torrc` + `fly.tor.toml`:
  modo live con Tor dentro del contenedor y servicio oculto v3.
- `db/database.py` normaliza `postgres://` → `postgresql+psycopg2://` (Fly lo
  entrega así) y **aborta** si hay `FLY_APP_NAME` sin `DATABASE_URL`.
- Si tocás un `COPY` de un Dockerfile, corré los tests: `test_config.py`
  valida que el origen exista en el contexto y no esté en `.dockerignore`.

## Pruebas

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
```

Cubren normalización de términos, validez de direcciones v3, páginas públicas,
API, reportes y login/flujo del panel.

## Gotchas

- `backend/auth/security.py` no se usa (depende de `jose`/`passlib`); no borrar
  sin revisar `backend/auth/dependencies.py`.
- `crawler/spider.py` y `health_checker/checker.py` usan imports relativos al
  paquete; se ejecutan con `python -m crawler.spider`.
- La semilla demo es idempotente: no duplica nodos. `FARO_SEED=0` la desactiva.
