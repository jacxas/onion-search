# Despliegue de FARO en Fly.io

FARO no encaja en un runtime serverless: es un proceso uvicorn de larga vida
que además corre tareas en hilos (`backend/jobs.py`) y necesita un proxy Tor
para el modo `live`. En Fly.io eso se resuelve con **una app y dos grupos de
proceso** desde la misma imagen:

| Grupo | Comando | Función |
|---|---|---|
| `app` | `uvicorn backend.main:app` | portal, API y panel; recibe el tráfico HTTP |
| `worker` | `python -m scripts.worker` | salud cada 30 min y rastreo cada 3 h, sin HTTP |

La base de datos va en **Postgres gestionado de Fly**. SQLite no sirve: el
disco de una máquina Fly es efímero y el índice se perdería en cada reinicio
(por eso `db/database.py` aborta con un mensaje explícito si detecta
`FLY_APP_NAME` sin `DATABASE_URL`).

---

## 1. Requisitos

```bash
curl -L https://fly.io/install.sh | sh    # CLI de Fly
fly auth login
```

## 2. Crear la app y la base

Desde la raíz del repo (donde está `fly.toml`):

```bash
fly apps create faro-onion            # si el nombre está tomado, elegí otro
fly mpg create --name faro-db --region gru
fly mpg attach faro-db --app faro-onion   # define DATABASE_URL como secreto
```

`fly mpg` es el Postgres gestionado actual de Fly. Si tu organización todavía
usa el clásico:

```bash
fly postgres create --name faro-db --region gru
fly postgres attach faro-db --app faro-onion
```

## 3. Secretos

```bash
# Token del centro de mando (/admin/login). Usá algo largo y aleatorio.
fly secrets set ADMIN_TOKEN="$(openssl rand -hex 24)"

# Opcional: email de alertas
fly secrets set MAIL_USERNAME=... MAIL_PASSWORD=... MAIL_ALERT_TO=...
```

El nombre de la app en `fly.toml` es `faro-onion`. Si creaste otra, cambialo
ahí o pasá `--app` en todos los comandos.

## 4. Primer deploy

```bash
fly deploy
```

Fly construye el `Dockerfile` de la raíz, arranca `app` y ejecuta el chequeo
`/health` cada 30 s. Como `[processes]` declara dos grupos, el `worker` no
arranca solo: escalalo una vez.

```bash
fly scale count app=1 worker=1
fly status
fly logs --process worker
```

Con `FARO_SEED=1` (valor por defecto en `fly.toml`) el arranque carga la
semilla demo si las tablas están vacías, así el portal no aparece vacío.
La semilla es idempotente.

```bash
curl https://faro-onion.fly.dev/health
curl https://faro-onion.fly.dev/api/stats
```

## 5. Modo real (Tor)

En modo `sim` el pipeline rastrea una red onion simulada determinista: sirve
para ver el portal completo, no para indexar la red real. Para eso hace falta
Tor dentro de la máquina, y eso es la imagen alternativa:

```bash
fly deploy --config deploy/fly/fly.tor.toml
```

Ese `fly.toml` usa `deploy/fly/Dockerfile.tor`, que:

- instala `tor` y arranca el demonio desde `deploy/fly/entrypoint-tor.sh`;
- expone SOCKS5 en `127.0.0.1:9050` (`TOR_SOCKS_PROXY`);
- publica el portal como **servicio oculto v3** (`HiddenServicePort 80 → 3000`).

Para ver la dirección onion:

```bash
fly ssh console --app faro-onion -C "cat /var/lib/tor/faro/hostname"
```

Notas del modo live:

- Definí `FARO_SEED=0` y cargá semillas reales desde `/admin/actions` o con
  `fly secrets set TOR_SEED_URLS="http://...onion,http://...onion"`.
- El servicio oculto necesita un **volumen** para conservar la clave privada
  entre deploys; si no, la dirección `.onion` cambia cada vez:

  ```bash
  fly volumes create faro_tor --size 1 --region gru
  # y en el fly.toml de Tor:
  # [[mounts]]
  #   source = "faro_tor"
  #   destination = "/var/lib/tor"
  ```

- La primera vez que arranca, Tor tarda ~30 s en publicar el descriptor.
- El `worker` también corre en esta imagen: usa el mismo SOCKS5 local.

## 6. Meilisearch (opcional)

La búsqueda funciona sin Meilisearch (motor local sobre Postgres). Si querés
relevancia con tolerancia a errores, desplegalo como app aparte:

```bash
fly apps create faro-meili
fly volumes create meili_data --size 1 --app faro-meili --region gru
```

Con una `fly.toml` mínima para esa app (imagen `getmeili/meilisearch:v1.12`,
`MEILI_MASTER_KEY`, `internal_port = 7700`, sin `[http_service]` público) y
luego, en FARO:

```bash
fly secrets set MEILI_URL="http://faro-meili.flycast:7700" MEILI_MASTER_KEY="..."
```

## 7. Costos y ajustes

- `app`: `shared-cpu-1x` / 512 MB; `worker`: `shared-cpu-1x` / 256 MB.
- `auto_stop_machines = "stop"` deja dormir la `app` sin tráfico; el `worker`
  no tiene `http_service`, así que nunca se detiene. Si querés la `app`
  siempre caliente: `min_machines_running = 1` (ya está) y
  `auto_stop_machines = false`.
- **Una sola máquina de `app`**: las tareas viven en memoria del proceso
  (single-flight por proceso). Con dos máquinas, cada una puede lanzar su
  propio rastreo; el lock en base evita el solapamiento pero conviene
  quedarse en 1 hasta mover la cola a un servicio externo.
- Postgres gestionado se factura aparte; el plan chico alcanza para este
  índice.

## 8. Actualizaciones

```bash
git pull
fly deploy
```

Las migraciones son idempotentes: `init_db()` crea tablas y
`_ensure_columns()` agrega columnas nuevas al arrancar. No hay paso manual.
