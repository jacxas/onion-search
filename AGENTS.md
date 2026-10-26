# FARO — notas para agentes

## Qué corre acá

Un único proceso **FastAPI** (`backend/main.py`) que sirve:

- el portal público renderizado con **Jinja2** (`backend/templates/`),
- la **API JSON** (`/api/search`, `/api/stats`, `/api/sites`, `/health`),
- el **centro de mando** en `/admin` (token + cookie).

Base de datos vía SQLAlchemy (`db/`); **SQLite por defecto** (`./faro.db`, sin
`DATABASE_URL`) y **PostgreSQL** en Docker. Meilisearch es opcional: si no
responde, la búsqueda cae a un motor local (ver `backend/search.py`).

El rastreo real (`crawler/`, `health_checker/`) necesita Tor y semillas; **no**
se ejecuta en el preview. En su lugar corre la semilla demo (`db/seed.py`).

## Arranque

```bash
bash scripts/start.sh            # :3000, health en /health
```

`.base44/environment.json` apunta a ese script. `docker compose up -d --build`
levanta app + Postgres + Meili + Tor.

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
