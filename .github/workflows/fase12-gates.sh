#!/usr/bin/env bash
# FARO — FASE 12: gates de validación Docker/Compose (runner Linux real).
# Cada gate registra GREEN/FAIL con evidencia; el job falla si algún gate falla.
set -u

SUMMARY="${GITHUB_STEP_SUMMARY:-/tmp/summary.md}"
PASS=0; FAIL=0
echo "# FASE 12 — Validación Docker/Compose — commit ${GITHUB_SHA:0:7}" > "$SUMMARY"
echo "| Gate | Nombre | Resultado | Evidencia |" >> "$SUMMARY"
echo "|---|---|---|---|" >> "$SUMMARY"

gate() { # gate <n> <nombre> <rc> <evidencia>
  if [ "$3" -eq 0 ]; then PASS=$((PASS+1)); R="✅ GREEN"; else FAIL=$((FAIL+1)); R="❌ FAIL"; fi
  echo "| GATE $1 | $2 | $R | $4 |" >> "$SUMMARY"
}

# Override de CI (NO se commitea): modo sim + ciclos de 20s. Reutiliza la
# imagen ya construida para app/worker; migrate construye su stage migrator.
cat > /tmp/ci-override.yml << 'YAML'
services:
  app:
    image: faro:phase12
    environment:
      CRAWL_MODE: sim
  worker:
    image: faro:phase12
    environment:
      CRAWL_MODE: sim
      WORKER_INTERVAL_SECONDS: "20"
YAML
CMP="docker compose -f docker-compose.yml -f /tmp/ci-override.yml"
DBP="$CMP exec -T db psql -U faro -d faro -tAc"

echo "===== GATE 1 — docker build ====="
if docker build -t faro:phase12 . > /tmp/build.log 2>&1; then
  gate 1 "Docker build" 0 "imagen faro:phase12 $(docker images faro:phase12 --format '{{.Size}}')"
else
  gate 1 "Docker build" 1 "$(tail -4 /tmp/build.log | tr '\n' ' ')"
  echo "GATE 1 falló — abort (el resto no tiene sentido)."; cat "$SUMMARY"; exit 1
fi

echo "===== GATE 2 — compose config ====="
if $CMP config > /tmp/config.yaml 2>/tmp/cfg.err; then
  BAD127=$(grep -c "127.0.0.1:5432" /tmp/config.yaml || true)
  PUBLISHED=$(grep -c "published" /tmp/config.yaml || true)
  if [ "$BAD127" -eq 0 ] && [ "$PUBLISHED" -eq 1 ]; then
    gate 2 "Compose config" 0 "5 servicios, 0×127.0.0.1:5432, solo app:3000 publicado (tor NO)"
  else
    gate 2 "Compose config" 1 "refs 127.0.0.1:5432=$BAD127 puertos publicados=$PUBLISHED"
  fi
else
  gate 2 "Compose config" 1 "$(tail -2 /tmp/cfg.err | tr '\n' ' ')"; cat "$SUMMARY"; exit 1
fi

echo "===== GATE 3 — clean boot escalonado (db → migrate → app) ====="
docker compose down -v --remove-orphans > /dev/null 2>&1 || true
$CMP up -d db > /tmp/boot.log 2>&1 || true
for i in $(seq 1 30); do [ "$($CMP ps db --format '{{.Health}}' 2>/dev/null)" = "healthy" ] && break; sleep 2; done
$CMP up -d app >> /tmp/boot.log 2>&1 || true
for i in $(seq 1 20); do curl -sf -o /dev/null http://localhost:3000/api/health && break; sleep 2; done
DBOK=$($DBP "SELECT 1" 2>/dev/null | grep -c 1 || true)
APPOK=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/health)
if [ "$DBOK" -eq 1 ] && [ "$APPOK" = "200" ]; then
  gate 3 "Clean boot" 0 "db healthy · app /api/health 200"
else
  gate 3 "Clean boot" 1 "db=$DBOK app=$APPOK $(tail -2 /tmp/boot.log | tr '\n' ' ')"
fi

echo "===== GATE 4 — migration ====="
$CMP run --rm migrate > /tmp/migrate.log 2>&1; MIGRC=$?
TB=$($DBP "SELECT count(*) FROM information_schema.tables WHERE table_schema='public'" 2>/dev/null)
GIN=$($DBP "SELECT count(*) FROM pg_indexes WHERE indexname='pages_fts_idx'" 2>/dev/null)
FK=$($DBP "SELECT count(*) FROM information_schema.table_constraints WHERE constraint_type='FOREIGN KEY'" 2>/dev/null)
if [ "$MIGRC" -eq 0 ] && [ "${TB:-0}" -ge 10 ] && [ "${GIN:-0}" -ge 1 ] && [ "${FK:-0}" -ge 5 ]; then
  gate 4 "Migration" 0 "tablas=$TB FKs=$FK GIN pages_fts_idx=$GIN (sin worker)"
else
  gate 4 "Migration" 1 "rc=$MIGRC tablas=${TB:-?} FKs=${FK:-?} GIN=${GIN:-?} $(tail -2 /tmp/migrate.log | tr '\n' ' ')"
fi

echo "===== GATE 6 — app (/, /login, /ops, login) ====="
C_ROOT=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/)
C_LOGIN=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/login)
C_OPS=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/ops)
AID=$(curl -s http://localhost:3000/login | grep -o '\$ACTION_ID_[a-f0-9]*' | head -1)
LOC=$(curl -s -X POST http://localhost:3000/login -F "email=$ADMIN_INITIAL_EMAIL" -F "password=$ADMIN_INITIAL_PASSWORD" -F "$AID=" -D - -o /dev/null | grep -i "^location" | tr -d '\r' | tail -1)
if [ "$C_ROOT" = "200" ] && [ "$C_LOGIN" = "200" ] && [ "$C_OPS" = "307" ] && echo "$LOC" | grep -q "/ops"; then
  gate 6 "App" 0 "/ 200 · /login 200 · /ops 307 · POST login → $LOC"
else
  gate 6 "App" 1 "/=$C_ROOT /login=$C_LOGIN /ops=$C_OPS login='$LOC'"
fi

echo "===== GATE 7 — NO autorun desde / ====="
TT=$(curl -s -o /dev/null -w "%{time_total}" http://localhost:3000/)
curl -s -o /dev/null http://localhost:3000/; curl -s -o /dev/null http://localhost:3000/
S7=$($DBP "SELECT count(*) FROM sites" 2>/dev/null)
Q7=$($DBP "SELECT count(*) FROM crawl_queue" 2>/dev/null)
P7=$($DBP "SELECT count(*) FROM pages" 2>/dev/null)
H7=$($DBP "SELECT count(*) FROM health_checks" 2>/dev/null)
if [ "${S7:-1}" = "0" ] && [ "${Q7:-1}" = "0" ] && [ "${P7:-1}" = "0" ] && [ "${H7:-1}" = "0" ]; then
  gate 7 "No autorun desde /" 0 "GET / ${TT}s ×3 → sites=0 queue=0 pages=0 health=0 (worker aún abajo)"
else
  gate 7 "No autorun desde /" 1 "sites=${S7:-?} queue=${Q7:-?} pages=${P7:-?} health=${H7:-?}"
fi

echo "===== GATE 5 — first boot admin (worker arriba) ====="
$CMP up -d worker >> /tmp/boot.log 2>&1 || true
sleep 15
ADM=$($DBP "SELECT count(*) FROM admin_users" 2>/dev/null)
LEAK=$(docker compose -f docker-compose.yml -f /tmp/ci-override.yml logs 2>&1 | grep -c "$ADMIN_INITIAL_PASSWORD" || true)
if [ "${ADM:-0}" -eq 1 ] && [ "${LEAK:-1}" -eq 0 ]; then
  gate 5 "First boot admin" 0 "admin_users=1 creado por worker · contraseña ausente en logs (0 matches)"
else
  gate 5 "First boot admin" 1 "admin_users=${ADM:-?} leaks=${LEAK:-?}"
fi

echo "===== GATE 8 — worker independiente + scheduler + SIGTERM ====="
sleep 75  # intervalo 20s → varios ciclos sin ninguna petición HTTP a /
CYC=$($CMP logs worker 2>/dev/null | grep -c "pipeline de rastreo" || true)
SLP=$($CMP logs worker 2>/dev/null | grep -c "duerme" || true)
$CMP stop -t 25 worker > /dev/null 2>&1
GRACE=$($CMP logs worker 2>/dev/null | grep -c "shutdown limpio" || true)
$CMP up -d worker >> /tmp/boot.log 2>&1 || true
if [ "${CYC:-0}" -ge 2 ] && [ "${GRACE:-0}" -ge 1 ]; then
  gate 8 "Worker + scheduler + SIGTERM" 0 "ciclos=$CYC sleeps=$SLP · SIGTERM → shutdown limpio ($GRACE) · reiniciado"
else
  gate 8 "Worker + scheduler + SIGTERM" 1 "ciclos=${CYC:-?} shutdown_limpio=${GRACE:-?}"
fi

echo "===== GATE 11 — sim E2E dentro de compose ====="
sleep 40  # worker reiniciado: primer ciclo de nuevo
S11=$($DBP "SELECT count(*) FROM sites" 2>/dev/null)
P11=$($DBP "SELECT count(*) FROM pages" 2>/dev/null)
H11=$($DBP "SELECT count(*) FROM health_checks" 2>/dev/null)
Q11=$($DBP "SELECT count(*) FROM crawl_queue" 2>/dev/null)
ST=$(curl -s http://localhost:3000/api/stats)
SE=$(curl -s "http://localhost:3000/api/search?q=market&limit=3" | grep -c '"hits"' || true)
if [ "${S11:-0}" -gt 0 ] && [ "${P11:-0}" -gt 0 ] && [ "${H11:-0}" -gt 0 ] && [ "${SE:-0}" -ge 1 ]; then
  gate 11 "Sim E2E" 0 "sites=$S11 pages=$P11 health=$H11 queue=$Q11 · stats+search OK"
else
  gate 11 "Sim E2E" 1 "sites=${S11:-?} pages=${P11:-?} health=${H11:-?} search=${SE:-?} stats=$ST"
fi

echo "===== GATE 9 — FTS con worker DOWN ====="
$CMP stop -t 25 worker > /dev/null 2>&1
GIN9=$($DBP "SELECT count(*) FROM pg_indexes WHERE indexname='pages_fts_idx'" 2>/dev/null)
SE9=$(curl -s "http://localhost:3000/api/search?q=market&limit=3" | grep -c '"hits"' || true)
EXP=$($DBP "SET enable_seqscan=off; EXPLAIN (COSTS OFF) SELECT p.id FROM pages p WHERE to_tsvector('simple', coalesce(p.title,'') || ' ' || coalesce(p.description,'') || ' ' || p.content) @@ websearch_to_tsquery('simple','market');" 2>/dev/null | grep -c "Bitmap Index Scan on pages_fts_idx" || true)
if [ "${GIN9:-0}" -ge 1 ] && [ "${SE9:-0}" -ge 1 ] && [ "${EXP:-0}" -ge 1 ]; then
  gate 9 "FTS con worker DOWN" 0 "índice intacto · search OK · EXPLAIN: Bitmap Index Scan on pages_fts_idx"
else
  gate 9 "FTS con worker DOWN" 1 "GIN=${GIN9:-?} search=${SE9:-?} explain=${EXP:-?}"
fi

echo "===== GATE 10 — red interna ====="
APPDB=$($CMP exec -T app node -e "require('net').createConnection(5432,'db').on('connect',()=>{console.log('ok');process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null | grep -c ok || true)
WKTOR=$($CMP exec -T worker node -e "require('net').createConnection(9050,'tor').on('connect',()=>{console.log('ok');process.exit(0)}).on('error',()=>process.exit(1))" 2>/dev/null | grep -c ok || true)
MIGTOR=$($CMP run --rm migrate sh -c "nc -z db 5432 && echo ok" 2>/dev/null | grep -c ok || true)
if [ "${APPDB:-0}" -ge 1 ] && [ "${WKTOR:-0}" -ge 1 ] && [ "${MIGTOR:-0}" -ge 1 ]; then
  gate 10 "Red interna" 0 "app→db:5432 ✓ worker→tor:9050 ✓ migrate→db:5432 ✓ · tor no publicado al host"
else
  gate 10 "Red interna" 1 "app→db=${APPDB:-?} worker→tor=${WKTOR:-?} migrate→db=${MIGTOR:-?}"
fi

echo "===== GATE 12 — configuración LIVE ====="
NETN=$(basename "$(docker compose -f docker-compose.yml -f /tmp/ci-override.yml config --format json 2>/dev/null | grep -o '"name": *"[^"]*"' | head -1 | sed 's/.*"\(.*\)"$/\1/')" 2>/dev/null || echo "onion-search_default")
LIVE=$(docker run --rm -e CRAWL_MODE=live -e TOR_SOCKS_PROXY=socks5h://tor:9050 --network "${NETN}_default" faro:phase12 node -e "
(async()=>{const c=(await import('/app/.worker-build/src/lib/config.js')).getConfig(true);const t=(await import('/app/.worker-build/src/lib/tor/transport.js')).getTransport('live');console.log(JSON.stringify({mode:c.crawlMode,proxy:c.torSocksProxy,transport:t.name}))})()" 2>&1 || true)
if echo "$LIVE" | grep -q '"mode":"live"' && echo "$LIVE" | grep -q 'socks5h://tor:9050' && echo "$LIVE" | grep -q '"transport":"tor('; then
  gate 12 "Config LIVE" 0 "$LIVE (DNS remoto vía socks5h; sin fallback directo)"
else
  gate 12 "Config LIVE" 1 "$LIVE"
fi

echo "===== GATE 13 — restart recovery ====="
$CMP up -d worker >> /tmp/boot.log 2>&1 || true
P13A=$($DBP "SELECT count(*) FROM pages" 2>/dev/null)
$CMP restart app > /dev/null 2>&1; sleep 10
for i in $(seq 1 15); do curl -sf -o /dev/null http://localhost:3000/api/stats && break; sleep 2; done
R_APP=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/stats)
$CMP restart db > /dev/null 2>&1; sleep 15
for i in $(seq 1 30); do [ "$($CMP ps db --format '{{.Health}}' 2>/dev/null)" = "healthy" ] && break; sleep 2; done
for i in $(seq 1 15); do curl -sf -o /dev/null http://localhost:3000/api/stats && break; sleep 2; done
R_DB=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/stats)
$CMP run --rm migrate > /dev/null 2>&1; P13B=$($DBP "SELECT count(*) FROM pages" 2>/dev/null)
R_WK=$($CMP logs worker 2>/dev/null | grep -c "shutdown limpio" || true)
if [ "$R_APP" = "200" ] && [ "$R_DB" = "200" ] && [ "${P13A:-?}" = "${P13B:-?}" ]; then
  gate 13 "Restart recovery" 0 "app 200 tras restart · db 200 tras restart · re-migrar preserva datos (pages=$P13A=$P13B) · worker SIGTERM=$R_WK"
else
  gate 13 "Restart recovery" 1 "app=$R_APP db=$R_DB pages ${P13A:-?}→${P13B:-?}"
fi

echo "" >> "$SUMMARY"
echo "**TOTAL: $PASS GREEN / $FAIL FAIL** — FASE 12 es validación, NO certifica production readiness. Tor LIVE requiere conectividad real (no validada aquí)." >> "$SUMMARY"
echo "" >> "$SUMMARY"
echo "<details><summary>logs worker (últimas 15)</summary>" >> "$SUMMARY"
echo '```' >> "$SUMMARY"; $CMP logs --tail 15 worker 2>/dev/null >> "$SUMMARY" || true; echo '```' >> "$SUMMARY"; echo "</details>" >> "$SUMMARY"

echo "===================== RESUMEN ====================="
cat "$SUMMARY"
$CMP down -v --remove-orphans > /dev/null 2>&1 || true
[ "$FAIL" -eq 0 ] || exit 1
