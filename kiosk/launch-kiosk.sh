#!/usr/bin/env sh
set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
CONFIG="${RELOOP_RVM_CONFIG:-$ROOT/rvm/config.local.json}"
LOCAL_PORT="${RELOOP_LOCAL_KIOSK_PORT:-8765}"

if [ ! -f "$CONFIG" ]; then
  echo "Config tidak ditemukan: $CONFIG"
  exit 1
fi

if ! curl -fsS "http://127.0.0.1:$LOCAL_PORT/api/health" >/dev/null 2>&1; then
  cd "$ROOT"
  python3 -m rvm.main --config "$CONFIG" >/tmp/reloop-rvm.log 2>&1 &
  i=0
  while [ "$i" -lt 20 ]; do
    curl -fsS "http://127.0.0.1:$LOCAL_PORT/api/health" >/dev/null 2>&1 && break
    i=$((i + 1))
    sleep 0.25
  done
fi

BROWSER="$(command -v chromium-browser || command -v chromium || command -v google-chrome || true)"
if [ -z "$BROWSER" ]; then
  echo "Chromium/Chrome tidak ditemukan."
  exit 1
fi

exec "$BROWSER" \
  --kiosk \
  --app="http://127.0.0.1:$LOCAL_PORT" \
  --no-first-run \
  --disable-session-crashed-bubble \
  --disable-infobars \
  --disable-pinch \
  --overscroll-history-navigation=0
