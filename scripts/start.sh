#!/usr/bin/env bash
# Arranque local de FARO: prepara el entorno e inicia el portal en :3000.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ ! -x .venv/bin/python ]; then
  python3 -m venv .venv
fi

# Instalar solo si falta el stack (evita reinstalar en cada arranque).
if ! .venv/bin/python -c "import fastapi, uvicorn, sqlalchemy, jinja2" >/dev/null 2>&1; then
  .venv/bin/pip install --quiet --disable-pip-version-check -r requirements.txt
fi

exec .venv/bin/uvicorn backend.main:app --host 0.0.0.0 --port "${PORT:-3000}" "$@"
