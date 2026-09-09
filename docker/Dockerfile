# Dockerfile para Tor + Python app
FROM python:3.11-slim

# Instalar Tor y dependencias
RUN apt-get update && apt-get install -y \
    tor \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Configurar usuario no-root
RUN useradd -m -u 1000 appuser
USER appuser
WORKDIR /app

# Instalar dependencias Python
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar cÃ³digo
COPY . .

# Exponer puertos
EXPOSE 9050 9051 80 8000

# Entrypoint
CMD ["python", "-m", "crawler.spider"]
