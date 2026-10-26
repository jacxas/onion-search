# ── FARO · portal de búsqueda .onion ────────────────────────────────────
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=3000

WORKDIR /app

RUN addgroup --system faro && adduser --system --ingroup faro faro

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY backend ./backend
COPY db ./db
COPY indexer ./indexer
COPY crawler ./crawler
COPY health_checker ./health_checker

RUN chown -R faro:faro /app
USER faro

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:3000/health').read()"

# Variables de runtime:
#   DATABASE_URL       postgresql+psycopg2://faro:faro@db:5432/faro
#   ADMIN_TOKEN        token del centro de mando (/admin)
#   CRAWL_MODE         live (Tor real) | sim (demo, por defecto)
#   TOR_SOCKS_PROXY    socks5h://tor:9050   (solo live)
#   TOR_SEED_URLS      semillas separadas por comas (opcional)
#   MEILI_URL / MEILI_MASTER_KEY  (opcional, acelera la búsqueda)
#   FARO_SEED=0        desactiva la semilla de demostración
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "3000"]
