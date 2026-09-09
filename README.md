# Onion Search Engine

Motor de búsqueda para la red Tor (.onion) enfocado en fiabilidad, uptime tracking y deduplicaciÃ³n.

## CaracterÃ¬sticas

- âœ… Crawler Tor-aware con retries automÃ¡ticos
- âœ… Health checker en tiempo real
- âœ… DeduplicaciÃ³n de mirrors por content hash
- âœ… Uptime tracking y scoring
- âœ… Blocklists para contenido ilegal
- âœ… Ãndice fresco con invalidaciÃ³n automÃ¡tica
- âœ… Interfaz web minimalista sin JS pesado
- âœ… Admin dashboard para gestiÃ³n

## Stack

- **Crawler**: Python + `requests[socks]` + `tenacity`
- **Health Checker**: Python + `asyncio` + `aiohttp`
- **Ã¯ndice**: Meilisearch
- **DB**: PostgreSQL (uptime, blocklists, reports)
- **Backend**: FastAPI
- **Frontend**: HTML + HTMX
- **Deployment**: Docker

## Estructura

```
onion-search/
â¼¼â¼¤ crawler/
â¼º  ââ¼¤ __init__.py
â¼º  ââ¼¤ tor_session.py
â¼º  ââ¼¤ spider.py
â¼º  ââ¼¤ extractor.py
â¼¼â¼¤ health_checker/
â¼º  ââ¼¤ __init__.py
â¼º  ââ¼¤ checker.py
â¼¼â¼¤ indexer/
â¼º  ââ¼¤ __init__.py
â¼º  ââ¼¤ meili_client.py
â¼¼â¼¤ backend/
â¼º  ââ¼¤ __init__.py
â¼º  ââ¼¤ main.py
â¼º  ââ¼¤ admin.py
â¼º  ââ¼¤ templates/
â¼¼â¼¤ db/
â¼º  ââ¼¤ models.py
â¼º  ââ¼¤ database.py
â¼¼â¼¤ config/
â¼º  ââ¼¤ torrc
â¼º  ââ¼¤ settings.py
â¼¼â¼¤ docker/
â¼º  ââ¼¤ Dockerfile
â¼º  ââ¼¤ docker-compose.yml
â¼º  ââ¼¤ tor-entrypoint.sh
â¼¼â¼¤ seed_list.txt
â¼¼â¼¤ blocklist.txt
â¼¼â¼¤ requirements.txt
â¼¼â¼¤ .env.example
â¼¼â¼¤ .gitignore
â¼¼â¼¤ README.md
```

## InstalaciÃ³n rÃ¡pida

```bash
# Clonar repo
git clone https://github.com/jacxas/onion-search.git
cd onion-search

# Copiar env
cp .env.example .env

# Iniciar con Docker
docker-compose up -d

# Ver logs
docker-compose logs -f crawler
docker-compose logs -f health_checker
```

## ConfiguraciÃ³n

Editar `.env`:

```env
# Tor
TOR_SOCKS_HOST=127.0.0.1
TOR_SOCKS_PORT=9050

# Meilisearch
MEILI_URL=http://meilisearch:7700
MEILI_MASTER_KEY=tu-master-key

# PostgreSQL
DATABASE_URL=postgresql://postgres:password@db:5432/onion_search

# Crawler
CRAWLER_CONCURRENCY=2
CRAWLER_TIMEOUT=30
CRAWLER_MAX_PAGES=1000

# Health checker
HEALTH_CHECK_INTERVAL=3600
HEALTH_CHECK_TIMEOUT=15

# Admin dashboard
ADMIN_TOKEN=tu-token-secreto
```

## Uso

### Agregar seed list

Editar `seed_list.txt` con direcciones .onion iniciales.

### Ver interfaz

Acceder a `http://localhost:8080` (interfaz web) o `http://localhost:8000/admin` (admin dashboard).

### API

```bash
# Buscar
curl "http://localhost:8000/api/search?q=crypto"

# Verificar sitio
curl "http://localhost:8000/api/health?url=http://example.onion"

# Stats
curl "http://localhost:8000/api/stats"
```

## Admin Dashboard

Acceder a `http://localhost:8000/admin` con el token configurado en `ADMIN_TOKEN`.

Funcionalidades:
- MÃ©tricas en tiempo real
- GestiÃ³n de blocklist
- Reportes de usuarios
- BÃºsqueda y administraciÃ³n de sitios
- Forzar crawls y health checks

## Desarrollo

```bash
# Instalar dependencias
pip install -r requirements.txt

# Correr crawler localmente
python -m crawler.spider

# Correr health checker
python -m health_checker.checker

# Backend
uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
```

## Blocklists

Agregar dominios bloqueados en `blocklist.txt` (uno por lÃ¬nea).

## Licencia

MIT
