# FARO — portal de búsqueda para servicios .onion

**FARO** es un portal web onion: un buscador independiente de servicios
`.onion` que, además de indexar, **verifica la salud de cada nodo** y la usa
como parte del ranking. Si un servicio está caído, lo dice antes de que
pierdas cinco minutos esperando un tiempo agotado.

Un solo proceso FastAPI sirve la interfaz (Jinja2, sin JS de terceros) y la
API JSON. Base de datos PostgreSQL en producción o SQLite en desarrollo,
Meilisearch opcional para relevancia avanzada.

```
            ┌──────────────────────────────┐
  consulta  │  FARO  (FastAPI + Jinja2)    │  índice
 ─────────► │  /  /search  /sitio/{host}   │ ──────► PostgreSQL / SQLite
            │  /directorio  /estado  /api  │ ──────► Meilisearch (opcional)
            └──────────────┬───────────────┘
                           │  rastreo (CRAWL_MODE=live)
                    proxy SOCKS5 ──► red Tor ──► servicios .onion
```

## Lo que hay en el portal

| Ruta | Qué es |
|---|---|
| `/` | portada: búsqueda, métricas en vivo, nodos mejor señalados, categorías |
| `/search` | resultados con filtros por categoría, estado y orden (relevancia, uptime, latencia, reciente) |
| `/sitio/{host}.onion` | ficha del nodo: uptime, historial de 30 chequeos, espejos, relacionados y reporte |
| `/directorio` | todos los nodos agrupados por categoría y ordenados por disponibilidad |
| `/estado` | estado de la red: incidentes abiertos, latencias altas, últimos chequeos |
| `/api` | documentación de la API pública |
| `/admin` | centro de mando protegido: métricas, nodos, reportes, blocklist y acciones |

Extras: paginación, badges de calidad (en línea / caído / espejo), copiado de
dirección, reportes anónimos, y cero recursos externos (ni fuentes ni CDNs:
todo lo que carga el navegador sale del propio onion).

## API pública

```bash
GET /api/search?q=biblioteca&status=online&sort=uptime&page=1
GET /api/stats
GET /api/sites?category=Foros&limit=25
GET /api/status          # corridas del pipeline y si hay tareas activas
GET /health
```

`/api/search` devuelve url, dominio, título, descripción, categoría, uptime,
latencia, último chequeo y estado online. Sin claves ni cuotas de lectura.

## Centro de mando

`/admin` (sesión con cookie httpOnly, token `ADMIN_TOKEN`).

- **Resumen**: nodos, uptime medio, documentos indexados, reportes pendientes.
- **Nodos**: búsqueda y filtros; bloquear/desbloquear.
- **Reportes**: bandeja anónima con acciones (bloquear o descartar).
- **Blocklist**: alta y baja de direcciones .onion.
- **Operaciones**: lanzar rastreo y chequeo de salud, reindexar, ver las
  últimas corridas con resultado y duración, y administrar las semillas.

## Pipeline de rastreo y salud

El pipeline es real y está integrado al portal: se dispara desde
`/admin/actions` y corre en un hilo aparte, sin bloquear las respuestas.
El progreso queda en la tabla `crawl_runs`, así que el panel (y `/api/status`)
lo puede leer aunque el trabajo lo haga otro proceso.

```
semillas (DB · TOR_SEED_URLS · seed_list.txt)
      │
      ▼
CrawlPipeline ── transporte SOCKS5 (live) o red simulada (sim)
      │            extrae título, descripción, texto y enlaces .onion
      │            deduplica por huella SHA-256 → marca espejos
      │            respeta blocklist (dominio y huella) + profundidad y tope
      ▼
OnionSite + SiteCheck  ──►  Meilisearch (si está)  ──►  ranking del portal
```

- **Una entrada por nodo**: todas las rutas de un host colapsan en
  `http://<host>`; el crawler indexa servicios, no páginas sueltas.
- **Salud**: hasta 80 nodos por barrido con 8 hilos, latencia medida y ventana
  de uptime sobre los últimos chequeos; cada resultado va a `SiteCheck`.
- **Semillas**: se administran desde el panel (alta, pausa, borrado) y se
  combinan con `TOR_SEED_URLS` y `seed_list.txt`.
- **Tareas**: una sola corrida por tipo a la vez (single-flight en proceso y en
  base); las corridas interrumpidas por un reinicio se marcan como error.

### Modo demo vs modo live

- `CRAWL_MODE=sim` (default): el mismo pipeline corre contra una **red onion
  simulada determinista** (33 nodos, contenidos y caídas fijas). Se puede
  rastrear, descubrir enlaces y verificar salud sin Tor. Algunos nodos solo
  aparecen siguiendo enlaces, como en la red real.
- `CRAWL_MODE=live`: todo el tráfico va por `TOR_SOCKS_PROXY`
  (`socks5h://…`, DNS remoto). Antes de arrancar se verifica el proxy; si Tor
  no responde, la corrida termina con un mensaje claro en el panel.
- `FARO_SEED=0` desactiva la semilla demo (recomendado en producción).

### CLI y tareas programadas

```bash
python -m crawler                          # rastreo único de las semillas
python -m health_checker                   # barrido de salud único
python -m scripts.worker                   # ciclo continuo (salud 30 min, rastreo 3 h)
python -m scripts.worker --once            # un barrido y sale
```

El compose incluye un servicio `worker` con el ciclo continuo apuntando a Tor.

La búsqueda usa Meilisearch si responde en `MEILI_URL`; si no, cae al motor
local (título > descripción > contenido, con boost por uptime y estado). El
portal nunca falla por falta de Meilisearch.

## Desarrollo local

```bash
bash scripts/start.sh          # crea .venv, instala deps y sirve en :3000
# o bien
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/uvicorn backend.main:app --reload --port 3000
```

Sin `DATABASE_URL` usa `./faro.db` (SQLite). El esquema se crea y la semilla
demo se carga en el arranque.

Pruebas de humo:

```bash
.venv/bin/pip install -r requirements-dev.txt
.venv/bin/python -m pytest tests -q
```

## Despliegue (Docker + Tor)

```bash
docker compose up -d --build
docker compose exec tor cat /var/lib/tor/faro/hostname   # tu dirección .onion
```

El compose levanta **app** (uvicorn), **db** (Postgres 17), **meili**
(Meilisearch) y **tor** (proxy SOCKS5 + servicio oculto v3 hacia `app:3000`).
Definí `ADMIN_TOKEN`, `TOR_SEED_URLS` y `FARO_SEED=0` antes de exponerlo.
Para HTTPS dentro del onion, `SECURE_COOKIES=true`.

## Seguridad

- Token de administración comparado en tiempo constante (`hmac.compare_digest`).
- Cookie `httpOnly`, `SameSite=Lax`, 8 h; `Secure` con `SECURE_COOKIES=true`.
- Las direcciones bloqueadas desaparecen del portal y de la API.
- Reportes anónimos: se guarda el motivo y el texto, no la IP ni el usuario.
- Sin telemetría, sin fuentes externas, sin analytics.

## Estructura

```
backend/main.py            rutas públicas, API y centro de mando
backend/search.py          motor de búsqueda (Meilisearch + fallback local)
backend/templates/         interfaz (base, búsqueda, ficha, directorio, estado, admin)
backend/static/css/        sistema de diseño FARO (sin dependencias)
db/models.py               OnionSite · SiteCheck · SiteReport · Blocklist
db/seed.py                 semilla demo determinista
db/database.py             engine, sesiones, init del esquema
indexer/meili_client.py    cliente Meilisearch tolerante a fallos
crawler/transport.py       TorTransport (SOCKS5) + red simulada determinista
crawler/parse.py           extracción de título, texto y enlaces
crawler/pipeline.py        semillas → rastreo → dedupe/espejos → índice
health_checker/checker.py  barrido de salud concurrente + SiteCheck
backend/jobs.py            cola single-flight en hilos + progreso en CrawlRun
scripts/worker.py          tareas programadas (salud / rastreo)
tests/                     pruebas de humo del portal
scripts/start.sh           arranque local
```

## Notas de operación

- El crawler es cortés: una petición por nodo, delays entre páginas y topes de
  profundidad; los servicios onion son lentos por diseño.
- En modo live, si Tor no está arriba la tarea falla rápido con diagnóstico en
  el panel en vez de dejar cientos de timeouts.
- Los nodos caídos siguen indexados pero penalizados; el filtro «en línea» los
  excluye.
- Revisá la legislación de tu jurisdicción antes de rastrear la dark web.

---

Última actualización: 2026-10-26
