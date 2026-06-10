#!/usr/bin/env bash
# Start The Tavern with a Cloudflare quick tunnel.
#
#   ./deploy/start.sh
#
# Env overrides: PORT (8080), DATA_DIR (./live/data),
# CAMPAIGNS_DIR (./live/campaigns), ADMIN_PASSWORD (first run only).
#
# Quick tunnels get a NEW random URL on every start — the script prints it;
# share it (or a fresh invite link) with your players. Ctrl-C stops both
# the server and the tunnel. For a permanent URL, see DEPLOY.md.
set -euo pipefail

cd "$(dirname "$0")/.."

PORT="${PORT:-8080}"
DATA_DIR="${DATA_DIR:-./live/data}"
CAMPAIGNS_DIR="${CAMPAIGNS_DIR:-./live/campaigns}"
TUNNEL_LOG="$(mktemp -t vtt-tunnel.XXXXXX.log)"

if [ ! -f packages/server/dist/index.js ]; then
  echo "Server not built — run ./deploy/setup-ubuntu.sh first (or: pnpm install && pnpm -r build)" >&2
  exit 1
fi

if command -v lsof >/dev/null 2>&1 && lsof -ti ":${PORT}" >/dev/null 2>&1; then
  echo "Port ${PORT} is already in use — is The Tavern already running? (override with PORT=8090 $0)" >&2
  exit 1
fi

mkdir -p "$DATA_DIR" "$CAMPAIGNS_DIR"

# --- Tunnel first: its random URL goes into the server env -------------------
echo "==> Starting Cloudflare quick tunnel for http://localhost:${PORT} …"
cloudflared tunnel --url "http://localhost:${PORT}" >"$TUNNEL_LOG" 2>&1 &
TUNNEL_PID=$!

cleanup() {
  kill "$TUNNEL_PID" 2>/dev/null || true
  rm -f "$TUNNEL_LOG"
}
trap cleanup EXIT INT TERM

PUBLIC_URL=""
for _ in $(seq 1 30); do
  PUBLIC_URL=$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | head -1 || true)
  [ -n "$PUBLIC_URL" ] && break
  if ! kill -0 "$TUNNEL_PID" 2>/dev/null; then
    echo "cloudflared exited unexpectedly — log:" >&2
    cat "$TUNNEL_LOG" >&2
    exit 1
  fi
  sleep 1
done

if [ -z "$PUBLIC_URL" ]; then
  echo "Tunnel did not come up within 30s — log:" >&2
  cat "$TUNNEL_LOG" >&2
  exit 1
fi

echo
echo "  ╔══════════════════════════════════════════════════════════════╗"
echo "    The Tavern is reachable at:"
echo "    ${PUBLIC_URL}"
echo "    (new URL each start — share it or mint a fresh invite link)"
echo "  ╚══════════════════════════════════════════════════════════════╝"
echo

# --- Server (foreground; Ctrl-C / exit stops the tunnel via trap) ------------
# ADMIN_PASSWORD, if set by the caller, is inherited from the environment.
export PORT DATA_DIR CAMPAIGNS_DIR
export PUBLIC_ORIGIN="$PUBLIC_URL"
export COOKIE_SECURE=false
node packages/server/dist/index.js
