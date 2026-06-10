#!/usr/bin/env bash
# One-time setup for The Tavern on Ubuntu (tested on 22.04/24.04).
# Installs Node 22 + pnpm + cloudflared, then builds the app.
# Run from anywhere inside the repo:  ./deploy/setup-ubuntu.sh
set -euo pipefail

cd "$(dirname "$0")/.."
echo "==> Setting up The Tavern in $(pwd)"

# --- Node.js 22 -------------------------------------------------------------
need_node=1
if command -v node >/dev/null 2>&1; then
  major=$(node -p 'process.versions.node.split(".")[0]')
  if [ "$major" -ge 22 ]; then
    need_node=0
    echo "==> Node $(node -v) found"
  fi
fi
if [ "$need_node" = 1 ]; then
  echo "==> Installing Node.js 22 (NodeSource)"
  curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
  sudo apt-get install -y nodejs
fi

# --- pnpm via corepack -------------------------------------------------------
if ! command -v pnpm >/dev/null 2>&1; then
  echo "==> Enabling pnpm via corepack"
  sudo corepack enable
  corepack prepare pnpm@9.0.0 --activate
fi
echo "==> pnpm $(pnpm -v)"

# --- cloudflared -------------------------------------------------------------
if ! command -v cloudflared >/dev/null 2>&1; then
  echo "==> Installing cloudflared"
  arch=$(dpkg --print-architecture) # amd64 / arm64
  curl -fsSL -o /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${arch}.deb"
  sudo dpkg -i /tmp/cloudflared.deb
  rm -f /tmp/cloudflared.deb
fi
echo "==> cloudflared $(cloudflared --version | head -1)"

# --- Build -------------------------------------------------------------------
echo "==> Installing dependencies (sharp's native binary must be built HERE, not copied from another OS)"
pnpm install
echo "==> Building"
pnpm -r build

# --- World data dirs ----------------------------------------------------------
mkdir -p live/data live/campaigns
echo
echo "✔ Setup complete."
echo
echo "Next steps:"
echo "  1. (Optional) copy an existing world into ./live/  (data/ + campaigns/)"
echo "  2. Start everything:   ADMIN_PASSWORD='choose-a-password' ./deploy/start.sh"
echo "     (omit ADMIN_PASSWORD on first run to get a generated one printed once)"
echo
echo "For a permanent URL + systemd autostart, see DEPLOY.md (named tunnel)."
