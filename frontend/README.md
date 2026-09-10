# Frontend Next.js - Onion Search Dashboard

Dashboard moderno para Onion Search Engine construido con Next.js 16, React 19, TypeScript y Tailwind CSS.

## CaracterÃ¬sticas

- Interfaz de bÃºsqueda en tiempo real
- Dashboard administrativo con mÃ©tricas
- IntegraciÃ³n con PostgreSQL (Drizzle ORM)
- BÃºsqueda full-text con Meilisearch
- Crawler de sitios .onion vÃ¬a Tor
- Health checking automÃ¡tico

## Stack TecnolÃ³gico

- **Framework**: Next.js 16 con App Router
- **Lenguaje**: TypeScript 5.9
- **Estilos**: Tailwind CSS 4.1
- **UI**: Lucide React (iconos)
- **Base de datos**: PostgreSQL con Drizzle ORM
- **BÃºsqueda**: Meilisearch
- **HTTP**: Axios + SOCKS5 proxy para Tor

## InstalaciÃ³n

```bash
# Instalar dependencias
npm install

# Configurar variables de entorno
cp .env.example .env

# Aplicar schema de base de datos
npx drizzle-kit push

# Iniciar servidor de desarrollo
npm run dev
```

## Variables de Entorno

Ver `.env.example` para la lista completa.

```env
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db
MEILI_HOST=http://localhost:7700
MEILI_API_KEY=masterKey
TOR_SOCKS_HOST=127.0.0.1
TOR_SOCKS_PORT=9050
SECRET_KEY=generar-con-secrets-token-urlsafe
```

## Scripts Disponibles

```bash
npm run dev         # Servidor de desarrollo
npm run build       # Build de producciÃ³n
npm run start       # Iniciar en producciÃ³n
npm run lint        # ESLint
npm run typecheck   # TypeScript check
```

## Estructura de Directorios

```
app/
â¼¼â¼¤ page.tsx              # PÃ¡gina principal de bÃºsqueda
â¼¼â¼¤ layout.tsx            # Layout base con providers
â¼¼â¼¤ admin/
â¼º  ââ¼¤ page.tsx           # Dashboard administrativo
â¼º  ââ¼¤ layout.tsx        # Layout del admin
â¼¼â¼¤ api/
â¼º  ââ¼¤ search/
â¼º  â  ââ¼¤ route.ts        # API de bÃºsqueda
â¼º  ââ¼¤ sites/
â¼º  â  ââ¼¤ route.ts        # GestiÃ³n de sitios
â¼º  ââ¼¤ stats/
â¼º     ââ¼¤ route.ts        # EstadÃ¬sticas del sistema

components/
â¼¼â¼¤ ui/                   # Componentes base
â¼¼â¼¤ search/               # Componentes de bÃºsqueda
â¼¼â¼¤ admin/                # Componentes del dashboard

lib/
â¼¼â¼¤ db/                   # Cliente PostgreSQL (Drizzle)
â¼¼â¼¤ meilisearch/          # Cliente Meilisearch
â¼¼â¼¤ crawler/              # LÃ³gica de crawling
â¼¼â¼¤ utils/                # Utilidades

drizzle/
â¼¼â¼¤ schema.ts             # Schema de base de datos
â¼¼â¼¤ migrations/           # Migraciones
```

## API Endpoints

### GET /api/search

Buscar sitios .onion indexados.

**Query params:**
- `q`: TÃ©rmino de bÃºsqueda
- `page`: NÃºmero de pÃ¡gina
- `limit`: Resultados por pÃ¡gina
- `sort`: "uptime" | "relevance" | "date"
- `minUptime`: Porcentaje mÃ¬nimo (0-100)
- `onlyOnline`: true | false

### POST /api/sites

Agregar sitio a la cola de crawl.

```json
{
  "url": "example.onion"
}
```

### GET /api/stats

Obtener estadÃ¬sticas del sistema.

```json
{
  "success": true,
  "stats": {
    "totalSites": 150,
    "onlineSites": 120,
    "blockedSites": 5,
    "queueCount": 30
  }
}
```

## Docker

```bash
# Build
docker-compose build

# Iniciar todos los servicios
docker-compose up -d

# Ver logs
docker-compose logs -f app
```

## PrÃ³ximos Pasos

- [ ] Subir archivos completos desde Drive
- [ ] Integrar autenticaciÃ³n con backend Python
- [ ] Unificar schema de base de datos
- [ ] Configurar CI/CD
- [ ] Tests E2E

## Licencia

MIT
