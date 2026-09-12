# FARO — motor de búsqueda para servicios .onion

Buscador fullstack para la red Tor con las piezas que hacen fallar a los motores
tradicionales **ya resueltas**:

| Pieza | Implementación |
|---|---|
| Descubrimiento | cola de rastreo con semillas + extracción de enlaces por página |
| Crawling | fetch vía proxy **SOCKS5** (`socks5h`, DNS remoto), timeouts largos, backoff exponencial, límites de profundidad y por dominio |
| Filtrado | blocklist por **dominio / hash / keyword** + reportes de usuarios |
| Indexación | PostgreSQL FTS (`tsvector` + `websearch_to_tsquery`) |
| Deduplicación | fingerprint SHA-256 del contenido normalizado → **espejos agrupados** |
| Salud | health checker con historial, uptime (últimos 100 checks), timeouts adaptativos |
| Retrieval | ranking = relevancia × uptime + boost si está en línea − castigo si está caído |
| Interfaz | Next.js, modo oscuro terminal, resultados con estado verificado |
| Seguridad | login admin (scrypt + sesiones firmadas), CSRF, rate-limit, alertas por email |

## Seguridad del panel

- `/ops` y todas las acciones de mutación exigen sesión (`/login`).
- Contraseñas con **scrypt** (sal aleatoria, comparación `timingSafeEqual`).
- Sesiones: token aleatorio de 256 bits en cookie httpOnly; en la DB solo su
  hash SHA-256; expiración 7 días; cambio de clave invalida otras sesiones.
- Rate-limit de login: 6 intentos / 10 min por email.
- `CSRF_ENABLED=true` valida Origin same-origin en endpoints con cookie; las
  server actions ya traen validación de Origin propia de Next.
- `SECURE_COOKIES=true` solo en producción con HTTPS.
- Admin inicial desde `ADMIN_INITIAL_EMAIL` / `ADMIN_INITIAL_PASSWORD`
  (default `admin@faro.local` / `faro-admin-123` — cambiarla en el primer login).

## Alertas por email (opcional)

Con `MAIL_USERNAME` + `MAIL_PASSWORD` (Gmail App Password o SMTP genérico con
`MAIL_HOST`) definidos, FARO avisa a `MAIL_ALERT_TO` cuando:

- un servicio estable pasa a **offline** (o se recupera),
- el crawler aplica un **bloqueo** de blocklist,
- un usuario envía un **reporte**.

Throttle incorporado para no repetir alertas de hosts inestables.

## Estructura

```
src/lib/onion.ts            validación/normalización .onion, fingerprints, PRNG
src/lib/tor/transport.ts    transporte SOCKS5 (live) + sim
src/lib/tor/sim.ts          red onion simulada determinista (~46 hosts enlazados)
src/lib/crawler/parse.ts    extracción HTML (cheerio): título, texto, enlaces
src/lib/crawler/pipeline.ts orquestación: seed → crawl → dedupe → health
src/lib/search.ts           FTS + ranking + stats
src/lib/auth.ts             scrypt, sesiones, guards, rate-limit de login
src/lib/mail.ts             alertas por email (nodemailer/Gmail/SMTP)
src/app/api/search          búsqueda pública (ranking por uptime)
src/app/api/admin/run       disparar crawler/sweep/seed (token o sesión)
src/app/login               acceso admin
src/app/ops                 centro de mando (protegido: sesión obligatoria)
src/app/sitio/[domain]      ficha de nodo: historial, espejos, páginas, acciones
```

## Modo simulado vs modo live

- `CRAWL_MODE=sim` (default): no requiere Tor. La red de `sim.ts` es
  determinista: los mismos dominios, contenidos, latencias y caídas en cada
  ejecución. Sirve para verificar todo el pipeline de punta a punta.
- `CRAWL_MODE=live`: el crawler enruta todo por `TOR_SOCKS_PROXY`
  (`socks5h://127.0.0.1:9050` por defecto).

## Despliegue real (Docker)

```bash
docker compose --profile migrate up migrate   # aplica el esquema
docker compose up -d --build                   # app + postgres + tor
docker compose exec tor cat /var/lib/tor/faro/hostname   # tu dirección .onion
```

El compose incluye:
- **app** (Next.js standalone), **db** (Postgres 17), **tor** con `torrc.example`
  montado (SOCKS5 saliente + servicio oculto v3 hacia `app:3000`).

Semillas en live: definí `TOR_SEED_URLS` con hubs conocidos, o agregá semillas
desde el panel `/ops`.

## Desarrollo local

```bash
npm install
npx drizzle-kit push        # crea las tablas
npm run dev                 # http://localhost:3000 (modo sim)
```

La primera visita a `/` siembra los hubs y ejecuta un lote de rastreo +
health sweep, así el índice se puebla solo.

## Notas de operación

- El crawler es secuencial y cortés (timeouts largos, reintentos limitados):
  los servicios onion son lentos e inestables por diseño.
- Los sitios caídos quedan indexados pero penalizados en el ranking; el filtro
  «solo en línea» los excluye.
- `ADMIN_TOKEN` protege `/api/admin/run` en producción.
- Revisá la legislación de tu jurisdicción antes de rastrear la dark web.
