#!/bin/sh
# Arranca Tor y espera a que el SOCKS5 responda antes de ceder el control.
#
# - Si Tor no levanta, el portal igual arranca (modo degradado): el panel
#   muestra el error en la próxima corrida en vez de dejar el contenedor
#   en un crash loop.
# - El hostname del servicio oculto queda en /var/lib/tor/faro/hostname.

set -eu

TOR_LOG=/tmp/tor.log

# El volumen puede venir vacío: tor exige que el directorio del servicio
# oculto exista, sea de debian-tor y tenga permisos 700.
mkdir -p /var/lib/tor/faro
chown -R debian-tor:debian-tor /var/lib/tor 2>/dev/null || true
chmod 700 /var/lib/tor/faro

echo "[faro] arrancando tor…"
tor -f /etc/tor/torrc >"$TOR_LOG" 2>&1 &
TOR_PID=$!

# Espera hasta 45 s a que el SOCKS escuche.
i=0
while [ "$i" -lt 45 ]; do
  if curl -s --socks5-hostname 127.0.0.1:9050 --max-time 5 \
        http://check.torproject.org/ -o /dev/null 2>/dev/null; then
    echo "[faro] tor listo (SOCKS5 9050)"
    break
  fi
  if ! kill -0 "$TOR_PID" 2>/dev/null; then
    echo "[faro] tor terminó inesperadamente; sigue el portal en modo degradado"
    tail -n 20 "$TOR_LOG" || true
    break
  fi
  i=$((i + 1))
  sleep 1
done

if [ "$i" -ge 45 ]; then
  echo "[faro] tor no respondió en 45 s; arranco el portal igual (modo degradado)"
  tail -n 20 "$TOR_LOG" || true
fi

if [ -f /var/lib/tor/faro/hostname ]; then
  echo "[faro] servicio oculto: $(cat /var/lib/tor/faro/hostname)"
fi

exec "$@"
