# FARO — Base44 dev notes

## What actually runs here

This repo contains **two incomplete frontend attempts** plus the real app:

- **Root Next.js project** (`package.json`, `next.config.ts`, `Dockerfile`, `docker-compose.yml`):
  real config files but **no `src/` directory** — the source the README describes
  (`src/lib/onion.ts`, `src/db/schema.ts`, …) does not exist. `npm run dev/build`
  cannot work. Do not try to run it.
- **`frontend/`**: every file is a placeholder stub
  (`// Contenido de page.tsx (20.5KB) - …`), including `package.json`. Not runnable.
- **`backend/` + `db/` + `indexer/` + `crawler/` + `health_checker/` (Python)**:
  the real, complete application. A **FastAPI** app (`backend/main.py`) serves
  server-rendered **Jinja2** templates (`backend/templates/*.html`) — the HTML UI
  is produced by the backend, there is no separate JS frontend. Backed by
  **PostgreSQL** (SQLAlchemy, `db/`) and **MeiliSearch** (`indexer/`).

The Base44 compose runs only the FastAPI app + Postgres + MeiliSearch. The
crawler/Tor path (`crawler/`, `health_checker/`) needs a live Tor SOCKS proxy and
real `.onion` seeds; it is **not** started in the preview and is not needed to
boot or browse the UI.

## Boot

```
docker compose -f docker-compose.base44.yml up -d --build
```

App on host port **3000** (`uvicorn backend.main:app --reload`). Health: `GET /health`.

## Fixes applied to make it boot

- `db/database.py`: `from models import Base` → `from db.models import Base`
  (the bare import failed when loaded as `db.database` from the repo root).
- `backend/static/` created (was missing; `StaticFiles` mount crashed on startup).

## Local infra credentials (inline in compose, not secrets)

- Postgres: `faro:faro@db:5432/faro`
- MeiliSearch: `http://meili:7700`, master key `dev-master-key`
- Admin login token: `admin-secret-token` (env `ADMIN_TOKEN`); log in at `/admin/login`.

## Optional external credentials (NOT required to boot)

- `MAIL_USERNAME` / `MAIL_PASSWORD` / `MAIL_ALERT_TO` — email alerts (Gmail/SMTP).
- `TOR_SOCKS_PROXY` + `TOR_SEED_URLS` — only for live crawling, not used in preview.

No `requiredAtBoot` secrets exist; the app starts with no external credentials.

## Known gotchas

- `crawler/spider.py` and `health_checker/checker.py` use bare imports
  (`from database import …`, `from models import …`) that only work when run from
  inside their own package; they are not invoked by the web app.
- `backend/auth/security.py` imports `jose`, `passlib`, `pyotp`, `qrcode` which are
  **not** in `requirements.txt`; it is unused by `main.py` so it does not break boot.
- Search returns no results until the crawler populates Postgres + MeiliSearch;
  with no Tor/crawl in the preview the index is intentionally empty.
